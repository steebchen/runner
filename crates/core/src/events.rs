use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

/// Everything the core reports to the UI. Session events that make up a
/// transcript are also persisted, so the same reducer rebuilds history.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    SessionUpdate { session_id: String, update: Value },
    UserMessage { session_id: String, text: String, ts: i64 },
    TurnEnd { session_id: String, stop_reason: String, ts: i64 },
    SessionState { session_id: String, state: String, error: Option<String> },
    SessionConfig { session_id: String, config_options: Value },
    SessionTitle { session_id: String, title: String },
    /// Runner-level permission mode: plan (agent asks) or auto-accept everything.
    SessionMode { session_id: String, plan: bool },
    PermissionRequest { session_id: String, request_id: String, tool_call: Value, options: Value },
    PermissionResolved { session_id: String, request_id: String },
    WorkspaceStatus { workspace_id: String, status: String },
    WorkspaceTitle { workspace_id: String, title: String },
    ScriptOutput { workspace_id: String, data: String },
}

impl Event {
    /// The session whose transcript this event belongs to, if it should be stored.
    pub fn persist_key(&self) -> Option<&str> {
        match self {
            Event::SessionUpdate { session_id, update } => {
                let kind = update.get("sessionUpdate").and_then(|k| k.as_str()).unwrap_or("");
                let transient = matches!(
                    kind,
                    "available_commands_update" | "usage_update" | "session_info_update"
                );
                (!transient).then_some(session_id)
            }
            Event::UserMessage { session_id, .. } | Event::TurnEnd { session_id, .. } => {
                Some(session_id)
            }
            Event::SessionState { session_id, state, .. } if state == "error" => Some(session_id),
            _ => None,
        }
    }
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;
