"""Run inside the disposable Docker builder, never on the production host."""
from pathlib import Path
import subprocess
import hashlib
import json
import os

root = Path(os.environ.get("DARKWHISPERS_BUILD_ROOT", "/work"))
assert root == Path("/work") or os.environ.get("GITHUB_ACTIONS") == "true", "Disposable builder or GitHub-hosted runner only"
version = json.loads((root / "src-tauri/tauri.conf.json").read_text())["version"]
package = root / f"target/release/bundle/deb/DarkWhispers Addons_{version}_amd64.deb"
subprocess.run(["dpkg", "--install", str(package)], check=True)
installed = Path("/usr/bin/darkwhispers-addons")
expected = (root / "target/release/darkwhispers-addons").read_bytes().replace(
    b"__TAURI_BUNDLE_TYPE_VAR_UNK", b"__TAURI_BUNDLE_TYPE_VAR_DEB")
assert hashlib.sha256(installed.read_bytes()).digest() == hashlib.sha256(expected).digest()
dependencies = subprocess.check_output(["ldd", str(installed)], text=True)
assert "not found" not in dependencies, dependencies
desktop = [path for path in Path("/usr/share/applications").glob("*.desktop")
           if "dark" in path.name.lower() and "whispers" in path.name.lower()]
assert desktop, "Desktop launcher entry missing"
subprocess.run(["dpkg", "--remove", "dark-whispers-addons"], check=True)
assert not installed.exists()
print("Linux package install, executable hash, dependencies, desktop entry and removal verified.")
