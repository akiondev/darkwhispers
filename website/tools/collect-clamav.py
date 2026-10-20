"""Bind the actual ClamAV console output to the exact scanned release files."""
from pathlib import Path
import hashlib
import json
import re

site = Path(__file__).resolve().parents[1]
build = site/"build/security"
public = site/"public"
defender = json.loads((build/"defender.json").read_text(encoding="utf-8-sig"))
artifacts = []
for item in defender["artifacts"]:
    digest = hashlib.sha256((public/item["url"].lstrip("/")).read_bytes()).hexdigest()
    assert digest == item["sha256"]
    assert digest in (build/"clamav-input-sha256.txt").read_text(), "File was not part of the ClamAV input set"
    artifacts.append({**{key:item[key] for key in ("filename","url","sha256","bytes")}, "status":"passed"})
log = (build/"clamav-scan.txt").read_text()
exit_code = int((build/"clamav-exit.txt").read_text())
assert exit_code == 0 and re.search(r"Infected files:\s+0\b", log), "ClamAV did not complete cleanly"
assert re.search(r"Scanned files:\s+[1-9]", log), "Nothing was scanned"
signatures = int(re.search(r"Known viruses:\s+(\d+)", log).group(1))
assert signatures > 0
version = (build/"clamav-version.txt").read_text().strip()
for item in artifacts:
    assert "Scanning /scan/" + item["filename"] + "\n" in log, "Artifact missing from the completed scan log"
report = {
    "schema":1, "version":defender["version"], "status":"passed", "exit_code":exit_code,
    "engine":version, "signatures":signatures, "detections":0,
    "started_at":(build/"clamav-started.txt").read_text().strip(),
    "checked_at":(build/"clamav-finished.txt").read_text().strip(),
    "image":"clamav/clamav@sha256:e19130cdebaeacc71fa46eab3ed6f69941f2f22aa5e08d55e9197f8edf43ce5e",
    "scope":"The three listed release archives/installers; recursive archive scanning, no exclusions, limit alerts enabled. Read-only mount; no deletion or quarantine.",
    "command":"clamscan --recursive --verbose --scan-archive=yes --alert-exceeds-max=yes --max-filesize=128M --max-scansize=512M --log=/reports/clamav-scan.txt /scan",
    "artifacts":artifacts, "database_update_log":(build/"clamav-update.txt").read_text(), "scan_log":log,
    "limitations":["Executed by the project maintainer in an isolated container, not an independent certification.", "Zero detections is not a guarantee of safety."]
}
(build/"clamav-report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
print("ClamAV:", version, "; 0 detections;",signatures,"signatures; all 3 release hashes match.")
