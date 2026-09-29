//! Tauri bindings over `runner-core`. Keep logic in core; this file only maps
//! commands and streams events to the webview.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use runner_core::{AgentDef, Core, Event, Repo, Session, Workspace};
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, RunEvent, State};

type Res<T> = Result<T, String>;

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

/// Events are buffered and flushed to the UI as one batch per frame, so a
/// dozen streaming agents cost one IPC message every ~16ms instead of thousands.
#[derive(Default)]
struct EventBus {
    queue: Mutex<Vec<Event>>,
    channel: Mutex<Option<Channel<Vec<Event>>>>,
}

impl EventBus {
    fn start(self: &Arc<Self>) {
        let bus = self.clone();
        std::thread::Builder::new()
            .name("runner-event-flush".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(16));
                let batch = std::mem::take(&mut *bus.queue.lock());
                if batch.is_empty() {
                    continue;
                }
                if let Some(ch) = bus.channel.lock().as_ref() {
                    let _ = ch.send(batch);
                }
            })
            .expect("spawn flush thread");
    }
}

struct App {
    core: Arc<Core>,
    bus: Arc<EventBus>,
}

#[tauri::command]
fn subscribe(app: State<'_, App>, channel: Channel<Vec<Event>>) {
    *app.bus.channel.lock() = Some(channel);
}

#[tauri::command]
fn list_agents(app: State<'_, App>) -> Vec<AgentDef> {
    app.core.agents.defs()
}

#[tauri::command]
fn list_repos(app: State<'_, App>) -> Res<Vec<Repo>> {
    app.core.store.repos().map_err(err)
}

#[tauri::command]
async fn add_repo(app: State<'_, App>, path: String) -> Res<Repo> {
    app.core.add_repo(&path).await.map_err(err)
}

#[tauri::command]
fn remove_repo(app: State<'_, App>, repo_id: String) -> Res<()> {
    app.core.store.remove_repo(&repo_id).map_err(err)
}

#[tauri::command]
fn list_workspaces(app: State<'_, App>) -> Res<Vec<Workspace>> {
    app.core.store.workspaces().map_err(err)
}

#[tauri::command]
async fn create_workspace(app: State<'_, App>, repo_id: String) -> Res<Workspace> {
    app.core.create_workspace(&repo_id).await.map_err(err)
}

#[tauri::command]
fn rename_workspace(app: State<'_, App>, workspace_id: String, title: String) -> Res<()> {
    app.core.rename_workspace(&workspace_id, &title).map_err(err)
}

#[tauri::command]
fn set_workspace_unread(app: State<'_, App>, workspace_id: String, unread: bool) -> Res<()> {
    app.core.store.set_workspace_unread(&workspace_id, unread).map_err(err)
}

#[tauri::command]
fn list_all_workspaces(app: State<'_, App>) -> Res<Vec<Workspace>> {
    app.core.store.all_workspaces().map_err(err)
}

#[tauri::command]
async fn restore_workspace(app: State<'_, App>, workspace_id: String) -> Res<Workspace> {
    app.core.restore_workspace(&workspace_id).await.map_err(err)
}

#[tauri::command]
async fn archive_workspace(app: State<'_, App>, workspace_id: String) -> Res<()> {
    app.core.archive_workspace(&workspace_id).await.map_err(err)
}

#[tauri::command]
fn repo_config(app: State<'_, App>, workspace_id: String) -> Res<Value> {
    let config = app.core.repo_config(&workspace_id).map_err(err)?;
    serde_json::to_value(config).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sessions(app: State<'_, App>, workspace_id: String) -> Res<Vec<Session>> {
    app.core.store.sessions(&workspace_id).map_err(err)
}

#[tauri::command]
async fn create_session(
    app: State<'_, App>,
    workspace_id: String,
    agent_id: String,
    model: Option<String>,
    effort: Option<String>,
) -> Res<Session> {
    app.core.create_session(&workspace_id, &agent_id, model, effort).map_err(err)
}

/// Start a chat's agent without prompting (e.g. to show its model options).
#[tauri::command]
async fn connect_session(app: State<'_, App>, session_id: String) -> Res<()> {
    app.core.agents.warm_up(&session_id);
    Ok(())
}

#[tauri::command]
fn delete_session(app: State<'_, App>, session_id: String) -> Res<()> {
    app.core.delete_session(&session_id).map_err(err)
}

#[tauri::command]
fn session_events(app: State<'_, App>, session_id: String) -> Res<Vec<Value>> {
    app.core.store.events(&session_id).map_err(err)
}

#[tauri::command]
async fn send_prompt(app: State<'_, App>, session_id: String, text: String) -> Res<()> {
    app.core.agents.prompt(&session_id, text).map_err(err)
}

#[tauri::command]
async fn cancel_prompt(app: State<'_, App>, session_id: String) -> Res<()> {
    app.core.agents.cancel(&session_id).await.map_err(err)
}

#[tauri::command]
async fn respond_permission(
    app: State<'_, App>,
    session_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Res<()> {
    app.core.agents.respond_permission(&session_id, &request_id, option_id).await.map_err(err)
}

#[tauri::command]
async fn set_config(app: State<'_, App>, session_id: String, config_id: String, value: Value) -> Res<()> {
    app.core.agents.set_config(&session_id, &config_id, value).await.map_err(err)
}

#[tauri::command]
async fn set_plan_mode(app: State<'_, App>, session_id: String, plan: bool) -> Res<()> {
    app.core.agents.set_plan_mode(&session_id, plan).await.map_err(err)
}

#[tauri::command]
async fn changed_files(app: State<'_, App>, workspace_id: String) -> Res<Value> {
    let files = app.core.changed_files(&workspace_id).await.map_err(err)?;
    serde_json::to_value(files).map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_diff(app: State<'_, App>, workspace_id: String, path: String) -> Res<String> {
    app.core.file_diff(&workspace_id, &path).await.map_err(err)
}

#[tauri::command]
async fn revert_file(app: State<'_, App>, workspace_id: String, path: String) -> Res<()> {
    app.core.revert_file(&workspace_id, &path).await.map_err(err)
}

#[tauri::command]
async fn commit_all(app: State<'_, App>, workspace_id: String, message: String) -> Res<()> {
    app.core.commit_all(&workspace_id, &message).await.map_err(err)
}

#[tauri::command]
async fn push(app: State<'_, App>, workspace_id: String) -> Res<()> {
    app.core.push(&workspace_id).await.map_err(err)
}

#[tauri::command]
async fn pr_status(app: State<'_, App>, workspace_id: String) -> Res<Option<Value>> {
    app.core.pr_status(&workspace_id).await.map_err(err)
}

#[tauri::command]
async fn create_pr(app: State<'_, App>, workspace_id: String, title: String, body: String) -> Res<String> {
    app.core.create_pr(&workspace_id, &title, &body).await.map_err(err)
}

#[tauri::command]
fn model_catalogs(app: State<'_, App>) -> Value {
    serde_json::to_value(app.core.catalogs()).unwrap_or_default()
}

#[tauri::command]
async fn refresh_catalog(app: State<'_, App>, agent_id: String) -> Res<Value> {
    let c = app.core.refresh_catalog(&agent_id).await.map_err(err)?;
    serde_json::to_value(c).map_err(|e| e.to_string())
}

#[tauri::command]
fn cached_prs(app: State<'_, App>) -> std::collections::HashMap<String, Value> {
    app.core.cached_prs()
}

#[tauri::command]
fn refresh_prs(app: State<'_, App>) {
    app.core.refresh_prs();
}

#[tauri::command]
async fn merge_pr(app: State<'_, App>, workspace_id: String) -> Res<()> {
    app.core.merge_pr(&workspace_id).await.map_err(err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn terminal_open(
    app: State<'_, App>,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    command: Option<String>,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<bool>,
) -> Res<()> {
    app.core
        .open_terminal(
            &workspace_id,
            &terminal_id,
            cols,
            rows,
            command.as_deref(),
            move |bytes| {
                let _ = on_data.send(InvokeResponseBody::Raw(bytes));
            },
            move || {
                let _ = on_exit.send(true);
            },
        )
        .map_err(err)
}

#[tauri::command]
fn terminal_write(app: State<'_, App>, terminal_id: String, data: String) -> Res<()> {
    app.core.terminals.write(&terminal_id, data.as_bytes()).map_err(err)
}

#[tauri::command]
fn terminal_resize(app: State<'_, App>, terminal_id: String, cols: u16, rows: u16) -> Res<()> {
    app.core.terminals.resize(&terminal_id, cols, rows).map_err(err)
}

#[tauri::command]
fn terminal_kill(app: State<'_, App>, terminal_id: String) {
    app.core.terminals.kill(&terminal_id);
}

#[tauri::command]
fn get_settings(app: State<'_, App>) -> runner_core::setup::Settings {
    app.core.settings()
}

#[tauri::command]
fn save_settings(app: State<'_, App>, settings: runner_core::setup::Settings) -> Res<()> {
    app.core.save_settings(&settings).map_err(err)
}

#[tauri::command]
async fn detect_agents() -> Vec<runner_core::setup::AgentStatus> {
    let (a, b, c) = tokio::join!(
        runner_core::setup::detect("claude"),
        runner_core::setup::detect("codex"),
        runner_core::setup::detect("opencode"),
    );
    [a, b, c].into_iter().flatten().collect()
}

/// Run an install/login command in a pty so interactive flows work.
#[tauri::command]
fn setup_terminal_open(
    app: State<'_, App>,
    terminal_id: String,
    cols: u16,
    rows: u16,
    command: String,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<bool>,
) -> Res<()> {
    app.core
        .open_home_terminal(
            &terminal_id,
            cols,
            rows,
            &command,
            move |bytes| {
                let _ = on_data.send(InvokeResponseBody::Raw(bytes));
            },
            move || {
                let _ = on_exit.send(true);
            },
        )
        .map_err(err)
}

/// Open a path in Finder or in a named app (e.g. "Visual Studio Code", "Cursor").
#[tauri::command]
fn open_path(path: String, app_name: Option<String>) -> Res<()> {
    let mut cmd = std::process::Command::new("open");
    if let Some(name) = app_name {
        cmd.args(["-a", &name]);
    }
    let status = cmd.arg(&path).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| format!("could not open {path}"))
}

/// Default macOS menus plus "Settings…" (⌘,) in the app menu.
fn install_menu(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
    let handle = app.handle();
    let menu = Menu::default(handle)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let settings = MenuItem::with_id(handle, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
        app_menu.insert(&PredefinedMenuItem::separator(handle)?, 1)?;
        app_menu.insert(&settings, 2)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "settings" {
            let _ = app.emit("open-settings", ());
        }
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let bus = Arc::new(EventBus::default());
            bus.start();
            let sink_bus = bus.clone();
            let core = Core::new(&data_dir, Arc::new(move |e| sink_bus.queue.lock().push(e)))?;
            let poller = core.clone();
            tauri::async_runtime::spawn(async move { poller.start_pr_poller() });
            app.manage(App { core, bus });
            install_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            subscribe,
            list_agents,
            list_repos,
            add_repo,
            remove_repo,
            list_workspaces,
            create_workspace,
            archive_workspace,
            list_all_workspaces,
            rename_workspace,
            set_workspace_unread,
            restore_workspace,
            repo_config,
            list_sessions,
            create_session,
            delete_session,
            connect_session,
            session_events,
            send_prompt,
            cancel_prompt,
            respond_permission,
            set_config,
            set_plan_mode,
            changed_files,
            file_diff,
            revert_file,
            commit_all,
            push,
            pr_status,
            create_pr,
            merge_pr,
            cached_prs,
            model_catalogs,
            refresh_catalog,
            refresh_prs,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_kill,
            open_path,
            get_settings,
            save_settings,
            detect_agents,
            setup_terminal_open,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<App>().core.shutdown();
        }
    });
}
