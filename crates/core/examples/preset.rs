//! cargo run -p runner-core --example preset -- <repo> <agent> <model> <effort>
//! Starts a chat with a preset model/effort and prints what the agent reports.
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use runner_core::{Core, Event};
use serde_json::Value;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let data = tempfile::tempdir()?;
    let config: Arc<Mutex<Value>> = Arc::default();
    let sink = config.clone();
    let core = Core::new(
        data.path(),
        Arc::new(move |e| {
            if let Event::SessionConfig { config_options, .. } = e {
                *sink.lock() = config_options;
            }
        }),
    )?;
    let mut settings = core.settings();
    settings.workspaces_root = data.path().join("ws").to_string_lossy().into();
    core.save_settings(&settings)?;
    let repo = core.add_repo(&a[0]).await?;
    let ws = core.create_workspace(&repo.id).await?;
    core.create_session(&ws.id, &a[1], Some(a[2].clone()), Some(a[3].clone()))?;
    for _ in 0..300 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let c = config.lock().clone();
        let model = runner_core::catalog::model_option(&c).map(|o| o["currentValue"].clone());
        let effort = runner_core::catalog::effort_option(&c).map(|o| o["currentValue"].clone());
        let effort_ok = effort.as_ref().and_then(|m| m.as_str()) == Some(a[3].as_str());
        if model.as_ref().and_then(|m| m.as_str()) == Some(a[2].as_str()) && effort_ok {
            println!("model={model:?} effort={effort:?}");
            break;
        }
    }
    let c = config.lock().clone();
    println!(
        "final: model={:?} effort={:?}",
        runner_core::catalog::model_option(&c).map(|o| o["currentValue"].clone()),
        runner_core::catalog::effort_option(&c).map(|o| o["currentValue"].clone())
    );
    core.archive_workspace(&ws.id).await?;
    core.shutdown();
    Ok(())
}
