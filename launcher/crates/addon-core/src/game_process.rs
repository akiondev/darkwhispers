use super::*;

#[cfg(windows)]
pub fn ensure_game_closed() -> Result<()> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
    };
    // Enumerate names only. No process memory, injection, or elevated access.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE { return Err("Could not check whether WoW is running. Try again.".into()); }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = Process32FirstW(snapshot, &mut entry);
        let mut running = false;
        while found != 0 {
            let length = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..length]).to_ascii_lowercase();
            if matches!(name.as_str(), "wow.exe" | "wowt.exe" | "wowb.exe") { running = true; break; }
            found = Process32NextW(snapshot, &mut entry);
        }
        let failed = !running && GetLastError() != ERROR_NO_MORE_FILES;
        CloseHandle(snapshot);
        if running { return Err("Close World of Warcraft before changing addons. Then try again.".into()); }
        if failed { return Err("Could not verify that WoW is closed. Try again.".into()); }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn ensure_game_closed() -> Result<()> {
    // Linux Wine clients expose the Windows executable in /proc command lines.
    for entry in fs::read_dir("/proc").map_err(|e| error("Could not check running applications", e))?.flatten() {
        if !entry.file_name().to_string_lossy().bytes().all(|c| c.is_ascii_digit()) { continue; }
        if let Ok(bytes) = fs::read(entry.path().join("cmdline")) {
            if bytes.split(|c| *c == 0).any(|part| {
                let name = String::from_utf8_lossy(part).replace('\\', "/").to_ascii_lowercase();
                matches!(name.rsplit('/').next().unwrap_or(""), "wow.exe" | "wowt.exe" | "wowb.exe")
            }) { return Err("Close World of Warcraft before changing addons. Then try again.".into()); }
        }
    }
    Ok(())
}
