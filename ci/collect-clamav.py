from pathlib import Path
import hashlib
import json
import re

reports = Path("reports-clamav")
log = (reports/"clamav-console.txt").read_text()
code = int((reports/"clamav-exit.txt").read_text())
assert code == 0 and re.search(r"Infected files:\s+0\b",log), "ClamAV did not complete cleanly"
files = []
for path in sorted(Path("inputs").iterdir()):
    assert path.is_file() and "/inputs/"+path.name+": OK" in log
    files.append({"filename":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"bytes":path.stat().st_size})
assert len(files) >= 4 and int(re.search(r"Scanned files:\s+(\d+)",log).group(1)) == len(files)
report = {
    "schema":1,"status":"passed","engine":(reports/"clamav-version.txt").read_text().strip(),
    "signatures":int(re.search(r"Known viruses:\s+(\d+)",log).group(1)),
    "started_at":(reports/"clamav-started.txt").read_text().strip(),
    "checked_at":(reports/"clamav-finished.txt").read_text().strip(),
    "exit_code":code,"detections":0,"artifacts":files,
    "scope":"All release packages, read-only input mount; recursive archive scanning with limit alerts. No quarantine or removal.",
    "image":"clamav/clamav@sha256:e19130cdebaeacc71fa46eab3ed6f69941f2f22aa5e08d55e9197f8edf43ce5e"
}
(reports/"clamav.json").write_text(json.dumps(report,indent=2)+"\n")
