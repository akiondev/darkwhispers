#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use darkwhispers_core as core;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    config: PathBuf,
    operation: Arc<Mutex<()>>,
}

#[tauri::command]
async fn get_status(
    check_updates: Option<bool>,
    state: State<'_, AppState>,
) -> core::Result<core::Status> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation
            .lock()
            .map_err(|_| "An operation was interrupted. Restart the launcher.")?;
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
        let _guard = operation
            .lock()
            .map_err(|_| "An operation was interrupted. Restart the launcher.")?;
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
        let _guard = operation
            .lock()
            .map_err(|_| "An operation was interrupted. Restart the launcher.")?;
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
        let _guard = operation
            .lock()
            .map_err(|_| "An operation was interrupted. Restart the launcher.")?;
        core::remove(&config, &id).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState {
                config: app.path().app_config_dir()?,
                operation: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            choose_game,
            install_addon,
            remove_addon
        ])
        .run(tauri::generate_context!())
        .expect("DarkWhispers Addons could not start");
}
