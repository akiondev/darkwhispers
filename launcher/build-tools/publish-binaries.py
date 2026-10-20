"""Publish only real, already-built installers; never create placeholder links."""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "src-tauri/tauri.conf.json").read_text())["version"]
public = root.parent / "website/public/launcher"
downloads = public / "downloads"
downloads.mkdir(parents=True, exist_ok=True)
manifest_path = public / "releases.json"
release = {"version": version, "platforms": {},
           "note": f"Free · v{version} beta · Windows installer is unsigned."}
artifacts = [
    ("windows", root / f"target/x86_64-pc-windows-msvc/release/bundle/nsis/DarkWhispers Addons_{version}_x64-setup.exe",
     f"DarkWhispers-Addons-{version}-windows-x64-setup.exe"),
    ("linux", root / f"dist/DarkWhispers-Addons-{version}-linux-amd64.deb",
     f"DarkWhispers-Addons-{version}-linux-amd64.deb"),
]
for platform, source, filename in artifacts:
    if not source.is_file():
        continue
    target = downloads / filename
    shutil.copyfile(source, target)
    content = target.read_bytes()
    if platform == "windows" and not content.startswith(b"MZ"):
        raise SystemExit("Windows artifact is not a PE executable")
    if platform == "linux" and not content.startswith(b"!<arch>\n"):
        raise SystemExit("Linux artifact is not a Debian package")
    release["platforms"][platform] = {
        "url": f"/launcher/downloads/{filename}",
        "label": "Debian / Ubuntu · .deb" if platform == "linux" else f"v{version} · x64 · {len(content) / (1024 * 1024):.1f} MB",
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
    }
if not release["platforms"]:
    raise SystemExit("No real installers were found")
manifest_path.write_text(json.dumps(release, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
(downloads / "SHA256SUMS.txt").write_text("".join(
    f"{item['sha256']}  {Path(item['url']).name}\n" for item in release["platforms"].values()), encoding="utf-8")
print(json.dumps(release, indent=2, ensure_ascii=False))
