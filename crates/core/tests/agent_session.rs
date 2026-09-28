use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use runner_core::{AgentDef, Core, Event, Repo, Workspace};
use serde_json::json;

fn event_log() -> (Arc<Mutex<Vec<Event>>>, runner_core::Sink) {
    let log: Arc<Mutex<Vec<Event>>> = Arc::default();
    let sink_log = log.clone();
    (log, Arc::new(move |e| sink_log.lock().push(e)))
}

async fn wait_for(log: &Mutex<Vec<Event>>, what: &str, pred: impl Fn(&Event) -> bool) -> Event {
    for _ in 0..200 {
        if let Some(e) = log.lock().iter().find(|e| pred(e)) {
            return e.clone();
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for {what}; got {:#?}", log.lock());
}

#[tokio::test]
async fn prompt_permission_config_and_resume() {
    let tmp = tempfile::tempdir().unwrap();
    let (log, sink) = event_log();
    let core = Core::new(tmp.path(), sink).unwrap();
    core.agents.register(AgentDef {
        id: "fake".into(),
        name: "Fake".into(),
        command: "node".into(),
        args: vec![concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_agent.mjs").into()],
    });

    let repo = Repo { id: "r".into(), name: "r".into(), path: tmp.path().display().to_string(), default_branch: "main".into() };
    core.store.add_repo(&repo).unwrap();
    core.store
        .add_workspace(&Workspace {
            id: "w".into(),
            repo_id: "r".into(),
            name: "w".into(),
            branch: "b".into(),
            base_branch: "main".into(),
            path: tmp.path().display().to_string(),
            status: "ready".into(),
            created_at: 0,
        })
        .unwrap();

    let session = core.create_session("w", "fake").unwrap();
    let sid = session.id.clone();

    // Warm-up connects and reports config options before any prompt.
    wait_for(&log, "config", |e| matches!(e, Event::SessionConfig { .. })).await;
    core.agents.set_config(&sid, "model", json!("smart")).await.unwrap();
    wait_for(&log, "updated config", |e| {
        matches!(e, Event::SessionConfig { config_options, .. } if config_options[0]["currentValue"] == "smart")
    })
    .await;

    core.agents.prompt(&sid, "do the thing".into()).unwrap();
    let Event::PermissionRequest { request_id, .. } =
        wait_for(&log, "permission", |e| matches!(e, Event::PermissionRequest { .. })).await
    else {
        unreachable!()
    };
    core.agents.respond_permission(&sid, &request_id, Some("allow".into())).await.unwrap();
    wait_for(&log, "turn end", |e| matches!(e, Event::TurnEnd { .. })).await;
    wait_for(&log, "allowed", |e| {
        matches!(e, Event::SessionUpdate { update, .. } if update["content"]["text"] == "outcome:allow")
    })
    .await;
    assert!(!core.agents.is_running(&sid));
    assert_eq!(core.store.session(&sid).unwrap().acp_session_id.as_deref(), Some("fake-1"));
    assert_eq!(core.store.session(&sid).unwrap().title, "do the thing");

    // Transcript is persisted with streamed chunks merged.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let stored = core.store.events(&sid).unwrap();
    assert_eq!(stored[0]["type"], "userMessage");
    assert!(stored.iter().any(|e| e["update"]["content"]["text"] == "Hello world"));
    assert_eq!(stored.last().unwrap()["type"], "turnEnd");

    // After the process dies, the next prompt resumes the same ACP session.
    core.agents.close(&sid);
    log.lock().clear();
    core.agents.prompt(&sid, "again".into()).unwrap();
    let Event::PermissionRequest { request_id, .. } =
        wait_for(&log, "permission 2", |e| matches!(e, Event::PermissionRequest { .. })).await
    else {
        unreachable!()
    };
    core.agents.respond_permission(&sid, &request_id, None).await.unwrap();
    wait_for(&log, "cancelled", |e| {
        matches!(e, Event::SessionUpdate { update, .. } if update["content"]["text"] == "outcome:cancelled")
    })
    .await;
    assert_eq!(core.store.session(&sid).unwrap().acp_session_id.as_deref(), Some("fake-1"));
    core.shutdown();
}
