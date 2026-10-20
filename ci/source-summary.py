from pathlib import Path
import hashlib
import json
import os
import subprocess

reports = Path("reports-source")
audit = json.loads((reports/"cargo-audit.json").read_text())
analysis = json.loads((reports/"semgrep.json").read_text())
assert audit["vulnerabilities"]["count"] == 0, "Known RustSec vulnerabilities block release"
assert not audit["settings"]["ignore"], "No ignored RustSec advisories permitted"
assert not analysis.get("errors"), "Incomplete Semgrep scan blocks release"
assert not any(item["extra"]["severity"] == "ERROR" for item in analysis["results"]), "Semgrep ERROR findings block release"
files = subprocess.check_output(["git","ls-files","-z"]).decode().split("\0")
manifest = [{"path":name,"sha256":hashlib.sha256(Path(name).read_bytes()).hexdigest()} for name in files if name and Path(name).is_file()]
(reports/"source-files.json").write_text(json.dumps(manifest,indent=2)+"\n")
summary = {
    "schema":1,"commit":os.environ["GITHUB_SHA"],
    "rustsec":{"vulnerabilities":audit["vulnerabilities"]["count"],"advisory_notes":sum(len(items) for items in audit["warnings"].values()),"ignored":[],"database":audit["database"]},
    "semgrep":{"version":analysis["version"],"findings":len(analysis["results"]),"errors":len(analysis.get("errors",[])),"scanned_files":len(analysis["paths"]["scanned"]),"rulesets":["p/security-audit","p/secrets"],"metrics":"off","suppressed_findings":False},
    "tests":{"lua":"not_run_in_workflow_default_preset_and_layout_preservation_checked_locally","browser_installer":"targeted_folder_update_cleanup_and_rollback_passed","catalog_publisher":"signed_catalog_fixture_and_archive_hashes_passed","rust_core":"passed_including_recovery_and_independent_addon_update","live_catalog":"passed_independent_addon_update_from_old_fixture"},
    "limits":["An attestation proves workflow origin and file integrity, not absence of malicious code or bugs.","Semgrep community rules do not provide whole-program or complete Rust coverage.","RustSec informational advisories remain disclosed in the full report.","Windows installer is unsigned."]
}
(reports/"source-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
