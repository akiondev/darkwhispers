#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use darkwhispers_core as core;
use std::{
    path::PathBuf,
    sync::Arc,
};
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

mod desktop;

struct AppState {
    config: PathBuf,
    operation: Arc<Mutex<()>>,
    auto_wake: Arc<desktop::AutoWake>,
}

#[tauri::command]
async fn get_status(
    check_updates: Option<bool>,
    state: State<'_, AppState>,
) -> core::Result<core::Status> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.blocking_lock();
        core::status(&config, check_updates.unwrap_or(true))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_game(app: tauri::AppHandle, state: State<'_, AppState>) -> core::Result<bool> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.blocking_lock();
        let folder = app
            .dialog()
            .file()
            .set_title("Choose your World of Warcraft folder")
            .blocking_pick_folder();
        if let Some(folder) = folder {
            let path = folder.into_path().map_err(|_| "Choose a local folder.")?;
            core::select_game(&config, &path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_addon(id: String, state: State<'_, AppState>) -> core::Result<()> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.blocking_lock();
        core::install(&config, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_addon(id: String, state: State<'_, AppState>) -> core::Result<()> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.blocking_lock();
        core::remove(&config, &id).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct LauncherUpdate {
    current: String,
    available: Option<String>,
    supported: bool,
}

#[cfg(windows)]
fn validate_launcher_update(update: &tauri_plugin_updater::Update) -> core::Result<()> {
    let expected = format!("https://github.com/akiondev/darkwhispers/releases/download/v{0}/DarkWhispers-Addons-{0}-windows-x64-setup.exe", update.version);
    if update.download_url.as_str() != expected {
        return Err("The launcher update URL is not an official immutable GitHub release.".into());
    }
    Ok(())
}

#[tauri::command]
async fn check_launcher_update(app: tauri::AppHandle, state: State<'_, AppState>) -> core::Result<LauncherUpdate> {
    let _guard = state.operation.lock().await;
    #[cfg(windows)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app.updater_builder().timeout(std::time::Duration::from_secs(15))
            .build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        if let Some(update) = &update { validate_launcher_update(update)?; }
        Ok(LauncherUpdate { current: env!("CARGO_PKG_VERSION").into(), available: update.map(|u| u.version), supported: true })
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(LauncherUpdate { current: env!("CARGO_PKG_VERSION").into(), available: None, supported: false })
    }
}

#[tauri::command]
async fn install_launcher_update(app: tauri::AppHandle, state: State<'_, AppState>) -> core::Result<()> {
    let _guard = state.operation.lock().await;
    #[cfg(windows)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app.updater_builder().timeout(std::time::Duration::from_secs(120))
            .build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
            .ok_or("Your launcher is already up to date.")?;
        validate_launcher_update(&update)?;
        let mut downloaded = 0u64;
        let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
        update.download_and_install(|chunk, total| {
            downloaded += chunk as u64;
            if last.elapsed().as_millis() >= 150 {
                let _ = app.emit("launcher-download", serde_json::json!({"downloaded":downloaded,"total":total}));
                last = std::time::Instant::now();
            }
        }, || { let _ = app.emit("launcher-installing", ()); }).await.map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = app; Err("Install the latest Linux .deb from darkwhispers.akion.se.".into()) }
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        desktop::show_main(app);
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let config = app.path().app_config_dir()?;
            let operation = Arc::new(Mutex::new(()));
            let auto_wake = Arc::new(desktop::AutoWake::default());
            app.manage(AppState { config: config.clone(), operation: operation.clone(), auto_wake: auto_wake.clone() });
            // If a desktop has no usable tray, minimization stays in its taskbar.
            let _ = desktop::create_tray(app);
            desktop::start_auto_updates(app.handle().clone(), config, operation, auto_wake);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            choose_game,
            install_addon,
            remove_addon,
            desktop::set_auto_update,
            desktop::window_action,
            desktop::get_release_checks,
            desktop::open_resource,
            check_launcher_update,
            install_launcher_update
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(false))
                && window.app_handle().tray_by_id("main-tray").is_some()
                && window.is_minimized().unwrap_or(false) {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("DarkWhispers Addons could not start");
}
