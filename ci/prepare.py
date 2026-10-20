"""Prepare reproducible addon archives and signed browser catalog fixtures."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parents[1]
base = root/"addons" if (root/"addons").is_dir() else root
out = root/"out/addons"
out.mkdir(parents=True, exist_ok=True)
for name in ("AkionUI","DarkWhisperRaidTools"):
    source = base/name
    version = re.search(r"^## Version:\s*([\d.]+)\s*$",(source/(name+".toc")).read_text(),re.M).group(1)
    with zipfile.ZipFile(out/f"{name}-{version}.zip","w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file() and path.suffix in {".lua",".toc",".tga"}:
                assert not path.is_symlink()
                entry = zipfile.ZipInfo(path.relative_to(base).as_posix(),(2026,10,20,0,0,0))
                entry.create_system = 0
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry,path.read_bytes())
envelope = json.loads((root/"website/public/api/v1/catalog.json").read_text())
catalog = json.loads(base64.b64decode(envelope["payload"]))
for addon in catalog["addons"]:
    for item in addon["files"]:
        data = (base/addon["id"]/item["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == item["sha256"]
        assert len(data) == item["bytes"]
        target = root/"website/public/addons"/addon["id"]/addon["version"]/item["path"]
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(data)
        (target.parent/(target.name+".gz")).write_bytes(gzip.compress(data,mtime=0))
    archive = out/(addon["id"]+"-"+addon["version"]+".zip")
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == addon["sha256"], "Archive differs from the existing signed catalog"
print("Both addon archives prepared. Signed catalog file hashes and ZIP hash match.")
