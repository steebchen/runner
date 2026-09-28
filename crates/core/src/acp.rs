//! Minimal Agent Client Protocol client: newline-delimited JSON-RPC 2.0 over
//! the agent process's stdio.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot};

use crate::env::tokio_command;

pub const PROTOCOL_VERSION: u64 = 1;

#[derive(Debug)]
pub enum Incoming {
    Notification { method: String, params: Value },
    Request { id: Value, method: String, params: Value },
    /// Injected by the client (not the agent) to mark a position in the stream.
    Marker(&'static str),
    Closed { stderr_tail: String },
}

type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>;

pub struct AcpConnection {
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Arc<Pending>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    child: Mutex<Option<Child>>,
    incoming: mpsc::UnboundedSender<Incoming>,
}

impl AcpConnection {
    pub fn spawn(
        program: &str,
        args: &[String],
        cwd: &Path,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<Incoming>)> {
        let mut cmd = tokio_command(program);
        cmd.args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Own process group so we can kill wrappers like `npx` and their children together.
        #[cfg(unix)]
        cmd.process_group(0);
        let mut child = cmd.spawn().with_context(|| format!("failed to start `{program}`"))?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");

        let (tx, rx) = mpsc::unbounded_channel();
        let pending: Arc<Pending> = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));

        let stderr_tail = Arc::new(Mutex::new(String::new()));
        {
            let tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    let mut t = tail.lock();
                    t.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if t.len() > 4000 {
                        let cut = t.len() - 4000;
                        let cut = (cut..t.len()).find(|i| t.is_char_boundary(*i)).unwrap_or(0);
                        t.drain(..cut);
                    }
                }
            });
        }

        {
            let pending = pending.clone();
            let alive = alive.clone();
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        log::warn!("acp: non-json line from agent: {line}");
                        continue;
                    };
                    dispatch(msg, &pending, &tx);
                }
                alive.store(false, Ordering::SeqCst);
                for (_, waiter) in pending.lock().drain() {
                    let _ = waiter.send(Err(anyhow!("agent process exited")));
                }
                let stderr_tail = stderr_tail.lock().clone();
                let _ = tx.send(Incoming::Closed { stderr_tail });
            });
        }

        let conn = Arc::new(Self {
            stdin: tokio::sync::Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            alive,
            child: Mutex::new(Some(child)),
            incoming: tx,
        });
        Ok((conn, rx))
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn write(&self, msg: Value) -> Result<()> {
        let mut line = serde_json::to_vec(&msg)?;
        line.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&line).await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);
        if let Err(e) = self
            .write(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await
        {
            self.pending.lock().remove(&id);
            return Err(e);
        }
        rx.await.map_err(|_| anyhow!("agent connection closed"))?
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.write(json!({"jsonrpc": "2.0", "method": method, "params": params})).await
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<()> {
        self.write(json!({"jsonrpc": "2.0", "id": id, "result": result})).await
    }

    pub async fn respond_error(&self, id: Value, code: i64, message: &str) -> Result<()> {
        self.write(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}))
            .await
    }

    /// Queue a marker behind every message received so far.
    pub fn mark(&self, marker: &'static str) {
        let _ = self.incoming.send(Incoming::Marker(marker));
    }

    pub fn kill(&self) {
        if let Some(mut child) = self.child.lock().take() {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &format!("-{pid}")])
                    .status();
            }
            let _ = child.start_kill();
        }
    }
}

impl Drop for AcpConnection {
    fn drop(&mut self) {
        self.kill();
    }
}

fn dispatch(msg: Value, pending: &Pending, tx: &mpsc::UnboundedSender<Incoming>) {
    let method = msg.get("method").and_then(|m| m.as_str()).map(str::to_string);
    let id = msg.get("id").cloned().filter(|v| !v.is_null());
    match (method, id) {
        (Some(method), Some(id)) => {
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            let _ = tx.send(Incoming::Request { id, method, params });
        }
        (Some(method), None) => {
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            let _ = tx.send(Incoming::Notification { method, params });
        }
        (None, Some(id)) => {
            let Some(id) = id.as_u64() else { return };
            let Some(waiter) = pending.lock().remove(&id) else { return };
            let result = match msg.get("error") {
                Some(err) => Err(anyhow!(
                    "{}",
                    err.get("message").and_then(|m| m.as_str()).unwrap_or("agent error")
                )),
                None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = waiter.send(result);
        }
        (None, None) => {}
    }
}
