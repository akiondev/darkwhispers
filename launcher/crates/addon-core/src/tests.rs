use super::*;
use zip::{write::SimpleFileOptions, ZipWriter};

fn game() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let game = temp.path().join("World of Warcraft/_retail_");
    fs::create_dir_all(game.join("Interface/AddOns/OtherAddon")).unwrap();
    fs::create_dir_all(game.join("WTF/Account")).unwrap();
    fs::write(game.join("Wow.exe"), b"test fixture").unwrap();
    fs::write(game.join("Interface/AddOns/OtherAddon/Other.lua"), b"keep").unwrap();
    fs::write(game.join("WTF/Account/settings.lua"), b"keep settings").unwrap();
    (temp, game)
}

fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, contents) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(contents.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn package(version: &str, files: &[(&str, &str)]) -> (Addon, Vec<u8>) {
    let manifest = format!("## Interface: 120100\n## Version: {version}\nMain.lua\n");
    let mut entries = vec![(
        "DarkWhisperRaidTools/DarkWhisperRaidTools.toc",
        manifest.as_str(),
    )];
    entries.extend_from_slice(files);
    let bytes = archive(&entries);
    let mut addon = verify_catalog(include_bytes!("bundled-catalog.json"))
        .unwrap()
        .addons
        .remove(0);
    addon.version = version.into();
    addon.sha256 = hex::encode(Sha256::digest(&bytes));
    (addon, bytes)
}

#[test]
fn signed_catalog_rejects_tampering() {
    let bytes = include_bytes!("bundled-catalog.json");
    assert!(verify_catalog(bytes).is_ok());
    let mut envelope: serde_json::Value = serde_json::from_slice(bytes).unwrap();
    let mut payload = STANDARD
        .decode(envelope["payload"].as_str().unwrap())
        .unwrap();
    payload[20] ^= 1;
    envelope["payload"] = STANDARD.encode(payload).into();
    assert!(verify_catalog(&serde_json::to_vec(&envelope).unwrap()).is_err());
    envelope["signature"] = STANDARD.encode([0u8; 64]).into();
    assert!(verify_catalog(&serde_json::to_vec(&envelope).unwrap()).is_err());
}

#[test]
fn accepts_only_real_retail_layouts() {
    let (temp, game) = game();
    assert_eq!(validate_game(&game).unwrap(), game.canonicalize().unwrap());
    assert_eq!(
        validate_game(game.parent().unwrap()).unwrap(),
        game.canonicalize().unwrap()
    );
    assert_eq!(
        validate_game(&game.join("Interface/AddOns")).unwrap(),
        game.canonicalize().unwrap()
    );
    let classic = temp.path().join("_classic_");
    fs::create_dir_all(&classic).unwrap();
    fs::write(classic.join("Wow.exe"), b"fixture").unwrap();
    assert!(validate_game(&classic).is_err());
    fs::remove_file(game.join("Wow.exe")).unwrap();
    assert!(validate_game(&game).is_err());
}

#[test]
fn install_upgrade_and_remove_preserve_other_addons_and_saved_settings() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (first, bytes) = package("1.0.0", &[("DarkWhisperRaidTools/Old.lua", "old")]);
    install_bytes(&game, &first, &bytes).unwrap();
    assert_eq!(
        installed_version(&game, &first.id).unwrap().as_deref(),
        Some("1.0.0")
    );
    let (second, bytes) = package("1.1.0", &[("DarkWhisperRaidTools/Main.lua", "new")]);
    install_bytes(&game, &second, &bytes).unwrap();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    assert!(!folder.join("Old.lua").exists());
    assert_eq!(fs::read_to_string(folder.join("Main.lua")).unwrap(), "new");
    let backup = remove(&config, &second.id).unwrap();
    assert!(!folder.exists());
    assert_eq!(fs::read_to_string(backup.join("Main.lua")).unwrap(), "new");
    assert_eq!(
        fs::read_to_string(game.join("Interface/AddOns/OtherAddon/Other.lua")).unwrap(),
        "keep"
    );
    assert_eq!(
        fs::read_to_string(game.join("WTF/Account/settings.lua")).unwrap(),
        "keep settings"
    );
    assert!(remove(&config, "OtherAddon").is_err());
}

#[test]
fn invalid_download_does_not_change_existing_installation() {
    let (_temp, game) = game();
    let (addon, bytes) = package("1.0.0", &[("DarkWhisperRaidTools/Main.lua", "original")]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let mut damaged = bytes.clone();
    damaged[0] ^= 1;
    assert!(install_bytes(&game, &addon, &damaged).is_err());
    let (mut mismatch, bytes) = package("1.1.0", &[]);
    mismatch.version = "2.0.0".into();
    assert!(install_bytes(&game, &mismatch, &bytes).is_err());
    assert_eq!(
        fs::read_to_string(game.join("Interface/AddOns/DarkWhisperRaidTools/Main.lua")).unwrap(),
        "original"
    );
    assert_eq!(
        installed_version(&game, &addon.id).unwrap().as_deref(),
        Some("1.0.0")
    );
}

#[test]
fn older_release_cannot_overwrite_newer_installation() {
    let (_temp, game) = game();
    let (addon, bytes) = package("2.0.0", &[]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let (old, bytes) = package("1.0.0", &[]);
    assert!(install_bytes(&game, &old, &bytes)
        .unwrap_err()
        .contains("Downgrading"));
    assert_eq!(
        installed_version(&game, &addon.id).unwrap().as_deref(),
        Some("2.0.0")
    );
}

#[test]
fn unsafe_archives_are_rejected_before_replacement() {
    let (_temp, game) = game();
    let (original, bytes) = package("1.0.0", &[]);
    install_bytes(&game, &original, &bytes).unwrap();
    for name in [
        "../Outside.lua",
        "DarkWhisperRaidTools/../../Outside.lua",
        "DarkWhisperRaidTools/../DarkWhisperRaidTools/Main.lua",
        "OtherAddon/Other.lua",
        "/DarkWhisperRaidTools/Main.lua",
        "DarkWhisperRaidTools\\Main.lua",
        "DarkWhisperRaidTools/run.exe",
        "DarkWhisperRaidTools/CON.lua",
        "DarkWhisperRaidTools/Main.lua:stream",
        "DarkWhisperRaidTools/trailing./Main.lua",
    ] {
        let (addon, bytes) = package("1.1.0", &[(name, "bad")]);
        assert!(
            install_bytes(&game, &addon, &bytes).is_err(),
            "accepted {name}"
        );
        assert_eq!(
            installed_version(&game, &addon.id).unwrap().as_deref(),
            Some("1.0.0")
        );
    }
    let (addon, bytes) = package(
        "1.1.0",
        &[
            ("DarkWhisperRaidTools/Main.lua", "one"),
            ("DarkWhisperRaidTools/main.lua", "two"),
        ],
    );
    assert!(install_bytes(&game, &addon, &bytes).is_err());
}

#[test]
fn unrecognized_existing_folder_is_never_overwritten() {
    let (_temp, game) = game();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("notes.txt"), b"keep").unwrap();
    let (addon, bytes) = package("1.0.0", &[]);
    assert!(install_bytes(&game, &addon, &bytes).is_err());
    assert_eq!(fs::read(folder.join("notes.txt")).unwrap(), b"keep");
}

#[test]
fn concurrent_operations_are_blocked() {
    let (_temp, game) = game();
    let _first = acquire_lock(&game.join("Interface/AddOns")).unwrap();
    assert!(acquire_lock(&game.join("Interface/AddOns")).is_err());
}

#[test]
fn local_status_uses_verified_catalog_without_network() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    fs::write(config.join("catalog.json"), b"untrusted data").unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.game_path.is_some());
    assert!(!state.addons[0].installed);
    assert!(state.warning.is_none());
}

#[test]
fn recovery_restores_a_crash_between_directory_swaps() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, bytes) = package("1.0.0", &[("DarkWhisperRaidTools/Main.lua", "original")]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let addons = game.join("Interface/AddOns");
    let destination = addons.join(&addon.id);
    let backup = backup_addon(&addons, &destination, &addon.id).unwrap();
    let name = backup.parent().unwrap().file_name().unwrap().to_str().unwrap();
    let journal = addons.join(".darkwhispers-pending/DarkWhisperRaidTools.json");
    write_atomic(&journal, &serde_json::to_vec(&serde_json::json!({"schema":1,"backup_dir":name})).unwrap()).unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].installed);
    assert!(state.warning.unwrap().contains("Recovered"));
    assert_eq!(fs::read(destination.join("Main.lua")).unwrap(), b"original");
    assert!(!journal.exists());
}

#[test]
fn recovery_preserves_committed_install_and_blocks_unsafe_records() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, bytes) = package("1.0.0", &[("DarkWhisperRaidTools/Main.lua", "current")]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let addons = game.join("Interface/AddOns");
    let journal = addons.join(".darkwhispers-pending/DarkWhisperRaidTools.json");
    write_atomic(&journal, br#"{"schema":1,"backup_dir":null}"#).unwrap();
    assert!(status(&config, false).unwrap().addons[0].installed);
    assert!(!journal.exists());
    write_atomic(&journal, br#"{"schema":1,"backup_dir":"DarkWhisperRaidTools-../../OtherAddon"}"#).unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].issue.as_ref().unwrap().contains("Invalid recovery"));
    assert!(journal.exists());
    assert_eq!(fs::read(addons.join("OtherAddon/Other.lua")).unwrap(), b"keep");
    assert_eq!(fs::read(addons.join("DarkWhisperRaidTools/Main.lua")).unwrap(), b"current");
}

#[test]
fn restore_previous_preserves_current_version_as_another_backup() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, first) = package("1.0.0", &[("DarkWhisperRaidTools/Main.lua", "first")]);
    install_bytes(&game, &addon, &first).unwrap();
    let (addon, second) = package("1.1.0", &[("DarkWhisperRaidTools/Main.lua", "second")]);
    install_bytes(&game, &addon, &second).unwrap();
    assert!(status(&config, false).unwrap().addons[0].can_restore);
    restore_previous(&config, &addon.id).unwrap();
    assert_eq!(installed_version(&game, &addon.id).unwrap().as_deref(), Some("1.0.0"));
    let latest = recovery::latest_backup(&game.join("Interface/AddOns"), &addon.id).unwrap().unwrap();
    assert_eq!(fs::read(latest.join("Main.lua")).unwrap(), b"second");
    remove(&config, &addon.id).unwrap();
    restore_previous(&config, &addon.id).unwrap();
    assert!(installed_version(&game, &addon.id).unwrap().is_some());
    assert_eq!(fs::read(game.join("WTF/Account/settings.lua")).unwrap(), b"keep settings");
}

#[test]
fn status_keeps_folder_errors_attached_to_the_addon() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("notes.txt"), b"keep").unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].issue.as_ref().unwrap().contains("not a recognized addon"));
    assert!(!state.addons[0].installed);
    assert_eq!(fs::read(folder.join("notes.txt")).unwrap(), b"keep");
    fs::write(folder.join("DarkWhisperRaidTools.toc"), b"## Title: Fixture\n").unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].issue.is_none());
    assert!(state.addons[0].installed);
    assert_eq!(state.addons[0].installed_version.as_deref(), Some("Unknown"));
    assert!(!state.addons[0].update_available);
}

#[test]
#[ignore = "Explicit live HTTPS integration test; uses a temporary WoW fixture only"]
fn live_signed_release_installs_and_removes() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    install(&config, "DarkWhisperRaidTools").unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].installed);
    assert!(!state.addons[0].update_available);
    let backup = remove(&config, "DarkWhisperRaidTools").unwrap();
    assert!(backup.join("DarkWhisperRaidTools.toc").is_file());
    assert!(installed_version(&game, "DarkWhisperRaidTools")
        .unwrap()
        .is_none());
    assert_eq!(
        fs::read_to_string(game.join("WTF/Account/settings.lua")).unwrap(),
        "keep settings"
    );
}

#[cfg(unix)]
#[test]
fn linked_addons_and_linked_addons_folder_are_not_modified() {
    use std::os::unix::fs::symlink;
    let (temp, game) = game();
    let outside = temp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, game.join("Interface/AddOns/DarkWhisperRaidTools")).unwrap();
    let (addon, bytes) = package("1.0.0", &[]);
    assert!(install_bytes(&game, &addon, &bytes).is_err());
    fs::remove_file(game.join("Interface/AddOns/DarkWhisperRaidTools")).unwrap();
    fs::rename(
        game.join("Interface/AddOns"),
        game.join("Interface/original"),
    )
    .unwrap();
    symlink(&outside, game.join("Interface/AddOns")).unwrap();
    assert!(validate_game(&game).is_err());
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
}
