//! Agent sessions. Each session owns one ACP agent process running inside the
//! workspace's worktree. Agents authenticate with whatever the user already has
//! set up locally (Claude subscription login, Codex ChatGPT login, OpenCode auth).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::acp::{AcpConnection, Incoming, PROTOCOL_VERSION};
use crate::events::Event;
use crate::store::{now, Session, Store};
use crate::Emitter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
}

pub fn builtin_agents() -> Vec<AgentDef> {
    let def = |id: &str, name: &str, command: &str, args: &[&str]| AgentDef {
        id: id.into(),
        name: name.into(),
        command: command.into(),
        args: args.iter().map(|a| a.to_string()).collect(),
    };
    vec![
        def("claude", "Claude Code", "npx", &["-y", "@agentclientprotocol/claude-agent-acp@0.83.0"]),
        def("codex", "Codex", "npx", &["-y", "@agentclientprotocol/codex-acp@2.0.0"]),
        def("opencode", "OpenCode", "opencode", &["acp"]),
    ]
}


const REPLAY_DONE: &str = "replay-done";

struct LiveSession {
    id: String,
    workspace_id: String,
    agent: AgentDef,
    cwd: PathBuf,
    conn: tokio::sync::Mutex<Option<Arc<AcpConnection>>>,
    acp_session_id: Mutex<Option<String>>,
    /// Our request id -> JSON-RPC id of the agent's pending permission request.
    permissions: Mutex<HashMap<String, Value>>,
    running: AtomicBool,
    replaying: AtomicBool,
    titled: AtomicBool,
}

pub struct Agents {
    store: Arc<Store>,
    emitter: Emitter,
    sessions: Mutex<HashMap<String, Arc<LiveSession>>>,
    defs: Mutex<Vec<AgentDef>>,
}

impl Agents {
    pub fn new(store: Arc<Store>, emitter: Emitter) -> Self {
        Self { store, emitter, sessions: Mutex::default(), defs: Mutex::new(builtin_agents()) }
    }

    pub fn defs(&self) -> Vec<AgentDef> {
        self.defs.lock().clone()
    }

    /// Add or replace an agent definition.
    pub fn register(&self, def: AgentDef) {
        let mut defs = self.defs.lock();
        defs.retain(|d| d.id != def.id);
        defs.push(def);
    }

    pub fn def(&self, id: &str) -> Result<AgentDef> {
        self.defs
            .lock()
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| anyhow!("unknown agent `{id}`"))
    }

    fn live(&self, session: &Session, cwd: PathBuf) -> Result<Arc<LiveSession>> {
        if let Some(s) = self.sessions.lock().get(&session.id) {
            return Ok(s.clone());
        }
        let live = Arc::new(LiveSession {
            id: session.id.clone(),
            workspace_id: session.workspace_id.clone(),
            agent: self.def(&session.agent_id)?,
            cwd,
            conn: tokio::sync::Mutex::new(None),
            acp_session_id: Mutex::new(session.acp_session_id.clone()),
            permissions: Mutex::default(),
            running: AtomicBool::new(false),
            replaying: AtomicBool::new(false),
            titled: AtomicBool::new(!session.title.is_empty()),
        });
        Ok(self.sessions.lock().entry(session.id.clone()).or_insert(live).clone())
    }

    fn get(&self, session_id: &str) -> Result<Arc<LiveSession>> {
        if let Some(s) = self.sessions.lock().get(session_id) {
            return Ok(s.clone());
        }
        let session = self.store.session(session_id)?;
        let ws = self.store.workspace(&session.workspace_id)?;
        self.live(&session, PathBuf::from(ws.path))
    }

    fn state(&self, s: &LiveSession, state: &str, error: Option<String>) {
        self.emitter.emit(Event::SessionState {
            session_id: s.id.clone(),
            state: state.into(),
            error,
        });
    }

    /// Start the agent in the background so config options (model, mode) are
    /// ready by the time the user types their first message.
    pub fn warm_up(self: &Arc<Self>, session_id: &str) {
        let this = self.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            let Ok(s) = this.get(&session_id) else { return };
            if let Err(e) = this.connect(&s).await {
                this.state(&s, "error", Some(format!("{e:#}")));
            }
        });
    }

    async fn connect(self: &Arc<Self>, s: &Arc<LiveSession>) -> Result<Arc<AcpConnection>> {
        let mut guard = s.conn.lock().await;
        if let Some(conn) = guard.as_ref().filter(|c| c.is_alive()) {
            return Ok(conn.clone());
        }
        if !s.running.load(Ordering::SeqCst) {
            self.state(s, "connecting", None);
        }

        let (conn, rx) = AcpConnection::spawn(&s.agent.command, &s.agent.args, &s.cwd)?;
        tokio::spawn(self.clone().handle_incoming(s.clone(), conn.clone(), rx));

        let init = conn
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientCapabilities": {
                        "fs": {"readTextFile": false, "writeTextFile": false},
                        "terminal": false
                    },
                    "clientInfo": {"name": "runner", "version": env!("CARGO_PKG_VERSION")}
                }),
            )
            .await?;
        let caps = init.get("agentCapabilities").cloned().unwrap_or(Value::Null);
        let cwd = s.cwd.to_string_lossy().to_string();

        let existing = s.acp_session_id.lock().clone();
        let mut response = None;
        if let Some(id) = &existing {
            let params = json!({"sessionId": id, "cwd": cwd, "mcpServers": []});
            if caps.pointer("/sessionCapabilities/resume").is_some() {
                response = conn.request("session/resume", params).await.ok();
            } else if caps.get("loadSession").and_then(|v| v.as_bool()) == Some(true) {
                // session/load replays history as updates; we already have it stored.
                s.replaying.store(true, Ordering::SeqCst);
                response = conn.request("session/load", params).await.ok();
                conn.mark(REPLAY_DONE);
            }
        }
        let response = match response {
            Some(r) => r,
            None => {
                let r = conn.request("session/new", json!({"cwd": cwd, "mcpServers": []})).await?;
                let id = r
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("agent returned no sessionId"))?;
                *s.acp_session_id.lock() = Some(id.to_string());
                self.store.set_acp_session_id(&s.id, id)?;
                r
            }
        };
        if let Some(opts) = response.get("configOptions").filter(|v| v.is_array()) {
            self.emitter.emit(Event::SessionConfig {
                session_id: s.id.clone(),
                config_options: opts.clone(),
            });
        }
        if !s.running.load(Ordering::SeqCst) {
            self.state(s, "idle", None);
        }
        *guard = Some(conn.clone());
        Ok(conn)
    }

    async fn handle_incoming(
        self: Arc<Self>,
        s: Arc<LiveSession>,
        conn: Arc<AcpConnection>,
        mut rx: mpsc::UnboundedReceiver<Incoming>,
    ) {
        while let Some(msg) = rx.recv().await {
            match msg {
                Incoming::Marker(REPLAY_DONE) => s.replaying.store(false, Ordering::SeqCst),
                Incoming::Marker(_) => {}
                Incoming::Notification { method, params } if method == "session/update" => {
                    if s.replaying.load(Ordering::SeqCst) {
                        continue;
                    }
                    let Some(update) = params.get("update").cloned() else { continue };
                    self.on_update(&s, update);
                }
                Incoming::Notification { .. } => {}
                Incoming::Request { id, method, params } => match method.as_str() {
                    "session/request_permission" => {
                        let request_id = uuid::Uuid::new_v4().to_string();
                        s.permissions.lock().insert(request_id.clone(), id);
                        self.emitter.emit(Event::PermissionRequest {
                            session_id: s.id.clone(),
                            request_id,
                            tool_call: params.get("toolCall").cloned().unwrap_or(Value::Null),
                            options: params.get("options").cloned().unwrap_or(json!([])),
                        });
                    }
                    _ => {
                        let _ = conn.respond_error(id, -32601, "method not supported").await;
                    }
                },
                Incoming::Closed { stderr_tail } => {
                    let pending: Vec<String> = s.permissions.lock().drain().map(|(k, _)| k).collect();
                    for request_id in pending {
                        self.emitter.emit(Event::PermissionResolved {
                            session_id: s.id.clone(),
                            request_id,
                        });
                    }
                    if s.running.load(Ordering::SeqCst) {
                        let tail = stderr_tail.lines().rev().take(8).collect::<Vec<_>>();
                        let tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
                        self.state(&s, "error", Some(format!("Agent exited unexpectedly.\n{tail}")));
                    }
                    break;
                }
            }
        }
    }

    fn on_update(&self, s: &LiveSession, update: Value) {
        let kind = update.get("sessionUpdate").and_then(|k| k.as_str()).unwrap_or("");
        match kind {
            "config_option_update" => {
                if let Some(opts) = update.get("configOptions") {
                    self.emitter.emit(Event::SessionConfig {
                        session_id: s.id.clone(),
                        config_options: opts.clone(),
                    });
                }
            }
            "session_info_update" => {
                if let Some(title) = update.get("title").and_then(|t| t.as_str()) {
                    self.set_title(s, title);
                }
            }
            _ => {}
        }
        self.emitter.emit(Event::SessionUpdate { session_id: s.id.clone(), update });
    }

    fn set_title(&self, s: &LiveSession, title: &str) {
        let title: String = title.lines().next().unwrap_or("").chars().take(60).collect();
        if title.trim().is_empty() {
            return;
        }
        s.titled.store(true, Ordering::SeqCst);
        let _ = self.store.set_session_title(&s.id, &title);
        self.emitter.emit(Event::SessionTitle { session_id: s.id.clone(), title });
    }

    pub fn prompt(self: &Arc<Self>, session_id: &str, text: String) -> Result<()> {
        let s = self.get(session_id)?;
        if s.running.swap(true, Ordering::SeqCst) {
            bail!("agent is still working");
        }
        if !s.titled.load(Ordering::SeqCst) {
            self.set_title(&s, &text);
        }
        self.emitter.emit(Event::UserMessage {
            session_id: s.id.clone(),
            text: text.clone(),
            ts: now(),
        });
        self.state(&s, "running", None);
        self.emitter.emit(Event::WorkspaceStatus {
            workspace_id: s.workspace_id.clone(),
            status: "dirty".into(),
        });

        let this = self.clone();
        tokio::spawn(async move {
            let result = async {
                let conn = this.connect(&s).await?;
                let acp_id = s.acp_session_id.lock().clone().unwrap_or_default();
                conn.request(
                    "session/prompt",
                    json!({"sessionId": acp_id, "prompt": [{"type": "text", "text": text}]}),
                )
                .await
            }
            .await;
            s.running.store(false, Ordering::SeqCst);
            match result {
                Ok(r) => {
                    let stop_reason =
                        r.get("stopReason").and_then(|v| v.as_str()).unwrap_or("end_turn");
                    this.emitter.emit(Event::TurnEnd {
                        session_id: s.id.clone(),
                        stop_reason: stop_reason.into(),
                        ts: now(),
                    });
                    this.state(&s, "idle", None);
                }
                Err(e) => this.state(&s, "error", Some(format!("{e:#}"))),
            }
            this.emitter.emit(Event::WorkspaceStatus {
                workspace_id: s.workspace_id.clone(),
                status: "dirty".into(),
            });
        });
        Ok(())
    }

    pub async fn cancel(&self, session_id: &str) -> Result<()> {
        let s = self.get(session_id)?;
        let conn = s.conn.lock().await.clone();
        let Some(conn) = conn else { return Ok(()) };
        let pending: Vec<(String, Value)> = s.permissions.lock().drain().collect();
        for (request_id, id) in pending {
            let _ = conn.respond(id, json!({"outcome": {"outcome": "cancelled"}})).await;
            self.emitter.emit(Event::PermissionResolved { session_id: s.id.clone(), request_id });
        }
        let acp_id = s.acp_session_id.lock().clone().unwrap_or_default();
        conn.notify("session/cancel", json!({"sessionId": acp_id})).await
    }

    pub async fn respond_permission(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: Option<String>,
    ) -> Result<()> {
        let s = self.get(session_id)?;
        let id = s
            .permissions
            .lock()
            .remove(request_id)
            .ok_or_else(|| anyhow!("permission request already resolved"))?;
        let conn = s.conn.lock().await.clone().ok_or_else(|| anyhow!("agent not connected"))?;
        let outcome = match option_id {
            Some(option_id) => json!({"outcome": "selected", "optionId": option_id}),
            None => json!({"outcome": "cancelled"}),
        };
        conn.respond(id, json!({"outcome": outcome})).await?;
        self.emitter.emit(Event::PermissionResolved {
            session_id: s.id.clone(),
            request_id: request_id.into(),
        });
        Ok(())
    }

    pub async fn set_config(
        self: &Arc<Self>,
        session_id: &str,
        config_id: &str,
        value: Value,
    ) -> Result<()> {
        let s = self.get(session_id)?;
        let conn = self.connect(&s).await?;
        let acp_id = s.acp_session_id.lock().clone().unwrap_or_default();
        let mut params = json!({"sessionId": acp_id, "configId": config_id, "value": value});
        if value.is_boolean() {
            params["type"] = json!("boolean");
        }
        let r = conn.request("session/set_config_option", params).await?;
        if let Some(opts) = r.get("configOptions").filter(|v| v.is_array()) {
            self.emitter.emit(Event::SessionConfig {
                session_id: s.id.clone(),
                config_options: opts.clone(),
            });
        }
        Ok(())
    }

    pub fn is_running(&self, session_id: &str) -> bool {
        self.sessions
            .lock()
            .get(session_id)
            .is_some_and(|s| s.running.load(Ordering::SeqCst))
    }

    pub fn close(&self, session_id: &str) {
        if let Some(s) = self.sessions.lock().remove(session_id) {
            if let Ok(guard) = s.conn.try_lock() {
                if let Some(conn) = guard.as_ref() {
                    conn.kill();
                }
            }
        }
    }

    pub fn shutdown(&self) {
        let ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
    }
}
