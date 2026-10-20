"""Install this website only; back up Caddy and restore it if validation fails.

Run on the VPS as root: python3 install.py <archive> <sha256> <release> <snippet>
No package installation, DNS change, service restart or unrelated webroot edit.
"""
from pathlib import Path
import datetime
import hashlib
import os
import re
import subprocess
import sys
import tarfile

archive = Path(sys.argv[1]).resolve()
expected_hash, release_id = sys.argv[2:4]
snippet = Path(sys.argv[4]).resolve()
if not re.fullmatch(r"[a-f0-9]{16}", release_id) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
    raise SystemExit("Invalid release metadata")
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
    raise SystemExit("Deployment archive SHA-256 mismatch")

root = Path("/srv/darkwhispers-site")
release = root / "releases" / release_id
current = root / "current"
config = Path("/etc/caddy/Caddyfile")
site_config = Path("/etc/caddy/darkwhispers.caddy")
import_line = "import /etc/caddy/darkwhispers.caddy"
original = config.read_bytes()
original_site = site_config.read_bytes() if site_config.exists() else None
if b"darkwhispers.akion.se" in original and import_line.encode() not in original:
    raise SystemExit("Domain is already configured elsewhere; manual review needed")
if current.exists() and not current.is_symlink():
    raise SystemExit("Refusing to replace a non-symlink webroot")
previous_target = os.readlink(current) if current.is_symlink() else None

root.mkdir(parents=True, exist_ok=True)
(root / "releases").mkdir(exist_ok=True)
if not release.exists():
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle.getmembers():
            target = (release / member.name).resolve()
            if not target.is_relative_to(release.resolve()) or not member.isfile():
                raise SystemExit("Archive must contain only regular files inside the release")
        release.mkdir()
        bundle.extractall(release, filter="data")
if not (release / "index.html").is_file():
    raise SystemExit("Release has no index.html")

backup = root / "config-backups"
backup.mkdir(mode=0o700, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
(backup / f"Caddyfile-{stamp}").write_bytes(original)
if original_site is not None:
    (backup / f"darkwhispers-{stamp}.caddy").write_bytes(original_site)


def swap_link(target):
    pending = root / "current.next"
    if pending.is_symlink():
        pending.unlink()
    elif pending.exists():
        raise RuntimeError("Unexpected current.next file")
    pending.symlink_to(target)
    pending.replace(current)


try:
    site_config.write_bytes(snippet.read_bytes())
    site_config.chmod(0o644)
    if import_line.encode() not in original:
        config.write_bytes(original.rstrip() + b"\n\n# DarkWhispers addon website\n" + import_line.encode() + b"\n")
    subprocess.run(["caddy", "validate", "--config", str(config), "--adapter", "caddyfile"], check=True)
    swap_link(str(release))
    subprocess.run(["systemctl", "reload", "caddy"], check=True)
except Exception:
    config.write_bytes(original)
    if original_site is not None:
        site_config.write_bytes(original_site)
    elif site_config.exists():
        site_config.unlink()
    if previous_target:
        swap_link(previous_target)
    elif current.is_symlink():
        current.unlink()
    subprocess.run(["systemctl", "reload", "caddy"], check=False)
    raise

print(f"Installed release {release_id} at {release}")
print(f"Original Caddy configuration backed up under {backup}")
print("Caddy validated and reloaded; other sites retained.")
