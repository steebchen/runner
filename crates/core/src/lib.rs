//! Runner core: repos, git worktree workspaces, ACP agent sessions, terminals
//! and GitHub integration. Deliberately free of any UI framework so it can back
//! the desktop app, a CLI or a headless daemon.

pub mod acp;
pub mod agent;
pub mod env;
pub mod events;
pub mod forge;
pub mod git;
pub mod pty;
pub mod setup;
pub mod title;
pub mod store;
pub mod workspace;

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use serde_json::Value;
use tokio::io::AsyncReadExt;

pub use agent::{builtin_agents, AgentDef, Agents};
pub use events::{Event, Sink};
pub use store::{Repo, Session, Store, Workspace};

use crate::env::{tokio_command, user_shell};
use crate::store::now;
use crate::setup::Settings;
use crate::workspace::{load_config, pick_name, RepoConfig};

/// Persists transcript events, then forwards everything to the UI sink.
#[derive(Clone)]
pub struct Emitter {
    store: Arc<Store>,
    sink: Sink,
}

impl Emitter {
    pub fn emit(&self, event: Event) {
        if let Some(session_id) = event.persist_key() {
            if let Ok(v) = serde_json::to_value(&event) {
                self.store.append_event(session_id, v);
            }
        }
        (self.sink)(event);
    }
}

pub struct Core {
    pub store: Arc<Store>,
    pub agents: Arc<Agents>,
    pub terminals: pty::Terminals,
    emitter: Emitter,
}

impl Core {
    pub fn new(data_dir: &Path, sink: Sink) -> Result<Arc<Self>> {
        let store = Arc::new(Store::open(&data_dir.join("runner.sqlite"))?);
        let emitter = Emitter { store: store.clone(), sink };
        let agents = Arc::new(Agents::new(store.clone(), emitter.clone()));
        // Warm the login-shell env capture off the UI's critical path.
        std::thread::spawn(|| {
            env::login_env();
        });
        Ok(Arc::new(Self { store, agents, terminals: Default::default(), emitter }))
    }

    pub fn shutdown(&self) {
        self.agents.shutdown();
        self.terminals.kill_all();
    }

    // ---- settings ----

    pub fn settings(&self) -> Settings {
        self.store
            .setting("settings")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        self.store.set_setting("settings", &serde_json::to_string(settings)?)
    }

    // ---- repos ----

    pub async fn add_repo(&self, path: &str) -> Result<Repo> {
        let root = git::repo_root(Path::new(path))
            .await
            .map_err(|_| anyhow!("{path} is not a git repository"))?;
        if let Some(existing) = self.store.repo_by_path(&root)? {
            return Ok(existing);
        }
        let repo = Repo {
            id: uuid::Uuid::new_v4().to_string(),
            name: Path::new(&root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            default_branch: git::default_branch(Path::new(&root)).await,
            path: root,
        };
        self.store.add_repo(&repo)?;
        Ok(repo)
    }

    // ---- workspaces ----

    pub async fn create_workspace(self: &Arc<Self>, repo_id: &str) -> Result<Workspace> {
        let repo = self.store.repo(repo_id)?;
        let repo_path = PathBuf::from(&repo.path);
        let settings = self.settings();
        let root = PathBuf::from(&settings.workspaces_root).join(&repo.name);
        let prefix = settings.branch_prefix.trim();
        let taken = self.store.workspace_names(repo_id)?;
        let mut name = pick_name(&taken, now() as u64);
        let mut n = 2;
        while git::git(&repo_path, &["rev-parse", "--verify", "--quiet", &format!("{prefix}{name}")])
            .await
            .is_ok()
            || root.join(&name).exists()
        {
            name = format!("{}-{n}", pick_name(&taken, now() as u64));
            n += 1;
        }
        let path = root.join(&name);
        let ws = Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            repo_id: repo.id.clone(),
            branch: format!("{prefix}{name}"),
            name,
            base_branch: repo.default_branch.clone(),
            path: path.to_string_lossy().to_string(),
            status: "creating".into(),
            created_at: now(),
            title: String::new(),
        };
        self.store.add_workspace(&ws)?;

        // Fetching and checking out can take a while on big repos; return right
        // away and let the UI show progress via WorkspaceStatus events.
        let this = self.clone();
        let ws_bg = ws.clone();
        tokio::spawn(async move {
            let ws = ws_bg;
            let status = match this.prepare_worktree(&ws, &repo_path).await {
                Ok(Some(setup)) => {
                    this.set_status(&ws.id, "setting_up");
                    let ok = this.run_script(&ws, &repo.path, &setup).await;
                    if ok { "ready" } else { "setup_failed" }
                }
                Ok(None) => "ready",
                Err(e) => {
                    this.emitter.emit(Event::ScriptOutput {
                        workspace_id: ws.id.clone(),
                        data: format!("Failed to create worktree: {e:#}\n"),
                    });
                    "failed"
                }
            };
            this.set_status(&ws.id, status);
        });
        Ok(ws)
    }

    fn set_status(&self, workspace_id: &str, status: &str) {
        let _ = self.store.set_workspace_status(workspace_id, status);
        self.emitter.emit(Event::WorkspaceStatus { workspace_id: workspace_id.into(), status: status.into() });
    }

    /// Create the worktree and copy configured files. Returns the setup script, if any.
    async fn prepare_worktree(&self, ws: &Workspace, repo_path: &Path) -> Result<Option<String>> {
        let path = PathBuf::from(&ws.path);
        tokio::fs::create_dir_all(path.parent().unwrap()).await?;
        git::create_worktree(repo_path, &path, &ws.branch, &ws.base_branch).await?;
        let config = load_config(&path);
        for file in &config.copy {
            let (from, to) = (repo_path.join(file), path.join(file));
            if from.exists() && !to.exists() {
                if let Some(dir) = to.parent() {
                    let _ = tokio::fs::create_dir_all(dir).await;
                }
                let _ = tokio::fs::copy(&from, &to).await;
            }
        }
        Ok(config.scripts.setup)
    }

    /// Run a repo script inside the worktree, streaming output as `ScriptOutput`.
    async fn run_script(&self, ws: &Workspace, repo_path: &str, script: &str) -> bool {
        let emit = |data: String| {
            self.emitter.emit(Event::ScriptOutput { workspace_id: ws.id.clone(), data })
        };
        emit(format!("$ {script}\n"));
        let child = tokio_command(&user_shell())
            .args(["-lc", script])
            .current_dir(&ws.path)
            .env("RUNNER_ROOT_PATH", repo_path)
            .env("RUNNER_WORKSPACE_NAME", &ws.name)
            .env("RUNNER_WORKSPACE_PATH", &ws.path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                emit(format!("failed to start: {e}\n"));
                return false;
            }
        };
        let (mut out, mut err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let (mut b1, mut b2) = (vec![0u8; 16384], vec![0u8; 16384]);
        let (mut out_done, mut err_done) = (false, false);
        while !(out_done && err_done) {
            tokio::select! {
                r = out.read(&mut b1), if !out_done => match r {
                    Ok(0) | Err(_) => out_done = true,
                    Ok(n) => emit(String::from_utf8_lossy(&b1[..n]).into_owned()),
                },
                r = err.read(&mut b2), if !err_done => match r {
                    Ok(0) | Err(_) => err_done = true,
                    Ok(n) => emit(String::from_utf8_lossy(&b2[..n]).into_owned()),
                },
            }
        }
        let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
        emit(if ok { "\n✓ done\n".into() } else { "\n✗ script failed\n".into() });
        ok
    }

    pub async fn archive_workspace(&self, workspace_id: &str) -> Result<()> {
        let ws = self.store.workspace(workspace_id)?;
        let repo = self.store.repo(&ws.repo_id)?;
        for s in self.store.sessions(&ws.id)? {
            self.agents.close(&s.id);
        }
        if Path::new(&ws.path).exists() {
            if let Some(script) = load_config(Path::new(&ws.path)).scripts.archive {
                self.run_script(&ws, &repo.path, &script).await;
            }
            git::remove_worktree(Path::new(&repo.path), Path::new(&ws.path)).await?;
        }
        self.store.set_workspace_status(&ws.id, "archived")?;
        Ok(())
    }

    pub fn repo_config(&self, workspace_id: &str) -> Result<RepoConfig> {
        Ok(load_config(Path::new(&self.store.workspace(workspace_id)?.path)))
    }

    // ---- sessions ----

    pub fn create_session(&self, workspace_id: &str, agent_id: &str) -> Result<Session> {
        self.agents.def(agent_id)?;
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            agent_id: agent_id.into(),
            acp_session_id: None,
            title: String::new(),
            created_at: now(),
        };
        self.store.add_session(&session)?;
        self.agents.warm_up(&session.id);
        Ok(session)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.agents.close(session_id);
        self.store.delete_session(session_id)
    }

    // ---- git / review ----

    fn ws_path(&self, workspace_id: &str) -> Result<(Workspace, PathBuf)> {
        let ws = self.store.workspace(workspace_id)?;
        let path = PathBuf::from(&ws.path);
        Ok((ws, path))
    }

    pub async fn changed_files(&self, workspace_id: &str) -> Result<Vec<git::ChangedFile>> {
        let (ws, path) = self.ws_path(workspace_id)?;
        git::changed_files(&path, &ws.base_branch).await
    }

    pub async fn file_diff(&self, workspace_id: &str, file: &str) -> Result<String> {
        let (ws, path) = self.ws_path(workspace_id)?;
        git::file_diff(&path, &ws.base_branch, file).await
    }

    pub async fn revert_file(&self, workspace_id: &str, file: &str) -> Result<()> {
        let (ws, path) = self.ws_path(workspace_id)?;
        git::revert_file(&path, &ws.base_branch, file).await
    }

    pub async fn commit_all(&self, workspace_id: &str, message: &str) -> Result<()> {
        let (_, path) = self.ws_path(workspace_id)?;
        if !git::has_uncommitted(&path).await? {
            bail!("nothing to commit");
        }
        git::commit_all(&path, message).await
    }

    pub async fn pr_status(&self, workspace_id: &str) -> Result<Option<Value>> {
        let (ws, path) = self.ws_path(workspace_id)?;
        forge::pr_status(&path, &ws.branch).await
    }

    /// Commit pending changes (using the title as message), push, open a PR.
    pub async fn create_pr(&self, workspace_id: &str, title: &str, body: &str) -> Result<String> {
        let (ws, path) = self.ws_path(workspace_id)?;
        if git::has_uncommitted(&path).await? {
            git::commit_all(&path, title).await?;
        }
        git::push(&path, &ws.branch).await?;
        forge::create_pr(&path, &ws.base_branch, title, body).await
    }

    pub async fn push(&self, workspace_id: &str) -> Result<()> {
        let (ws, path) = self.ws_path(workspace_id)?;
        git::push(&path, &ws.branch).await
    }

    pub async fn merge_pr(&self, workspace_id: &str) -> Result<()> {
        let (ws, path) = self.ws_path(workspace_id)?;
        forge::merge_pr(&path, &ws.branch).await
    }

    // ---- terminals ----

    #[allow(clippy::too_many_arguments)]
    pub fn open_terminal(
        &self,
        workspace_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
        command: Option<&str>,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<()> {
        let (_, path) = self.ws_path(workspace_id)?;
        self.terminals.spawn(terminal_id, &path, cols, rows, command, on_output, on_exit)
    }

    /// Terminal outside any workspace (used for agent install/login flows).
    pub fn open_home_terminal(
        &self,
        terminal_id: &str,
        cols: u16,
        rows: u16,
        command: &str,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<()> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        self.terminals.spawn(terminal_id, &home, cols, rows, Some(command), on_output, on_exit)
    }
}
