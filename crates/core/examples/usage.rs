//! cargo run -p suneiro-core --example usage -- <repo> <agent>
//! Two short turns; prints every usage/cost report the agent sends.
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use suneiro_core::{Core, Event};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    std::env::set_var("SUNEIRO_NO_AI_TITLES", "1");
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
    for (i, prompt) in ["Reply with exactly: one", "Reply with exactly: two"].into_iter().enumerate() {
        if i == 1 {
            println!("(restarting the agent process; next turn resumes the session)");
            core.agents.close(&sid);
        }
        core.agents.prompt(&sid, prompt.into())?;
        'turn: loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let batch = std::mem::take(&mut *events.lock());
            for e in batch {
                match e {
                    Event::SessionUpdate { update, .. } if update["sessionUpdate"] == "usage_update" => {
                        if let Some(c) = update.get("cost") {
                            println!("  agent reports running total: {c}");
                        }
                    }
                    Event::Usage { usage, .. } => println!(
                        "  recorded turn: model={} in={} cached={} out={} cost={:?} estimated={}",
                        usage.record.model, usage.record.input_tokens, usage.record.cached_tokens, usage.record.output_tokens, usage.cost, usage.estimated
                    ),
                    Event::TurnEnd { .. } => {
                        println!("--- turn end: {prompt}");
                        break 'turn;
                    }
                    _ => {}
                }
            }
        }
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let total: f64 = core.usage(0)?.iter().filter_map(|u| u.cost).sum();
    println!("session total recorded: {total:.4}");
    core.archive_workspace(&ws.id).await?;
    core.shutdown();
    Ok(())
}
