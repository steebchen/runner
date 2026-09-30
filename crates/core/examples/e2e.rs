//! Real end-to-end smoke test: create a workspace for a repo, ask an agent for
//! a change (auto-approving permissions), print the resulting diff.
//!
//!   cargo run -p suneiro-core --example e2e -- <repo-path> [agent] [prompt]
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use suneiro_core::{Core, Event};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let repo_path = args.first().expect("usage: e2e <repo-path> [agent] [prompt]");
    let agent = args.get(1).map(String::as_str).unwrap_or("claude");
    let prompt = args.get(2).cloned().unwrap_or_else(|| {
        "Add a `subtract(a, b)` function to math.js and export it. Keep it minimal; don't run anything.".into()
    });

    let data = tempfile::tempdir()?;
    let events: Arc<Mutex<Vec<Event>>> = Arc::default();
    let sink_events = events.clone();
    let core = Core::new(
        data.path(),
        Arc::new(move |e| {
            if let Event::SessionUpdate { update, .. } = &e {
                if let Some(t) = update.pointer("/content/text").and_then(|t| t.as_str()) {
                    print!("{t}");
                } else if let Some(title) = update.get("title").and_then(|t| t.as_str()) {
                    println!("\n[tool] {title}");
                }
            }
            sink_events.lock().push(e);
        }),
    )?;
    let mut settings = core.settings();
    settings.workspaces_root = data.path().join("ws").to_string_lossy().into();
    core.save_settings(&settings)?;

    let repo = core.add_repo(repo_path).await?;
    let ws = core.create_workspace(&repo.id).await?;
    println!("workspace {} at {}", ws.branch, ws.path);
    let session = core.create_session(&ws.id, agent, None, None)?;
    core.agents.prompt(&session.id, prompt)?;

    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let pending: Vec<(String, String)> = events
            .lock()
            .iter()
            .filter_map(|e| match e {
                Event::PermissionRequest { request_id, options, .. } => {
                    let allow = options.as_array()?.iter().find(|o| o["kind"].as_str().is_some_and(|k| k.starts_with("allow")))?;
                    Some((request_id.clone(), allow["optionId"].as_str()?.to_string()))
                }
                _ => None,
            })
            .collect();
        events.lock().retain(|e| !matches!(e, Event::PermissionRequest { .. }));
        for (rid, opt) in pending {
            println!("\n[auto-allow permission]");
            core.agents.respond_permission(&session.id, &rid, Some(opt)).await?;
        }
        let done = events.lock().iter().find_map(|e| match e {
            Event::TurnEnd { stop_reason, .. } => Some(Ok(stop_reason.clone())),
            Event::SessionState { state, error, .. } if state == "error" => Some(Err(error.clone())),
            _ => None,
        });
        match done {
            Some(Ok(reason)) => {
                println!("\n\n[turn ended: {reason}]");
                break;
            }
            Some(Err(e)) => anyhow::bail!("agent error: {e:?}"),
            None => {}
        }
    }

    for f in core.changed_files(&ws.id).await? {
        println!("changed: {} {} +{:?} -{:?}", f.status, f.path, f.additions, f.deletions);
        println!("{}", core.file_diff(&ws.id, &f.path).await?);
    }
    core.archive_workspace(&ws.id).await?;
    core.shutdown();
    Ok(())
}
