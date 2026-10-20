use super::*;

#[derive(Serialize, Deserialize)]
struct PendingInstall {
    schema: u32,
    backup_dir: Option<String>,
}

fn journal_path(addons: &Path, id: &str) -> Result<PathBuf> {
    validate_id(id)?;
    let folder = addons.join(".darkwhispers-pending");
    reject_link(&folder)?;
    let path = folder.join(format!("{id}.json"));
    reject_link(&path)?;
    Ok(path)
}

fn backup_path(addons: &Path, id: &str, name: &str) -> Result<PathBuf> {
    if !name.starts_with(&format!("{id}-")) || name.len() > 128
        || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Invalid recovery record. No addon files were changed.".into());
    }
    let root = addons.join(".darkwhispers-backups");
    reject_link(&root)?;
    let wrapper = root.join(name);
    reject_link(&wrapper)?;
    let path = wrapper.join(id);
    reject_link(&path)?;
    reject_link(&path.join(format!("{id}.toc")))?;
    Ok(path)
}

fn recognized(path: &Path, id: &str) -> Result<bool> {
    reject_link(path)?;
    let toc = path.join(format!("{id}.toc"));
    reject_link(&toc)?;
    Ok(path.is_dir() && toc.is_file())
}

pub(super) fn recover_locked(addons: &Path, id: &str) -> Result<bool> {
    let journal = journal_path(addons, id)?;
    let file = match File::open(&journal) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(error("Could not read recovery record", e)),
    };
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes).map_err(|e| error("Could not read recovery record", e))?;
    if bytes.len() > 4096 { return Err("Recovery record is too large. No files were changed.".into()); }
    let pending: PendingInstall = serde_json::from_slice(&bytes)
        .map_err(|e| error("Invalid recovery record; no files were changed", e))?;
    if pending.schema != 1 {
        return Err("Unsupported recovery record. No files were changed.".into());
    }
    let backup = pending.backup_dir.as_deref().map(|name| backup_path(addons, id, name)).transpose()?;
    let destination = addons.join(id);
    reject_link(&destination)?;
    if destination.exists() {
        if !recognized(&destination, id)? {
            return Err("An interrupted update needs recovery, but an unrecognized folder is in the way. It was not changed.".into());
        }
        // Either the old addon never moved, or the new addon was committed.
        // Preserve whichever complete directory is already in place.
    } else if let Some(backup) = &backup {
        if !recognized(backup, id)? {
            return Err(format!("The previous addon could not be recovered. Keep the recovery record and check {}.", backup.display()));
        }
        fs::rename(backup, &destination).map_err(|e| error("Close WoW and retry recovery", e))?;
    }
    if let Some(backup) = &backup {
        let wrapper = backup.parent().ok_or("Invalid recovery path")?;
        if backup.exists() { delete_owned_tree(backup)?; }
        if wrapper.is_dir() { fs::remove_dir(wrapper).map_err(|e| error("Could not clear temporary addon files", e))?; }
    }
    fs::remove_file(&journal).map_err(|e| error("Could not finish recovery", e))?;
    if let Some(parent) = journal.parent() { let _ = fs::remove_dir(parent); }
    Ok(true)
}

pub(super) fn recover_if_needed(game: &Path, id: &str) -> Result<bool> {
    let destination = addon_folder(game, id)?;
    let addons = destination.parent().ok_or("Invalid addon path")?;
    let journal = journal_path(addons, id)?;
    let pending = journal.exists();
    let legacy = addons.join(".darkwhispers-backups").is_dir()
        || addons.join(".darkwhispers-web-backups").is_dir();
    if !pending && !legacy { return Ok(false); }
    // Legacy retained copies are cleaned only while the game is closed.
    if !pending && ensure_game_closed().is_err() { return Ok(false); }
    let _lock = acquire_lock(addons)?;
    ensure_game_closed()?;
    let recovered = recover_locked(addons, id)?;
    purge_backups(addons, id)?;
    Ok(recovered)
}

pub(super) fn swap_addon(addons: &Path, id: &str, source: &Path, destination: &Path) -> Result<()> {
    let backup = if destination.exists() { Some(reserve_backup(addons, id)?) } else { None };
    let pending = PendingInstall {
        schema: 1,
        backup_dir: backup.as_ref().map(|path| path.parent().unwrap().file_name().unwrap().to_string_lossy().into_owned()),
    };
    let journal = journal_path(addons, id)?;
    write_atomic(&journal, &serde_json::to_vec(&pending).map_err(|e| error("Could not prepare recovery", e))?)?;
    if let Some(backup) = &backup {
        if let Err(e) = fs::rename(destination, backup) {
            let _ = recover_locked(addons, id);
            return Err(error("Could not back up the addon. Close WoW and retry", e));
        }
    }
    if let Err(e) = fs::rename(source, destination) {
        if let Err(restore) = recover_locked(addons, id) {
            return Err(format!("Installation failed: {e}. Recovery is pending: {restore}"));
        }
        return Err(error("Installation failed; the previous state was restored", e));
    }
    recover_locked(addons, id)?;
    purge_backups(addons, id)
}

// Never follow links or reparse points while deleting a known owned directory.
// Validate the complete tree before removing any of it.
pub(super) fn delete_owned_tree(path: &Path) -> Result<()> {
    fn inspect(path: &Path) -> Result<()> {
        reject_link(path)?;
        if path.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| error("Could not inspect addon files", e))? {
                inspect(&entry.map_err(|e| error("Could not inspect addon file", e))?.path())?;
            }
        }
        Ok(())
    }
    inspect(path)?;
    fs::remove_dir_all(path).map_err(|e| error("Could not remove addon files. Close WoW and retry", e))
}

pub(super) fn purge_backups(addons: &Path, id: &str) -> Result<()> {
    validate_id(id)?;
    for (folder, nested) in [(".darkwhispers-backups", true), (".darkwhispers-web-backups", false)] {
        let root = addons.join(folder);
        reject_link(&root)?;
        if !root.is_dir() { continue; }
        for entry in fs::read_dir(&root).map_err(|e| error("Could not clear old launcher copies", e))? {
            let entry = entry.map_err(|e| error("Could not clear old launcher copy", e))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with(&format!("{id}-")) || name.len() > 128
                || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') { continue; }
            let wrapper = entry.path();
            reject_link(&wrapper)?;
            if !wrapper.is_dir() { continue; }
            let target = if nested { wrapper.join(id) } else { wrapper.clone() };
            if recognized(&target, id)? {
                if nested && fs::read_dir(&wrapper).map_err(|e| error("Could not inspect old launcher copy", e))?.count() != 1 { continue; }
                delete_owned_tree(&target)?;
            }
            if nested && wrapper.is_dir() { let _ = fs::remove_dir(&wrapper); }
        }
        let _ = fs::remove_dir(root); // Only remove the now-empty launcher root.
    }
    Ok(())
}
