"""Enable maintenance for DarkWhispers only, retaining the previous site config."""
from pathlib import Path
import subprocess
import sys

snippet = Path(sys.argv[1]).read_bytes()
assert snippet.startswith(b"darkwhispers.akion.se {\n")
assert b'respond "Temporarily under maintenance." 200' in snippet
site_config = Path("/etc/caddy/darkwhispers.caddy")
original = site_config.read_bytes()
main_config = Path("/etc/caddy/Caddyfile")
assert b"import /etc/caddy/darkwhispers.caddy" in main_config.read_bytes()

if original != snippet:
    backup = Path("/srv/darkwhispers-site/config-backups/darkwhispers-before-maintenance.caddy")
    backup.parent.mkdir(parents=True, exist_ok=True)
    if b"Temporarily under maintenance." not in original:
        backup.write_bytes(original)
    else:
        assert backup.is_file(), "Previous public site config must remain available"
    try:
        site_config.write_bytes(snippet)
        subprocess.run(["caddy", "validate", "--config", str(main_config), "--adapter", "caddyfile"], check=True)
        subprocess.run(["systemctl", "reload", "caddy"], check=True)
    except Exception:
        site_config.write_bytes(original)
        subprocess.run(["systemctl", "reload", "caddy"], check=False)
        raise

assert site_config.read_bytes() == snippet
print("DarkWhispers maintenance enabled; previous site config retained for restoration.")
