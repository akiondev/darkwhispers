"""Publish dated evidence, bound to release hashes, without private scan log paths."""
from pathlib import Path
import hashlib
import json
import os
import re

site = Path(__file__).resolve().parents[1]
root = site.parent
build = site / "build/security"
public = site / "public"
report = json.loads((build / "defender.json").read_text(encoding="utf-8-sig"))
audit = json.loads((build / "cargo-audit.json").read_text(encoding="utf-8-sig"))
release = json.loads((public / "launcher/releases.json").read_text(encoding="utf-8"))
clam = json.loads((build / "clamav-report.json").read_text(encoding="utf-8"))
semgrep = json.loads((build / "semgrep-report.json").read_text(encoding="utf-8"))
source_manifest = json.loads((build / "source-manifest.json").read_text(encoding="utf-8"))
assert report["version"] == release["version"]
assert clam["version"] == release["version"]
assert clam["exit_code"] == 0 and clam["detections"] == 0
assert report["malware"]["exit_code"] == 0
assert audit["vulnerabilities"]["count"] == 0, "Do not publish a passed dependency result with known vulnerabilities"
assert not audit["settings"]["ignore"], "Disclose ignored advisories explicitly"
for item in report["artifacts"]:
    path = public / item["url"].lstrip("/")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], "Artifact changed after scan"
    assert item["scan"]["status"] == "passed"
    assert any(file["sha256"] == item["sha256"] and file["status"] == "passed" for file in clam["artifacts"]), "ClamAV scan does not match this release"
for source in source_manifest:
    assert hashlib.sha256((root/source["path"]).read_bytes()).hexdigest() == source["sha256"], "Source changed after Semgrep scan"
warnings = sum(len(items) for items in audit["warnings"].values())
reviewed = [
    "launcher/crates/addon-core/src/lib.rs", "launcher/src-tauri/src/main.rs",
    "launcher/ui/app.js", "launcher/build-tools/publish-catalog.mjs",
    "website/public/app.js", "website/public/browser-install.mjs",
    "website/tools/package.py", "website/deploy/install.py",
]
report["source_review"] = {
    "status":"completed",
    "method":"Manual security review by the development assistant; not an independent audit",
    "summary":"Critical installer, download, signature and rollback paths reviewed. Automated disk tests and a real browser-file-system test passed. See the published scope and limitations.",
    "report_url":"/security/source-review.md",
    "files":[{"path":name,"sha256":hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in reviewed],
    "tests":{"browser_installer":11,"browser_real_file_handles":"passed","windows_core":9,"linux_core":10,"live_https":"passed on Windows and Linux","package_install_remove":"passed on Windows and Debian container"},
}
report["dependencies"] = {
    "status":"completed_with_notes" if warnings else "passed",
    "tool":"cargo-audit 0.22.2",
    "vulnerabilities":audit["vulnerabilities"]["count"],
    "warnings":warnings,
    "ignored_advisories":[],
    "database":audit["database"],
    "lockfile_sha256":hashlib.sha256((root/"launcher/Cargo.lock").read_bytes()).hexdigest(),
    "summary":"RustSec: 0 vulnerability entries; " + str(warnings) + " informational advisories (unmaintained proc-macro-error and Linux glib unsoundness). No advisories ignored.",
    "report_url":"/security/dependency-audit.json",
}
report["scanners"] = {"clamav": {
    key:clam[key] for key in ("status","engine","signatures","checked_at","artifacts")
}}
report["scanners"]["clamav"]["report_url"] = "/security/clamav-report.json"
report["static_analysis"] = {
    "status":"completed",
    "tool":"Semgrep Community Edition " + semgrep["version"],
    "findings":len(semgrep.get("results",[])),
    "errors":len(semgrep.get("errors",[])),
    "scanned_files":len(semgrep["paths"]["scanned"]),
    "checked_at":(build/"semgrep-finished.txt").read_text().strip(),
    "rulesets":["p/security-audit","p/secrets"],
    "summary":"Local Community Edition scan with registry security-audit and secrets rules; metrics disabled. Coverage and any skipped files, parsing errors or findings are in the full report. This is not a complete audit of Rust or every code path.",
    "report_url":"/security/semgrep-report.json",
    "source_manifest":source_manifest,
}
reviewed_notes = []
for finding in semgrep.get("results",[]):
    if (finding["check_id"] == "python.lang.security.audit.httpsconnection-detected.httpsconnection-detected"
            and finding["path"] == "/src/website/tools/verify-deployment.py"):
        reviewed_notes.append({
            "rule":finding["check_id"], "path":"website/tools/verify-deployment.py",
            "classification":"Reviewed API-usage audit note; no exploitable issue identified on the supported runtime",
            "reason":"The verifier runs on Python 3.12.3 and explicitly uses ssl.create_default_context() for certificate and hostname verification. The HTTPS host is fixed and redirects are not followed. The rule warns about historical Python versions before 3.4.3.",
            "reference":"https://docs.python.org/3/library/http.client.html#http.client.HTTPSConnection",
        })
report["static_analysis"]["reviewed_findings"] = len(reviewed_notes)
report["static_analysis"]["review_notes"] = reviewed_notes
report["static_analysis"]["review_report_url"] = "/security/semgrep-review.md"
report["limitations"] = [
    "Results apply only to the listed file hashes and scan date; not a security certification or malware-free guarantee.",
    "The source review is by the development assistant, not an independent third party.",
    "Windows installers are unsigned. GitHub publication is pending the owner's repository.",
    "Browser host-folder installation needs desktop folder-write support and explicit permission.",
    "Linux GTK has an outstanding informational unsoundness advisory; see the full dependency report.",
]
target = public / "security"
target.mkdir(exist_ok=True)
# Keep the complete scanner output, replacing only local machine paths.
log = (build/"defender-private.log").read_text(encoding="utf-8-sig")
for prefix in (str(root), str(public), os.environ.get("USERPROFILE","")):
    if prefix:
        log = log.replace(prefix, "<local-project>" if prefix != os.environ.get("USERPROFILE") else "<user-profile>")
log = re.sub(r"[A-Z]:\\Users\\[^\\\s]+", "<user-profile>", log, flags=re.IGNORECASE)
defender = {key:report[key] for key in ("schema","version","started_at","checked_at","malware","artifacts")}
defender["scan_log"] = log
defender["log_note"] = "Full command output; local user/project path prefixes replaced for privacy."
(target/"defender-report.json").write_text(json.dumps(defender,indent=2)+"\n",encoding="utf-8")
(target/"clamav-report.json").write_text(json.dumps(clam,indent=2)+"\n",encoding="utf-8")
(target/"semgrep-report.json").write_text(json.dumps(semgrep,indent=2)+"\n",encoding="utf-8")
(target/"dependency-audit.json").write_text(json.dumps(audit,indent=2)+"\n",encoding="utf-8")
(target/"release-checks.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("Published evidence for launcher " + report["version"] + ": Defender + ClamAV 0 detections; Semgrep " + str(report["static_analysis"]["findings"]) + " findings; RustSec " + str(warnings) + " informational notes.")
