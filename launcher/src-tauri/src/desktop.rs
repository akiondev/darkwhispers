use super::*;
use std::sync::{Condvar, Mutex as StdMutex};
use std::time::Duration;
use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};

#[derive(Default)]
pub struct LauncherNotices {
    last_version: StdMutex<Option<String>>,
}

pub fn announce_launcher_update(app: &tauri::AppHandle, info: &LauncherUpdate) {
    let _ = app.emit("launcher-update-available", info);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tooltip = info.available.as_ref().map(|v| format!("DarkWhispers · Launcher {v} update available"))
            .unwrap_or_else(|| "DarkWhispers Addons".into());
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    let Some(version) = &info.available else { return; };
    let notices = app.state::<LauncherNotices>();
    let Ok(mut last) = notices.last_version.lock() else { return; };
    if last.as_ref() == Some(version) { return; }
    use tauri_plugin_notification::NotificationExt;
    if app.notification().builder().title("DarkWhispers launcher update")
        .body(format!("Version {version} is ready. Open DarkWhispers to update the launcher. Your addons will not be changed."))
        .show().is_ok() {
        *last = Some(version.clone());
    }
}

pub fn start_launcher_checks(app: tauri::AppHandle, operation: Arc<Mutex<()>>) {
    tauri::async_runtime::spawn(async move {
        // Startup is checked by the UI; continue while minimized to the tray.
        loop {
            tokio::time::sleep(Duration::from_secs(900)).await;
            let _guard = operation.lock().await;
            if let Ok(info) = super::launcher_update_info(&app).await {
                announce_launcher_update(&app, &info);
            }
        }
    });
}

#[derive(Default)]
pub struct AutoWake {
    revision: StdMutex<u64>,
    changed: Condvar,
}

impl AutoWake {
    pub fn notify(&self) {
        if let Ok(mut revision) = self.revision.lock() {
            *revision = revision.wrapping_add(1);
            self.changed.notify_one();
        }
    }
}

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open DarkWhispers", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DarkWhispers", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("DarkWhispers Addons")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => (),
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    Ok(())
}

pub fn start_auto_checks(app: tauri::AppHandle, config: PathBuf, operation: Arc<Mutex<()>>, wake: Arc<AutoWake>) {
    std::thread::spawn(move || {
        let mut seen = 0;
        loop {
            let enabled = core::load_settings(&config).map(|s| s.auto_check_updates).unwrap_or(false);
            if enabled {
                let _guard = operation.blocking_lock();
                // Recheck after the operation lock, so switching off or removing an
                // addon wins over an update that was waiting for another operation. Checks never install addons.
                if core::load_settings(&config).is_ok_and(|s| s.auto_check_updates) {
                    match core::background_status(&config) {
                        Ok(Some(status)) => { let _ = app.emit("addon-update-check", &status); },
                        Ok(None) => (),
                        Err(_) => { let _ = app.emit("addon-check-error", "Background update check unavailable. No addon files were changed."); },
                    }
                }
            }
            let Ok(revision) = wake.revision.lock() else { break; };
            if *revision != seen { seen = *revision; continue; }
            let (revision, _) = if enabled {
                match wake.changed.wait_timeout_while(revision, Duration::from_secs(300), |r| *r == seen) {
                    Ok(value) => value,
                    Err(_) => break,
                }
            } else {
                // No network polling or timer wakeups while automatic checks are off.
                match wake.changed.wait_while(revision, |r| *r == seen) {
                    Ok(value) => { seen = *value; continue; },
                    Err(_) => break,
                }
            };
            seen = *revision;
        }
    });
}

#[tauri::command]
pub async fn set_auto_check_updates(enabled: bool, state: State<'_, AppState>) -> core::Result<()> {
    let config = state.config.clone();
    let operation = state.operation.clone();
    let wake = state.auto_wake.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operation.blocking_lock();
        core::set_auto_check_updates(&config, enabled)?;
        wake.notify();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn window_action(app: tauri::AppHandle, action: String) -> core::Result<()> {
    let window = app.get_webview_window("main").ok_or("Window unavailable")?;
    let result = match action.as_str() {
        "drag" => window.start_dragging(),
        "minimize" => { window.minimize().map_err(|e| e.to_string())?;
            if app.tray_by_id("main-tray").is_some() { window.hide() } else { Ok(()) } },
        "maximize" => if window.is_maximized().map_err(|e| e.to_string())? { window.unmaximize() } else { window.maximize() },
        "close" => window.close(),
        _ => return Err("Unsupported window action".into()),
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_release_checks() -> core::Result<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(core::release_checks).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_resource(resource: String) -> core::Result<()> {
    let url = match resource.as_str() {
        "source" => "https://github.com/akiondev/darkwhispers".to_string(),
        "manual" => "https://github.com/akiondev/darkwhispers/releases/latest".to_string(),
        "verify" => "https://github.com/akiondev/darkwhispers/blob/main/docs/VERIFY.md".to_string(),
        value => {
            let report = value.strip_prefix("report:").ok_or("Unsupported resource")?;
            if !["defender", "clamav", "semgrep", "rustsec", "codeql", "evidence", "source"].contains(&report) {
                return Err("Unsupported report".into());
            }
            format!("https://darkwhispers.akion.se/reports.html?report={report}")
        }
    };
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x08000000);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&url);
        command
    };
    let mut child = command.spawn().map_err(|e| format!("Could not open your browser: {e}"))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}
