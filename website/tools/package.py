"""Build the public addon ZIP and a narrowly scoped website deployment archive."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re
import tarfile
import zipfile
from urllib.parse import urlsplit

site = Path(__file__).resolve().parents[1]
project = site.parent
public = site / "public"
addon_base = project / "addons" if (project / "addons").is_dir() else project
addon = addon_base / "DarkWhisperRaidTools"
manifest = addon / "DarkWhisperRaidTools.toc"
version_match = re.search(r"^## Version:\s*([0-9.]+)\s*$", manifest.read_text(), re.M)
if not version_match:
    raise SystemExit("Cannot read addon version")
version = version_match.group(1)
runtime = sorted(p for p in addon.rglob("*") if p.suffix in {".lua", ".toc", ".tga"})
if len(runtime) != 7:
    raise SystemExit("Unexpected runtime inventory; review package allowlist")
download = public / "downloads" / f"DarkWhisperRaidTools-{version}.zip"
download.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(download, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for path in runtime:
        info = zipfile.ZipInfo(path.relative_to(addon_base).as_posix(), (2026, 10, 20, 0, 0, 0))
        info.create_system = 0
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        output.writestr(info, path.read_bytes())
with zipfile.ZipFile(download) as output:
    if output.testzip():
        raise SystemExit("Corrupt ZIP")
    for path in runtime:
        assert output.read(path.relative_to(addon_base).as_posix()) == path.read_bytes()
checksum = hashlib.sha256(download.read_bytes()).hexdigest()
(public / "downloads" / "SHA256SUMS.txt").write_text(f"{checksum}  {download.name}\n", encoding="utf-8")

# Content-addressed assets prevent browsers retaining a previous design after a deploy.
for filename in ("browser-install.mjs", "styles.css", "app.js"):
    source = public / filename
    asset_hash = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    name, extension = filename.rsplit(".", 1)
    versioned = f"{name}.{asset_hash}.{extension}"
    (public / versioned).write_bytes(source.read_bytes())
    documents = list(public.glob("*.html")) + ([public / "app.js"] if filename == "browser-install.mjs" else [])
    for document in documents:
        text = document.read_text(encoding="utf-8")
        text = re.sub(rf'/{name}(?:\.[a-f0-9]{{16}})?\.{extension}"', f'/{versioned}"', text)
        document.write_text(text, encoding="utf-8")


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.refs = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if "id" in data:
            self.ids.append(data["id"])
        for attribute in ("href", "src"):
            if attribute in data:
                self.refs.append(data[attribute])


parser = References()
html = (public / "index.html").read_text(encoding="utf-8")
parser.feed(html)
assert len(parser.ids) == len(set(parser.ids)), "Duplicate HTML IDs"
for ref in parser.refs:
    if ref.startswith("#"):
        assert ref[1:] in parser.ids, f"Broken anchor: {ref}"
    elif ref.startswith("/") and ref != "/":
        assert (public / urlsplit(ref).path.lstrip("/")).is_file(), f"Missing file: {ref}"
assert "https://github.com/akiondev/darkwhispers" in html, "The public source link must stay visible"

build = site / "build"
build.mkdir(exist_ok=True)
files = sorted(p for p in public.rglob("*") if p.is_file())
assert not any("__qa" in p.relative_to(public).parts for p in files), "Remove local-only browser QA fixtures before publishing"
release_id = hashlib.sha256(b"".join(p.relative_to(public).as_posix().encode() + p.read_bytes() for p in files)).hexdigest()[:16]
archive = build / f"darkwhispers-site-{release_id}.tar.gz"
with tarfile.open(archive, "w:gz") as output:
    for path in files:
        info = output.gettarinfo(str(path), arcname=path.relative_to(public).as_posix())
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mode = 0o644
        with path.open("rb") as source:
            output.addfile(info, source)
artifact = {
    "release": release_id,
    "archive": str(archive),
    "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "files": {p.relative_to(public).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    "addon": {"version": version, "sha256": checksum, "runtime_files": len(runtime), "bytes": download.stat().st_size},
}
(build / "release.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
print(json.dumps(artifact, indent=2))
