//! cargo run -p suneiro-core --example ask -- <repo> <agent>
//! Plan-mode chat that asks the agent to question the user; prints the
//! question schema, answers with the first option of each, prints the reply.
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use suneiro_core::{Core, Event};
use serde_json::{json, Map, Value};

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
    settings.plan_by_default = true;
    core.save_settings(&settings)?;
    let repo = core.add_repo(&a[0]).await?;
    let ws = core.create_workspace(&repo.id).await?;
    let sid = core.create_session(&ws.id, &a[1], None, None)?.id;
    core.agents.prompt(
        &sid,
        "Before planning anything, ask me two multiple-choice questions using your built-in tool for asking the user questions: \
         (1) my preferred color: red or blue, (2) whether to include tests: yes or no. \
         After I answer, reply with one sentence restating my answers and stop. Do not edit files."
            .into(),
    )?;
    let mut text = String::new();
    for _ in 0..1800 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let batch: Vec<Event> = std::mem::take(&mut *events.lock());
        for e in batch {
            match e {
                Event::Question { request_id, message, schema, .. } => {
                    println!("QUESTION: {message}\nSCHEMA: {}", serde_json::to_string(&schema)?);
                    let mut content = Map::new();
                    for (key, prop) in schema["properties"].as_object().into_iter().flatten() {
                        if let Some(first) = prop["oneOf"].get(0) {
                            content.insert(key.clone(), first["const"].clone());
                        } else if let Some(first) = prop.pointer("/items/anyOf/0") {
                            content.insert(key.clone(), json!([first["const"].clone()]));
                        }
                    }
                    println!("ANSWER: {}", Value::Object(content.clone()));
                    core.agents.answer_question(&sid, &request_id, json!({"action": "accept", "content": content})).await?;
                }
                Event::PermissionRequest { request_id, tool_call, options, .. } => {
                    println!("PERMISSION: {} -> rejecting", tool_call["title"]);
                    let reject = options.as_array().and_then(|o| o.iter().find(|o| o["kind"].as_str().is_some_and(|k| k.starts_with("reject"))).cloned());
                    let id = reject.and_then(|o| o["optionId"].as_str().map(str::to_string));
                    core.agents.respond_permission(&sid, &request_id, id).await?;
                }
                Event::SessionUpdate { update, .. } => {
                    if update["sessionUpdate"] == "agent_message_chunk" {
                        text.push_str(update["content"]["text"].as_str().unwrap_or(""));
                    }
                }
                Event::TurnEnd { stop_reason, .. } => {
                    println!("REPLY: {}\n[turn ended: {stop_reason}]", text.trim());
                    core.archive_workspace(&ws.id).await?;
                    core.shutdown();
                    return Ok(());
                }
                Event::SessionState { state, error: Some(err), .. } if state == "error" => anyhow::bail!(err),
                _ => {}
            }
        }
    }
    anyhow::bail!("timed out")
}
