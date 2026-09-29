//! cargo run -p runner-core --example steer -- <repo> <agent>
//! Starts a slow turn, steers a second instruction into it, prints the reply.
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use runner_core::{Core, Event};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    std::env::set_var("RUNNER_NO_AI_TITLES", "1");
    let a: Vec<String> = std::env::args().skip(1).collect();
    let data = tempfile::tempdir()?;
    let events: Arc<Mutex<Vec<Event>>> = Arc::default();
    let sink = events.clone();
    let core = Core::new(data.path(), Arc::new(move |e| sink.lock().push(e)))?;
    let mut settings = core.settings();
    settings.workspaces_root = data.path().join("ws").to_string_lossy().into();
    core.save_settings(&settings)?;
    let repo = core.add_repo(&a[0]).await?;
    let ws = core.create_workspace(&repo.id).await?;
    let sid = core.create_session(&ws.id, &a[1], None, None)?.id;
    core.agents.prompt(&sid, "Run the shell command `sleep 20 && echo first-done` and report its output.".into())?;
    tokio::time::sleep(Duration::from_secs(8)).await;
    let outcome = core.agents.steer(&sid, "Additionally, once that finishes, also run `echo steered-ok` and include its output in your reply.".into()).await?;
    println!("steer outcome: {outcome}");
    let mut text = String::new();
    for _ in 0..1200 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        for e in std::mem::take(&mut *events.lock()) {
            match e {
                Event::SessionUpdate { update, .. } if update["sessionUpdate"] == "agent_message_chunk" => {
                    text.push_str(update["content"]["text"].as_str().unwrap_or(""));
                }
                Event::TurnEnd { stop_reason, .. } => {
                    println!("turn ended ({stop_reason}); running={}", core.agents.is_running(&sid));
                    if !core.agents.is_running(&sid) {
                        println!("REPLY: {}", text.trim());
                        core.archive_workspace(&ws.id).await?;
                        core.shutdown();
                        return Ok(());
                    }
                }
                _ => {}
            }
        }
    }
    anyhow::bail!("timed out")
}
