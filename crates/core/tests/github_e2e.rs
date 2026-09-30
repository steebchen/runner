//! Real GitHub end-to-end test for PR status tracking. Opt-in, because it
//! creates PRs and runs CI on a fixture repository:
//!
//!   SUNEIRO_E2E_GH_REPO=steebchen/runner-e2e-test \
//!     cargo test -p suneiro-core --test github_e2e -- --ignored --nocapture
//!
//! The fixture's CI fails when a file named `FAIL` exists.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use suneiro_core::{git, Core, Event};
use serde_json::Value;

fn check_state(pr: &Value) -> &'static str {
    let checks = pr["statusCheckRollup"].as_array().cloned().unwrap_or_default();
    let result = |c: &Value| c["conclusion"].as_str().or(c["state"].as_str()).unwrap_or("").to_uppercase();
    if checks.iter().any(|c| ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].contains(&result(c).as_str())) {
        "failure"
    } else if checks.is_empty() || checks.iter().any(|c| !["SUCCESS", "NEUTRAL", "SKIPPED"].contains(&result(c).as_str())) {
        "pending"
    } else {
        "success"
    }
}

async fn wait(
    core: &Core,
    prs: &Mutex<HashMap<String, Value>>,
    what: &str,
    id: &str,
    pred: &dyn Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        core.poll_prs().await;
        if let Some(pr) = prs.lock().get(id).filter(|p| pred(p)).cloned() {
            println!("✓ {what}: #{} {} checks={}", pr["number"], pr["state"], check_state(&pr));
            return pr;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}: {:?}", prs.lock().get(id));
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

#[tokio::test]
#[ignore]
async fn pr_status_open_failing_merged_closed() {
    let Ok(gh_repo) = std::env::var("SUNEIRO_E2E_GH_REPO").or_else(|_| std::env::var("RUNNER_E2E_GH_REPO")) else {
        eprintln!("set SUNEIRO_E2E_GH_REPO to run");
        return;
    };
    std::env::set_var("SUNEIRO_NO_AI_TITLES", "1");
    let tmp = tempfile::tempdir().unwrap();
    let clone = tmp.path().join("repo");
    let status = std::process::Command::new("gh")
        .args(["repo", "clone", &gh_repo, &clone.to_string_lossy(), "--", "-q"])
        .status()
        .unwrap();
    assert!(status.success(), "clone failed");

    let prs: Arc<Mutex<HashMap<String, Value>>> = Arc::default();
    let sink_prs = prs.clone();
    let core = Core::new(
        &tmp.path().join("data"),
        Arc::new(move |e| {
            if let Event::WorkspacePr { workspace_id, pr } = e {
                sink_prs.lock().insert(workspace_id, pr);
            }
        }),
    )
    .unwrap();
    let mut settings = core.settings();
    settings.workspaces_root = tmp.path().join("ws").to_string_lossy().into();
    settings.branch_prefix = format!("e2e-{}/", std::process::id());
    core.save_settings(&settings).unwrap();

    let repo = core.add_repo(&clone.to_string_lossy()).await.unwrap();
    let mut ws = Vec::new();
    for (file, title) in [("ok.txt", "e2e: passing"), ("FAIL", "e2e: failing"), ("closed.txt", "e2e: to close")] {
        let w = core.create_workspace(&repo.id).await.unwrap();
        while core.store.workspace(&w.id).unwrap().status == "creating" {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        std::fs::write(Path::new(&w.path).join(file), "e2e\n").unwrap();
        let url = core.create_pr(&w.id, title, "Created by Suneiro's e2e test.").await.unwrap();
        println!("{title}: {url}");
        ws.push(w);
    }
    let (passing, failing, closing) = (&ws[0], &ws[1], &ws[2]);

    wait(&core, &prs, "passing PR open with green checks", &passing.id, &|p| p["state"] == "OPEN" && check_state(p) == "success").await;
    wait(&core, &prs, "failing PR open with failed checks", &failing.id, &|p| p["state"] == "OPEN" && check_state(p) == "failure").await;

    let out = std::process::Command::new("gh")
        .args(["pr", "close", &closing.branch])
        .current_dir(&clone)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    wait(&core, &prs, "closed PR", &closing.id, &|p| p["state"] == "CLOSED").await;

    core.merge_pr(&passing.id).await.unwrap();
    wait(&core, &prs, "merged PR", &passing.id, &|p| p["state"] == "MERGED").await;

    // Clean up the fixture: close the failing PR, delete leftover branches,
    // and revert the merged change so main stays tiny.
    let gh = |args: &[&str]| {
        let _ = std::process::Command::new("gh").args(args).current_dir(&clone).status();
    };
    gh(&["pr", "close", &failing.branch]);
    for w in &ws {
        let _ = git::git(&clone, &["push", "-q", "origin", "--delete", &w.branch]).await;
    }
    let _ = git::git(&clone, &["pull", "-q", "origin", "main"]).await;
    if clone.join("ok.txt").exists() {
        let _ = git::git(&clone, &["rm", "-q", "ok.txt"]).await;
        let _ = git::git(&clone, &["commit", "-qm", "e2e cleanup"]).await;
        let _ = git::git(&clone, &["push", "-q", "origin", "main"]).await;
    }
    core.shutdown();
}
