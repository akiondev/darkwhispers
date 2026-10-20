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
    fs::remove_file(&journal).map_err(|e| error("Could not finish recovery", e))?;
    Ok(true)
}

pub(super) fn recover_if_needed(game: &Path, id: &str) -> Result<bool> {
    let destination = addon_folder(game, id)?;
    let addons = destination.parent().ok_or("Invalid addon path")?;
    let journal = journal_path(addons, id)?;
    if !journal.exists() { return Ok(false); }
    let _lock = acquire_lock(addons)?;
    ensure_game_closed()?;
    recover_locked(addons, id)
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
    fs::remove_file(journal).map_err(|e| error("Addon installed; reopen the launcher to finish recovery", e))?;
    Ok(())
}

pub(super) fn latest_backup(addons: &Path, id: &str) -> Result<Option<PathBuf>> {
    validate_id(id)?;
    let root = addons.join(".darkwhispers-backups");
    reject_link(&root)?;
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error("Could not read addon backups", e)),
    };
    let mut newest = None;
    for entry in entries {
        let entry = entry.map_err(|e| error("Could not read addon backup", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&format!("{id}-")) { continue; }
        let path = backup_path(addons, id, &name)?;
        if !recognized(&path, id)? { continue; }
        let modified = entry.metadata().and_then(|meta| meta.modified())
            .map_err(|e| error("Could not read addon backup date", e))?;
        if newest.as_ref().is_none_or(|(date, _)| modified > *date) {
            newest = Some((modified, path));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

pub fn restore_previous(config: &Path, id: &str) -> Result<()> {
    let catalog = cached_catalog(config)?;
    if !catalog.addons.iter().any(|addon| addon.id == id) { return Err("Unknown addon.".into()); }
    let game = load_settings(config)?.game_path.ok_or("Choose your WoW folder first.")?;
    let destination = addon_folder(&game, id)?;
    let addons = destination.parent().ok_or("Invalid addon path")?;
    let _lock = acquire_lock(addons)?;
    ensure_game_closed()?;
    recover_locked(addons, id)?;
    // Never replace an unrelated directory during a restore.
    installed_version(&game, id)?;
    let backup = latest_backup(addons, id)?.ok_or("No previous addon backup is available.")?;
    swap_addon(addons, id, &backup, &destination)
}
