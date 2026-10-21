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
    remove(&config, &second.id).unwrap();
    assert!(!folder.exists());
    assert!(!game.join("Interface/AddOns/.darkwhispers-backups").exists());
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
    assert!(!state.catalog_online);
    assert!(state.catalog_checked_at.is_none());
}

#[test]
fn addon_update_is_independent_of_the_launcher_version() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (old, bytes) = package("1.0.1", &[]);
    install_bytes(&game, &old, &bytes).unwrap();
    fs::write(config.join("catalog.json"), include_bytes!("bundled-catalog.json")).unwrap();
    let state = status(&config, false).unwrap();
    let addon = &state.addons[0];
    assert_eq!(addon.installed_version.as_deref(), Some("1.0.1"));
    let expected = verify_catalog(include_bytes!("bundled-catalog.json")).unwrap();
    assert_eq!(addon.addon.version, expected.addons[0].version);
    assert!(addon.update_available);
    assert!(addon.addon.released_at.is_some());
    assert!(!addon.addon.release_notes.as_ref().unwrap().is_empty());
    assert!(!state.catalog_online);
    assert!(state.catalog_checked_at.is_some());
}

#[test]
fn status_leaves_recovery_pending_until_an_approved_install() {
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
    assert!(!state.addons[0].installed);
    assert!(state.warning.unwrap().contains("waiting for approval"));
    assert!(journal.exists());
    assert!(!destination.exists());
    install_bytes(&game, &addon, &bytes).unwrap();
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
    assert!(journal.exists(), "Checking status must not clear recovery files");
    install_bytes(&game, &addon, &bytes).unwrap();
    assert!(!journal.exists());
    write_atomic(&journal, br#"{"schema":1,"backup_dir":"DarkWhisperRaidTools-../../OtherAddon"}"#).unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].issue.as_ref().unwrap().contains("Invalid recovery"));
    assert!(journal.exists());
    assert_eq!(fs::read(addons.join("OtherAddon/Other.lua")).unwrap(), b"keep");
    assert_eq!(fs::read(addons.join("DarkWhisperRaidTools/Main.lua")).unwrap(), b"current");
}

#[test]
fn updates_and_removal_leave_no_retained_versions_and_preserve_wtf() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, first) = package("1.0.0", &[("DarkWhisperRaidTools/Main.lua", "first")]);
    install_bytes(&game, &addon, &first).unwrap();
    let (addon, second) = package("1.1.0", &[("DarkWhisperRaidTools/Main.lua", "second")]);
    install_bytes(&game, &addon, &second).unwrap();
    assert_eq!(installed_version(&game, &addon.id).unwrap().as_deref(), Some("1.1.0"));
    assert!(!game.join("Interface/AddOns/.darkwhispers-backups").exists());
    remove(&config, &addon.id).unwrap();
    assert!(installed_version(&game, &addon.id).unwrap().is_none());
    assert_eq!(fs::read(game.join("WTF/Account/settings.lua")).unwrap(), b"keep settings");
    assert_eq!(fs::read(game.join("Interface/AddOns/OtherAddon/Other.lua")).unwrap(), b"keep");
}

#[test]
fn auto_check_updates_is_opt_in_and_survives_folder_changes() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    assert!(!load_settings(&config).unwrap().auto_check_updates);
    set_auto_check_updates(&config, true).unwrap();
    select_game(&config, &game).unwrap();
    assert!(load_settings(&config).unwrap().auto_check_updates);
    set_auto_check_updates(&config, false).unwrap();
    assert!(!load_settings(&config).unwrap().auto_check_updates);
}

#[test]
fn cleanup_removes_only_recognized_launcher_copies() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, bytes) = package("1.0.0", &[]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let addons = game.join("Interface/AddOns");
    let old = backup_addon(&addons, &addons.join(&addon.id), &addon.id).unwrap();
    fs::copy(old.join("DarkWhisperRaidTools.toc"), temp.path().join("old.toc")).unwrap();
    fs::create_dir_all(addons.join(".darkwhispers-backups/OtherAddon-keep")).unwrap();
    fs::write(addons.join(".darkwhispers-backups/OtherAddon-keep/notes.txt"), b"keep").unwrap();
    recovery::purge_backups(&addons, &addon.id).unwrap();
    assert!(!old.exists());
    assert!(addons.join(".darkwhispers-backups/OtherAddon-keep/notes.txt").is_file());
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
    let (old, bytes) = package("1.0.1", &[]);
    install_bytes(&game, &old, &bytes).unwrap();
    let before = status(&config, true).unwrap();
    assert!(before.catalog_online);
    assert!(before.catalog_checked_at.is_some());
    assert!(before.addons[0].update_available);
    let expected = before.addons[0].addon.version.clone();
    install_version(&config, "DarkWhisperRaidTools", &expected).unwrap();
    // Compare with the same live channel. During release builds the bundled
    // catalog may describe the next, not-yet-published addon version.
    let state = status(&config, true).unwrap();
    assert!(state.catalog_online);
    assert!(state.addons[0].installed);
    assert!(!state.addons[0].update_available);
    assert_eq!(state.addons[0].installed_version.as_deref(), Some(expected.as_str()));
    remove(&config, "DarkWhisperRaidTools").unwrap();
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

#[test]
fn legacy_auto_install_setting_is_ignored() {
    let (temp, _) = game();
    let config = temp.path().join("config");
    fs::create_dir_all(&config).unwrap();
    fs::write(config.join("settings.json"), br#"{"game_path":null,"auto_update":true}"#).unwrap();
    assert!(!load_settings(&config).unwrap().auto_check_updates);
    assert!(background_status(&config).unwrap().is_none());
    set_auto_check_updates(&config, true).unwrap();
    let saved = fs::read_to_string(config.join("settings.json")).unwrap();
    assert!(!saved.contains("auto_update"));
}

#[test]
fn status_and_disabled_background_checks_do_not_change_addon_files() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, bytes) = package("1.0.3", &[("DarkWhisperRaidTools/Main.lua", "keep exactly")]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    let before = fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap();
    let state = status(&config, false).unwrap();
    assert!(state.addons[0].update_available);
    assert_eq!(state.addons[0].addon.version, "1.0.4");
    assert_eq!(fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap(), before);
    assert_eq!(fs::read(folder.join("Main.lua")).unwrap(), b"keep exactly");
    assert!(background_status(&config).unwrap().is_none());
}

#[test]
#[ignore = "Explicit live check, temporary WoW fixture only"]
fn live_checks_and_rejected_approval_leave_addon_unchanged() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (addon, bytes) = package("1.0.3", &[("DarkWhisperRaidTools/Main.lua", "keep exactly")]);
    install_bytes(&game, &addon, &bytes).unwrap();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    let manifest = fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap();
    set_auto_check_updates(&config, true).unwrap();
    let state = background_status(&config).unwrap().unwrap();
    assert!(state.catalog_online && state.addons[0].update_available);
    assert!(install_version(&config, &addon.id, "0.0.0").unwrap_err().contains("version changed"));
    assert_eq!(fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap(), manifest);
    assert_eq!(fs::read(folder.join("Main.lua")).unwrap(), b"keep exactly");
    assert_eq!(fs::read_dir(folder).unwrap().count(), 2);
}

#[test]
#[ignore = "Explicit live launcher metadata check; no install operations"]
fn live_launcher_version_check_only_reports_newer_versions() {
    assert!(latest_launcher_version("0.0.0").unwrap().is_some());
    assert!(latest_launcher_version("9999.0.0").unwrap().is_none());
}
