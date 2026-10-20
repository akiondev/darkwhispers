"""Export this legacy workspace into the clean public monorepo checkout.

The local addon source paths stay unchanged for the authorized WoW deployment.
Only the explicit allowlist below can enter the public Git checkout.
"""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
destination = root/".tools/github/darkwhispers"
assert (destination/".git").is_dir(), "Clone the intended repository first"
excluded = {"target","dist","build","node_modules","__pycache__", ".git"}
mapping = {}

def include(source, target):
    assert source.is_file() and not source.is_symlink()
    assert source.suffix.lower() not in {".pem",".key",".pfx",".p12",".log"}
    assert not any(part.startswith(".env") for part in source.relative_to(root).parts)
    data = source.read_bytes()
    markers = (b"-----BEGIN "+b"PRIVATE KEY-----", b"-----BEGIN "+b"OPENSSH PRIVATE KEY-----")
    assert not any(marker in data for marker in markers), "Private-key marker in " + str(source.relative_to(root))
    mapping[target] = source

for name in ("DarkWhisperRaidTools",):
    for source in (root/name).rglob("*"):
        if source.is_file() and source.suffix in {".lua",".toc",".tga"}:
            include(source, "addons/"+source.relative_to(root).as_posix())
for folder in ("launcher","website","tests","tools","docs","ci",".github"):
    for source in (root/folder).rglob("*"):
        relative = source.relative_to(root)
        if not source.is_file() or any(part in excluded for part in relative.parts):
            continue
        name = relative.as_posix()
        if name in {"launcher/tests/ui.html", "tests/smoke.lua", "docs/soothe-research.md", "docs/addons-guide.md"} or name.startswith("docs/README.public") or ".public." in source.name:
            continue
        if name.startswith(("website/public/addons/","website/public/launcher/downloads/")):
            continue
        if name.startswith("website/public/") and source.suffix in {".exe",".deb",".zip"}:
            continue
        if folder == "website" and source.name.startswith(("app.","styles.","browser-install.")) and any(len(part)==16 for part in source.name.split(".")):
            continue
        if source.suffix == ".log":
            continue
        include(source,name)
for source,target in (("docs/README.public.md","README.md"),("docs/SECURITY.public.md","SECURITY.md"),
                      ("docs/AGENTS.public.md","AGENTS.md"),("launcher/LICENSE","LICENSE"),("tools/deploy-raid.ps1","deploy.ps1")):
    include(root/source,target)
for name,source in sorted(mapping.items()):
    target = destination/name
    assert target.resolve().is_relative_to(destination.resolve())
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
(destination/".gitattributes").write_text("* text=auto eol=lf\naddons/** -text\n*.tga binary\n*.png binary\n*.webp binary\n*.woff2 binary\n*.ico binary\n*.icns binary\n*.bin binary\n",encoding="utf-8")
(destination/".gitignore").write_text("""/out/
/release/
/staging/
/inputs/
/reports-*/
/.tools/
/.research/
/launcher/target/
/launcher/dist/
/launcher/node_modules/
/website/build/
/website/public/addons/
/website/public/downloads/*.zip
/website/public/launcher/downloads/
/website/public/app.*.js
/website/public/styles.*.css
/website/public/browser-install.*.mjs
**/__pycache__/
*.pem
*.key
*.pfx
*.p12
.env*
""",encoding="utf-8")
manifest = [{"path":name,"sha256":hashlib.sha256(source.read_bytes()).hexdigest()} for name,source in sorted(mapping.items())]
(root/"website/build/public-source-export.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print("Exported",len(mapping),"allowlisted source files into",destination)
