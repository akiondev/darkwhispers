"""Export only public source files for an isolated, account-free Semgrep scan."""
from pathlib import Path
import hashlib
import json
import tarfile

root = Path(__file__).resolve().parents[2]
output = root / "website/build/security"
output.mkdir(parents=True, exist_ok=True)
files = set()
for directory in ("launcher/ui", "launcher/crates/addon-core/src", "launcher/src-tauri/src",
                  "launcher/build-tools", "website/tools", "website/deploy"):
    files.update(path for path in (root/directory).rglob("*")
                 if path.is_file() and path.suffix in {".rs", ".js", ".mjs", ".py", ".sh", ".ps1", ".html", ".css"})
for name in ("website/public/app.js", "website/public/browser-install.mjs", "website/public/index.html"):
    files.add(root/name)
manifest = []
with tarfile.open(output/"source-scan.tar.gz", "w:gz") as archive:
    for path in sorted(files):
        rel = path.relative_to(root).as_posix()
        assert not path.is_symlink() and not any(part.startswith(".") for part in Path(rel).parts)
        archive.add(path, arcname=rel, recursive=False)
        manifest.append({"path":rel, "sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
(output/"source-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print("Exported", len(manifest), "public source files; no build caches or keys.")
