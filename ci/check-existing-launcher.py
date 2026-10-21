"""Prove an existing launcher core finds a live addon update without writing WoW files."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
ref = "v0.3.4"
commit = subprocess.check_output(["git", "rev-parse", ref], cwd=root, text=True).strip()
paths = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", ref, "launcher"], cwd=root, text=True).splitlines()
probe = r'''
#[test]
#[ignore = "Live check in a temporary fixture; no user WoW installation"]
fn existing_launcher_detects_update_without_installing() {
    let (temp, game) = game();
    let config = temp.path().join("config");
    select_game(&config, &game).unwrap();
    let (old, bytes) = package("1.0.3", &[("DarkWhisperRaidTools/Main.lua", "unchanged fixture")]);
    install_bytes(&game, &old, &bytes).unwrap();
    let folder = game.join("Interface/AddOns/DarkWhisperRaidTools");
    let manifest = fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap();
    let state = status(&config, true).unwrap();
    assert!(state.catalog_online);
    assert!(state.addons[0].update_available);
    assert_eq!(state.addons[0].installed_version.as_deref(), Some("1.0.3"));
    assert_eq!(fs::read(folder.join("DarkWhisperRaidTools.toc")).unwrap(), manifest);
    assert_eq!(fs::read(folder.join("Main.lua")).unwrap(), b"unchanged fixture");
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
    println!("EXISTING LAUNCHER PROOF: launcher={}, installed=1.0.3, live={}, update_available=true, addon_files_unchanged=true", env!("CARGO_PKG_VERSION"), state.addons[0].addon.version);
}
'''
with tempfile.TemporaryDirectory(prefix="darkwhispers-existing-launcher-") as directory:
    target = Path(directory)
    for name in paths:
        rel = Path(name)
        assert rel.parts[0] == "launcher" and ".." not in rel.parts
        output = target / rel
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(subprocess.check_output(["git", "show", f"{ref}:{name}"], cwd=root))
    tests = target / "launcher/crates/addon-core/src/tests.rs"
    with tests.open("a", encoding="utf-8") as handle:
        handle.write(probe)
    print(f"Testing existing launcher {ref} at {commit}; only a temporary WoW fixture is used.", flush=True)
    subprocess.run(["cargo", "test", "--locked", "-p", "darkwhispers-core", "--target-dir", str(root/"launcher/target"),
                    "existing_launcher_detects_update_without_installing", "--", "--ignored", "--nocapture"],
                   cwd=target/"launcher", env=os.environ.copy(), check=True)
