//! Silent auto-update. Release builds check the endpoint in `tauri.conf.json`
//! shortly after launch and every few hours, then download and install the new
//! version in the background. The running app is never restarted on its own
//! (agents may be mid-turn): the UI gets an "update-ready" event and offers a
//! restart, and otherwise the new version starts with the next launch.

use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const FIRST_CHECK: Duration = Duration::from_secs(10);
const INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Default)]
pub struct Updates {
    /// Version that is installed on disk and waiting for a restart.
    ready: Mutex<Option<String>>,
    /// Held while checking, so the timer and the menu item never download twice.
    busy: tokio::sync::Mutex<()>,
}

/// Start the background checks. Development builds never update themselves.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if let Err(e) = check(&app).await {
                log::warn!("update check failed: {e}");
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

/// Download and install the latest version if it is newer than the running
/// one. Returns the version waiting for a restart, if any.
async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let updates = app.state::<Updates>();
    let _busy = updates.busy.lock().await;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(updates.ready.lock().clone());
    };
    if updates.ready.lock().as_deref() == Some(update.version.as_str()) {
        return Ok(Some(update.version));
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    *updates.ready.lock() = Some(update.version.clone());
    let _ = app.emit("update-ready", &update.version);
    Ok(Some(update.version))
}

/// "Check for Updates…": the version waiting for a restart, or `None` when
/// the app is up to date.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) {
        return Err("Updates are disabled in development builds".into());
    }
    check(&app).await
}

/// The installed-but-not-running version, for a UI that missed the event.
#[tauri::command]
pub fn update_ready(updates: tauri::State<'_, Updates>) -> Option<String> {
    updates.ready.lock().clone()
}

/// Restart into the installed update (runs the normal exit path first).
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}
