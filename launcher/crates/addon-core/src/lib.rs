use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
const CATALOG_URL: &str = "https://darkwhispers.akion.se/api/v1/catalog.json";
const MAX_DOWNLOAD: u64 = 32 * 1024 * 1024;
const MAX_UNPACKED: u64 = 128 * 1024 * 1024;
mod recovery;
mod game_process;
pub use game_process::ensure_game_closed;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Addon {
    pub id: String,
    pub title: String,
    pub description: String,
    pub version: String,
    #[serde(default)]
    pub released_at: Option<u64>,
    #[serde(default)]
    pub release_notes: Option<String>,
    pub download_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub schema: u32,
    #[serde(default)]
    pub published_at: u64,
    pub addons: Vec<Addon>,
}

#[derive(Deserialize)]
struct SignedCatalog {
    payload: String,
    signature: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Settings {
    pub game_path: Option<PathBuf>,
    #[serde(default)]
    pub auto_update: bool,
}

#[derive(Debug, Serialize)]
pub struct AddonStatus {
    pub addon: Addon,
    pub installed_version: Option<String>,
    pub update_available: bool,
    pub installed: bool,
    pub issue: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub game_path: Option<PathBuf>,
    pub addons: Vec<AddonStatus>,
    pub warning: Option<String>,
    pub auto_update: bool,
    pub catalog_online: bool,
    pub catalog_checked_at: Option<u64>,
}

fn error(context: &str, source: impl std::fmt::Display) -> String {
    format!("{context}: {source}")
}

pub fn verify_catalog(bytes: &[u8]) -> Result<Catalog> {
    if bytes.len() > 256 * 1024 {
        return Err("The addon catalog is too large.".into());
    }
    let signed: SignedCatalog =
        serde_json::from_slice(bytes).map_err(|e| error("Invalid catalog", e))?;
    let payload = STANDARD
        .decode(signed.payload)
        .map_err(|e| error("Invalid catalog payload", e))?;
    let signature = STANDARD
        .decode(signed.signature)
        .map_err(|e| error("Invalid signature", e))?;
    let signature = Signature::from_slice(&signature).map_err(|e| error("Invalid signature", e))?;
    let key = VerifyingKey::from_bytes(include_bytes!("catalog-public-key.bin"))
        .map_err(|e| error("Invalid trusted key", e))?;
    key.verify_strict(&payload, &signature).map_err(|_| {
        "The addon catalog signature could not be verified. Nothing was installed.".to_string()
    })?;
    let catalog: Catalog =
        serde_json::from_slice(&payload).map_err(|e| error("Invalid catalog data", e))?;
    if catalog.schema != 1 || catalog.addons.len() > 100 {
        return Err("This catalog format is not supported.".into());
    }
    let mut names = HashSet::new();
    for addon in &catalog.addons {
        validate_id(&addon.id)?;
        if !names.insert(addon.id.to_lowercase()) {
            return Err("Duplicate addon in catalog.".into());
        }
        semver::Version::parse(&addon.version).map_err(|e| error("Invalid version", e))?;
        let expected = format!(
            "https://darkwhispers.akion.se/downloads/{}-{}.zip",
            addon.id, addon.version
        );
        if addon.download_url != expected
            || hex::decode(&addon.sha256).map_or(true, |h| h.len() != 32)
        {
            return Err("Invalid addon download metadata.".into());
        }
    }
    Ok(catalog)
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return Err("Invalid addon folder name.".into());
    }
    validate_component(id)
}

fn validate_component(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
        || reserved.contains(&stem.as_str())
    {
        return Err("The archive contains an unsafe filename.".into());
    }
    Ok(())
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("DarkWhispersAddons/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| error("Could not start download", e))
}

fn download(url: &str, limit: u64) -> Result<Vec<u8>> {
    let mut request = client()?.get(url);
    if url == CATALOG_URL {
        request = request.header(reqwest::header::CACHE_CONTROL, "no-cache");
    }
    let response = request
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| error("Download failed", e))?;
    if !response.status().is_success() {
        return Err("The download returned an unexpected response.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error("Download interrupted", e))?;
    if bytes.len() as u64 > limit {
        return Err("The download exceeds the allowed size.".into());
    }
    Ok(bytes)
}

pub fn fetch_catalog(config: &Path) -> Result<Catalog> {
    let bytes = download(CATALOG_URL, 256 * 1024)?;
    let catalog = verify_catalog(&bytes)?;
    write_atomic(&config.join("catalog.json"), &bytes)?;
    Ok(catalog)
}

pub fn load_settings(config: &Path) -> Result<Settings> {
    let path = config.join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| error("Could not read settings", e))?)
        .map_err(|e| error("Could not read settings", e))
}

pub fn save_settings(config: &Path, settings: &Settings) -> Result<()> {
    write_atomic(
        &config.join("settings.json"),
        &serde_json::to_vec_pretty(settings).map_err(|e| error("Could not save settings", e))?,
    )
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| error("Could not create settings folder", e))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| error("Could not save settings", e))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| error("Could not save settings", e))?;
    temporary
        .persist(path)
        .map_err(|e| error("Could not save settings", e))?;
    Ok(())
}

pub fn select_game(config: &Path, selected: &Path) -> Result<PathBuf> {
    let path = validate_game(selected)?;
    let mut settings = load_settings(config)?;
    settings.game_path = Some(path.clone());
    save_settings(config, &settings)?;
    Ok(path)
}

pub fn set_auto_update(config: &Path, enabled: bool) -> Result<()> {
    let mut settings = load_settings(config)?;
    settings.auto_update = enabled;
    save_settings(config, &settings)
}

pub fn automatic_update_ids(status: &Status) -> Vec<String> {
    if !status.auto_update || status.warning.is_some() || status.game_path.is_none() {
        return Vec::new();
    }
    status.addons.iter().filter(|item| item.installed && item.update_available && item.issue.is_none())
        .map(|item| item.addon.id.clone()).collect()
}

pub fn release_checks() -> Result<serde_json::Value> {
    let bytes = download("https://darkwhispers.akion.se/security/release-checks.json", 256 * 1024)?;
    serde_json::from_slice(&bytes).map_err(|e| error("Could not load release reports", e))
}

pub fn validate_game(selected: &Path) -> Result<PathBuf> {
    let selected = selected
        .canonicalize()
        .map_err(|e| error("WoW folder not found", e))?;
    let candidate = if selected.file_name().is_some_and(|n| n == "_retail_") {
        selected
    } else if selected.join("_retail_").is_dir() {
        selected
            .join("_retail_")
            .canonicalize()
            .map_err(|e| error("Invalid Retail folder", e))?
    } else if selected.file_name().is_some_and(|n| n == "AddOns")
        && selected
            .parent()
            .is_some_and(|p| p.file_name().is_some_and(|n| n == "Interface"))
    {
        selected
            .parent()
            .and_then(Path::parent)
            .ok_or("Invalid AddOns folder")?
            .to_path_buf()
    } else {
        return Err(
            "Choose World of Warcraft, its _retail_ folder, or Retail's Interface/AddOns folder."
                .into(),
        );
    };
    if candidate.file_name().is_none_or(|n| n != "_retail_")
        || !candidate.join("Wow.exe").is_file()
    {
        return Err(
            "This is not a WoW Retail installation. Choose the folder containing _retail_.".into(),
        );
    }
    for part in [
        candidate.join("Interface"),
        candidate.join("Interface/AddOns"),
    ] {
        reject_link(&part)?;
        if part.exists() && !part.is_dir() {
            return Err("WoW's AddOns path is not a folder.".into());
        }
    }
    Ok(candidate)
}

pub fn detect_game() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for name in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(path) = std::env::var_os(name) {
            candidates.push(PathBuf::from(path).join("World of Warcraft"));
        }
    }
    for drive in ["C", "D", "E", "F"] {
        candidates.push(PathBuf::from(format!("{drive}:/World of Warcraft")));
        candidates.push(PathBuf::from(format!("{drive}:/Games/World of Warcraft")));
        candidates.push(PathBuf::from(format!(
            "{drive}:/Program Files (x86)/World of Warcraft"
        )));
    }
    candidates.push(PathBuf::from("/Applications/World of Warcraft"));
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".wine/drive_c/Program Files (x86)/World of Warcraft"));
        candidates.push(home.join("Games/battlenet/drive_c/Program Files (x86)/World of Warcraft"));
    }
    candidates.iter().find_map(|path| validate_game(path).ok())
}

fn reject_link(path: &Path) -> Result<()> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        let linked = metadata.file_type().is_symlink();
        #[cfg(windows)]
        let linked = {
            use std::os::windows::fs::MetadataExt;
            linked || metadata.file_attributes() & 0x400 != 0
        };
        if linked {
            return Err(format!(
                "Linked folders and files are not modified: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn addon_folder(game: &Path, id: &str) -> Result<PathBuf> {
    validate_id(id)?;
    let game = validate_game(game)?;
    let path = game.join("Interface/AddOns").join(id);
    reject_link(&path)?;
    reject_link(&path.join(format!("{id}.toc")))?;
    Ok(path)
}

pub fn installed_version(game: &Path, id: &str) -> Result<Option<String>> {
    let folder = addon_folder(game, id)?;
    if !folder.exists() {
        return Ok(None);
    }
    let toc = folder.join(format!("{id}.toc"));
    if !toc.is_file() {
        return Err(format!(
            "{} already exists but is not a recognized addon. It was not changed.",
            id
        ));
    }
    let mut content = String::new();
    File::open(toc)
        .map_err(|e| error("Could not read addon version", e))?
        .take(64 * 1024)
        .read_to_string(&mut content)
        .map_err(|e| error("Could not read addon version", e))?;
    Ok(Some(
        parse_version(&content).unwrap_or_else(|| "Unknown".into()),
    ))
}

fn parse_version(toc: &str) -> Option<String> {
    toc.lines().find_map(|line| {
        line.trim()
            .strip_prefix("## Version:")
            .map(|v| v.trim().to_string())
    })
}

fn cached_catalog(config: &Path) -> Result<(Catalog, Option<u64>)> {
    let bundled = verify_catalog(include_bytes!("bundled-catalog.json"))?;
    let path = config.join("catalog.json");
    if let Some(catalog) = fs::read(&path)
        .ok()
        .and_then(|b| verify_catalog(&b).ok())
    {
        // An older saved catalog must not hide a newer bundled release offline.
        if catalog.published_at >= bundled.published_at {
            let checked_at = fs::metadata(path).ok().and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
            return Ok((catalog, checked_at));
        }
    }
    Ok((bundled, None))
}

pub fn status(config: &Path, check_updates: bool) -> Result<Status> {
    let mut settings = load_settings(config)?;
    if settings.game_path.is_none() {
        if let Some(found) = detect_game() {
            settings.game_path = Some(found);
            save_settings(config, &settings)?;
        }
    }
    let (catalog, catalog_checked_at, catalog_online, mut warning) = if check_updates {
        match fetch_catalog(config) {
            Ok(catalog) => (catalog, SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()), true, None),
            Err(_) => {
                let (catalog, checked_at) = cached_catalog(config)?;
                (catalog, checked_at, false,
                 Some("Could not check for addon updates. Showing the last known release. Check your connection and try again.".into()))
            }
        }
    } else {
        let (catalog, checked_at) = cached_catalog(config)?;
        (catalog, checked_at, false, None)
    };
    let game = settings
        .game_path
        .clone()
        .and_then(|p| match validate_game(&p) {
            Ok(path) => Some(path),
            Err(_) => {
                warning =
                    Some("Your saved WoW folder is unavailable. Choose the folder again.".into());
                None
            }
        });
    let mut addons = Vec::new();
    for addon in catalog.addons {
        let (version, issue) = if let Some(game) = &game {
            match recovery::recover_if_needed(game, &addon.id).and_then(|recovered| {
                if recovered { warning = Some("Recovered an interrupted addon operation. Your files are safe.".into()); }
                installed_version(game, &addon.id)
            }) {
                Ok(version) => (version, None),
                Err(message) => (None, Some(message)),
            }
        } else {
            (None, None)
        };
        let update = version
            .as_ref()
            .and_then(|v| semver::Version::parse(v).ok())
            .zip(semver::Version::parse(&addon.version).ok())
            .is_some_and(|(a, b)| a < b);
        addons.push(AddonStatus {
            installed: version.is_some(),
            installed_version: version,
            update_available: update,
            issue,
            addon,
        });
    }
    Ok(Status {
        game_path: game,
        addons,
        warning,
        auto_update: settings.auto_update,
        catalog_online,
        catalog_checked_at,
    })
}

fn acquire_lock(addons: &Path) -> Result<File> {
    fs::create_dir_all(addons).map_err(|e| {
        error(
            "Cannot write to the WoW AddOns folder. Check folder permissions",
            e,
        )
    })?;
    let path = addons.join(".darkwhispers.lock");
    reject_link(&path)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| {
            error(
                "Cannot write to the WoW AddOns folder. Check folder permissions",
                e,
            )
        })?;
    fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| {
        "Another DarkWhispers operation is running. Try again in a moment.".to_string()
    })?;
    Ok(lock)
}

pub fn install(config: &Path, id: &str) -> Result<()> {
    let settings = load_settings(config)?;
    let game = settings.game_path.ok_or("Choose your WoW folder first.")?;
    let catalog = fetch_catalog(config)?;
    let addon = catalog
        .addons
        .iter()
        .find(|a| a.id == id)
        .ok_or("This addon is not in the verified catalog.")?;
    let bytes = download(&addon.download_url, MAX_DOWNLOAD)?;
    install_bytes(&game, addon, &bytes)
}

pub fn install_bytes(game: &Path, addon: &Addon, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 > MAX_DOWNLOAD
        || hex::encode(Sha256::digest(bytes)) != addon.sha256.to_lowercase()
    {
        return Err("The addon download failed its integrity check. Nothing was installed.".into());
    }
    let destination = addon_folder(game, &addon.id)?;
    let addons = destination.parent().ok_or("Invalid installation path")?;
    let _lock = acquire_lock(addons)?;
    ensure_game_closed()?;
    recovery::recover_locked(addons, &addon.id)?;
    if let Some(version) = installed_version(game, &addon.id)? {
        if semver::Version::parse(&version)
            .ok()
            .zip(semver::Version::parse(&addon.version).ok())
            .is_some_and(|(local, remote)| local > remote)
        {
            return Err("A newer version is already installed. Downgrading was blocked.".into());
        }
    }
    let staging = tempfile::Builder::new()
        .prefix(".darkwhispers-stage-")
        .tempdir_in(addons)
        .map_err(|e| error("Could not prepare installation", e))?;
    extract_checked(bytes, &addon.id, staging.path())?;
    let extracted = staging.path().join(&addon.id);
    let toc = fs::read_to_string(extracted.join(format!("{}.toc", addon.id)))
        .map_err(|e| error("The package is missing its addon manifest", e))?;
    if parse_version(&toc).as_deref() != Some(&addon.version) {
        return Err("The addon version does not match the verified catalog.".into());
    }
    recovery::swap_addon(addons, &addon.id, &extracted, &destination)
}

fn extract_checked(bytes: &[u8], id: &str, staging: &Path) -> Result<()> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| error("Invalid addon ZIP", e))?;
    if archive.len() > 1024 {
        return Err("The addon archive contains too many files.".into());
    }
    let mut paths = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| error("Invalid archive entry", e))?;
        let entry_name = entry
            .name()
            .map_err(|e| error("Invalid archive filename", e))?;
        if entry_name.contains('\\')
            || entry_name
                .trim_end_matches('/')
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return Err("The archive contains an unsafe path.".into());
        }
        let path = entry
            .enclosed_name()
            .ok_or("The archive attempts to write outside its folder.")?;
        let parts: Vec<_> = path.components().collect();
        if parts.first() != Some(&Component::Normal(id.as_ref())) {
            return Err("The archive contains an unexpected top-level folder.".into());
        }
        for part in &parts {
            match part {
                Component::Normal(value) => {
                    validate_component(value.to_str().ok_or("Invalid archive filename")?)?
                }
                _ => return Err("The archive contains an unsafe path.".into()),
            }
        }
        if !paths.insert(path.to_string_lossy().to_lowercase()) {
            return Err("Duplicate path in addon archive.".into());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Links are not allowed in addon packages.".into());
        }
        let output = staging.join(&path);
        if entry.is_dir() {
            fs::create_dir_all(output).map_err(|e| error("Could not extract addon", e))?;
            continue;
        }
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ![
            "lua", "toc", "xml", "tga", "blp", "ogg", "wav", "mp3", "ttf", "otf",
        ]
        .contains(&extension.as_str())
        {
            return Err("The addon archive contains an unsupported file type.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Addon archive is too large.")?;
        if total > MAX_UNPACKED || entry.size() > MAX_DOWNLOAD {
            return Err("Addon archive is too large.".into());
        }
        fs::create_dir_all(output.parent().ok_or("Invalid output path")?)
            .map_err(|e| error("Could not extract addon", e))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|e| error("Could not extract addon", e))?;
        let copied = std::io::copy(&mut (&mut entry).take(MAX_DOWNLOAD + 1), &mut file)
            .map_err(|e| error("Could not extract addon", e))?;
        if copied != entry.size() || copied > MAX_DOWNLOAD {
            return Err("Invalid file size in addon archive.".into());
        }
        file.sync_all()
            .map_err(|e| error("Could not finish writing addon", e))?;
    }
    Ok(())
}

fn reserve_backup(addons: &Path, id: &str) -> Result<PathBuf> {
    let backup_root = addons.join(".darkwhispers-backups");
    reject_link(&backup_root)?;
    fs::create_dir_all(&backup_root).map_err(|e| error("Could not create addon backup", e))?;
    let backup = tempfile::Builder::new()
        .prefix(&format!("{id}-"))
        .tempdir_in(&backup_root)
        .map_err(|e| error("Could not create addon backup", e))?;
    let target = backup.path().join(id);
    let _ = backup.keep();
    Ok(target)
}

#[cfg(test)]
fn backup_addon(addons: &Path, destination: &Path, id: &str) -> Result<PathBuf> {
    reject_link(destination)?;
    let target = reserve_backup(addons, id)?;
    fs::rename(destination, &target).map_err(|e| {
        error(
            "Could not move the existing addon. Close programs using its files",
            e,
        )
    })?;
    Ok(target)
}

pub fn remove(config: &Path, id: &str) -> Result<()> {
    // Removal works offline, but still only for a known, signed catalog entry.
    let catalog = fs::read(config.join("catalog.json"))
        .ok()
        .and_then(|b| verify_catalog(&b).ok())
        .unwrap_or(verify_catalog(include_bytes!("bundled-catalog.json"))?);
    if !catalog.addons.iter().any(|a| a.id == id) {
        return Err("Unknown addon.".into());
    }
    let game = load_settings(config)?
        .game_path
        .ok_or("Choose your WoW folder first.")?;
    let destination = addon_folder(&game, id)?;
    let addons = destination.parent().ok_or("Invalid addon path")?;
    let _lock = acquire_lock(addons)?;
    ensure_game_closed()?;
    recovery::recover_locked(addons, id)?;
    if installed_version(&game, id)?.is_none() {
        return Err("This addon is not installed.".into());
    }
    recovery::delete_owned_tree(&destination)?;
    recovery::purge_backups(addons, id)
}

#[cfg(test)]
mod tests;
