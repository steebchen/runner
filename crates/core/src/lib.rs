//! Runner core: repos, git worktree workspaces, ACP agent sessions, terminals
//! and GitHub integration. Deliberately free of any UI framework so it can back
//! the desktop app, a CLI or a headless daemon.

pub mod acp;
pub mod agent;
pub mod catalog;
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

/// Stash message used to keep a workspace's uncommitted work while archived.
fn archive_marker(workspace_id: &str) -> String {
    format!("runner-archive:{workspace_id}")
}

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
    /// Last PR info sent per workspace, to only emit changes.
    prs: parking_lot::Mutex<std::collections::HashMap<String, Value>>,
    pr_refresh: tokio::sync::Notify,
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
        Ok(Arc::new(Self {
            store,
            agents,
            terminals: Default::default(),
            emitter,
            prs: Default::default(),
            pr_refresh: tokio::sync::Notify::new(),
        }))
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
            archived_at: None,
            unread: false,
        };
        self.store.add_workspace(&ws)?;

        // Fetching and checking out can take a while on big repos; return right
        // away and let the UI show progress via WorkspaceStatus events.
        self.spawn_worktree_setup(ws.clone(), repo, true);
        Ok(ws)
    }

    /// Create (or re-create) the worktree in the background, then run setup.
    fn spawn_worktree_setup(self: &Arc<Self>, ws: Workspace, repo: Repo, new_branch: bool) {
        let this = self.clone();
        tokio::spawn(async move {
            let repo_path = PathBuf::from(&repo.path);
            let status = match this.prepare_worktree(&ws, &repo_path, new_branch).await {
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
    }

    /// Bring an archived workspace back: check its branch out into a fresh
    /// worktree. Chat history is kept, so sessions can continue.
    pub async fn restore_workspace(self: &Arc<Self>, workspace_id: &str) -> Result<Workspace> {
        let mut ws = self.store.workspace(workspace_id)?;
        if ws.status != "archived" {
            bail!("workspace is not archived");
        }
        let repo = self.store.repo(&ws.repo_id)?;
        if !git::branch_exists(Path::new(&repo.path), &ws.branch).await {
            bail!("branch `{}` no longer exists, so this workspace can't be restored", ws.branch);
        }
        if Path::new(&ws.path).exists() {
            bail!("{} already exists; move it away and try again", ws.path);
        }
        self.store.set_workspace_status(&ws.id, "creating")?;
        self.store.set_archived_at(&ws.id, None)?;
        ws.status = "creating".into();
        ws.archived_at = None;
        self.spawn_worktree_setup(ws.clone(), repo, false);
        Ok(ws)
    }

    fn set_status(&self, workspace_id: &str, status: &str) {
        let _ = self.store.set_workspace_status(workspace_id, status);
        self.emitter.emit(Event::WorkspaceStatus { workspace_id: workspace_id.into(), status: status.into() });
    }

    /// Create the worktree and copy configured files. Returns the setup script, if any.
    async fn prepare_worktree(&self, ws: &Workspace, repo_path: &Path, new_branch: bool) -> Result<Option<String>> {
        let path = PathBuf::from(&ws.path);
        tokio::fs::create_dir_all(path.parent().unwrap()).await?;
        if new_branch {
            git::create_worktree(repo_path, &path, &ws.branch, &ws.base_branch).await?;
        } else {
            git::add_worktree(repo_path, &path, &ws.branch).await?;
            if let Some(stash) = git::stash_find(repo_path, &archive_marker(&ws.id)).await {
                if let Err(e) = git::stash_pop(&path, &stash).await {
                    self.emitter.emit(Event::ScriptOutput {
                        workspace_id: ws.id.clone(),
                        data: format!("Couldn't re-apply the changes saved when archiving ({e:#}). They're kept in `git stash` as {stash}.\n"),
                    });
                }
            }
        }
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
        let path = Path::new(&ws.path);
        if path.exists() {
            if let Some(script) = load_config(path).scripts.archive {
                self.run_script(&ws, &repo.path, &script).await;
            }
            // Never throw away work: uncommitted changes go to a stash that
            // restore re-applies. If that fails, don't archive.
            git::stash_save(path, &archive_marker(&ws.id)).await?;
            let trash = path.parent().and_then(Path::parent).unwrap_or(path).join(".trash");
            git::discard_worktree(Path::new(&repo.path), path, &trash).await?;
        }
        self.store.set_workspace_status(&ws.id, "archived")?;
        self.store.set_archived_at(&ws.id, Some(now()))?;
        Ok(())
    }

    /// User-chosen title; replaces any auto-generated one.
    pub fn rename_workspace(&self, workspace_id: &str, title: &str) -> Result<()> {
        let title = title.trim();
        self.store.set_workspace_title(workspace_id, title)?;
        self.emitter.emit(Event::WorkspaceTitle { workspace_id: workspace_id.into(), title: title.into() });
        Ok(())
    }

    pub fn repo_config(&self, workspace_id: &str) -> Result<RepoConfig> {
        Ok(load_config(Path::new(&self.store.workspace(workspace_id)?.path)))
    }

    // ---- sessions ----

    /// New chat. `model`/`effort` are applied once the agent starts; plan
    /// mode follows the user's default.
    pub fn create_session(
        &self,
        workspace_id: &str,
        agent_id: &str,
        model: Option<String>,
        effort: Option<String>,
    ) -> Result<Session> {
        self.agents.def(agent_id)?;
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.into(),
            agent_id: agent_id.into(),
            acp_session_id: None,
            title: String::new(),
            created_at: now(),
            model: model.clone(),
            effort: effort.clone(),
        };
        self.store.add_session(&session)?;
        self.agents.preset(&session.id, self.settings().plan_by_default, model, effort)?;
        self.agents.warm_up(&session.id);
        Ok(session)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.agents.close(session_id);
        self.store.delete_session(session_id)
    }

    // ---- model catalog ----

    pub fn catalogs(&self) -> std::collections::HashMap<String, catalog::Catalog> {
        self.agents
            .defs()
            .into_iter()
            .filter_map(|d| catalog::load(&self.store, &d.id).map(|c| (d.id, c)))
            .collect()
    }

    /// Discover an agent's models by starting it briefly (no prompt is sent).
    pub async fn refresh_catalog(&self, agent_id: &str) -> Result<catalog::Catalog> {
        let def = self.agents.def(agent_id)?;
        let c = catalog::discover(&def).await?;
        catalog::save(&self.store, agent_id, &c);
        Ok(c)
    }

    // ---- pull requests ----

    /// Poll GitHub for the PRs of every active workspace: once a minute, or
    /// right away after `refresh_prs`. Must be called inside a tokio runtime.
    pub fn start_pr_poller(self: &Arc<Self>) {
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                this.poll_prs().await;
                tokio::select! {
                    _ = this.pr_refresh.notified() => {}
                    _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                }
            }
        });
    }

    pub fn refresh_prs(&self) {
        self.pr_refresh.notify_one();
    }

    /// Current PR info for all workspaces (for a UI that just (re)loaded).
    pub fn cached_prs(&self) -> std::collections::HashMap<String, Value> {
        self.prs.lock().clone()
    }

    pub async fn poll_prs(&self) {
        let Ok(workspaces) = self.store.workspaces() else { return };
        let Ok(repos) = self.store.repos() else { return };
        for repo in repos {
            let mine: Vec<&Workspace> = workspaces.iter().filter(|w| w.repo_id == repo.id).collect();
            if mine.is_empty() {
                continue;
            }
            // Not a GitHub repo, gh missing or signed out: just show nothing.
            let Ok(prs) = forge::list_prs(Path::new(&repo.path)).await else { continue };
            for ws in mine {
                let pr = prs
                    .iter()
                    .find(|p| p["headRefName"] == ws.branch.as_str())
                    .cloned()
                    .unwrap_or(Value::Null);
                let changed = self.prs.lock().get(&ws.id) != Some(&pr);
                if changed {
                    self.prs.lock().insert(ws.id.clone(), pr.clone());
                    self.emitter.emit(Event::WorkspacePr { workspace_id: ws.id.clone(), pr });
                }
            }
        }
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
        let url = forge::create_pr(&path, &ws.base_branch, title, body).await?;
        self.refresh_prs();
        Ok(url)
    }

    pub async fn push(&self, workspace_id: &str) -> Result<()> {
        let (ws, path) = self.ws_path(workspace_id)?;
        git::push(&path, &ws.branch).await?;
        self.refresh_prs();
        Ok(())
    }

    pub async fn merge_pr(&self, workspace_id: &str) -> Result<()> {
        let (ws, path) = self.ws_path(workspace_id)?;
        forge::merge_pr(&path, &ws.branch).await?;
        self.refresh_prs();
        Ok(())
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
