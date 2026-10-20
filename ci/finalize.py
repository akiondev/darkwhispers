"""Assemble verifiable release metadata from reports produced by public jobs."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil

root = Path(__file__).resolve().parents[1]
staging = root/"staging"
release = root/"release"
release.mkdir()
version = json.loads((root/"launcher/src-tauri/tauri.conf.json").read_text())["version"]
assert os.environ["GITHUB_REF"] == "refs/heads/main", "Only main can publish"
base = "https://github.com/akiondev/darkwhispers/releases/download/v"+version+"/"
groups = {
    "release-input-windows":{f"DarkWhispers-Addons-{version}-windows-x64-setup.exe"},
    "release-input-linux":{f"DarkWhispers-Addons-{version}-linux-amd64.deb"},
    "release-source":{"addon-tests.txt","browser-tests.txt","catalog-tests.txt","rust-tests.txt","cargo-audit.json","semgrep.json","source-files.json","source-summary.json"},
    "release-defender":{"defender.json","defender-console.txt","defender-update.txt"},
    "release-clamav":{"clamav.json","clamav-started.txt","clamav-update.txt","clamav-version.txt","clamav-console.txt","clamav-exit.txt","clamav-finished.txt"},
    "release-codeql-python":{"codeql-python.sarif"},
    "release-codeql-javascript-typescript":{"codeql-javascript-typescript.sarif"},
}
import re
addon_files = set()
for name in ("AkionUI","DarkWhisperRaidTools"):
    toc = (root/"addons"/name/(name+".toc")).read_text(encoding="utf-8")
    addon_version = re.search(r"^## Version:\s*([\d.]+)\s*$",toc,re.M).group(1)
    addon_files.add(name+"-"+addon_version+".zip")
groups["release-input-addons"] = addon_files
assert {path.name for path in staging.iterdir()} == set(groups), "Unexpected artifact group"
files = {}
for group,expected in groups.items():
    folder = staging/group
    assert folder.is_dir() and not folder.is_symlink()
    assert {path.name for path in folder.iterdir()} == expected, "Unexpected files in "+group
    for path in folder.iterdir():
        assert path.is_file() and not path.is_symlink() and path.name not in files
        files[path.name] = path
# Reports are accepted only from their dedicated scanner artifact groups;
# build/test output cannot overwrite a scanner's result.
defender = json.loads(files["defender.json"].read_text(encoding="utf-8-sig"))
clam = json.loads(files["clamav.json"].read_text(encoding="utf-8"))
source = json.loads(files["source-summary.json"].read_text(encoding="utf-8"))
assert source["commit"] == os.environ["GITHUB_SHA"]
assert defender["status"] == clam["status"] == "passed"
artifacts = []
for path in sorted(files.values()):
    assert path.is_file() and not path.is_symlink()
    if path.suffix in {".exe",".deb",".zip"}:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        for scan in (defender,clam):
            assert any(item["filename"] == path.name and item["sha256"] == digest for item in scan["artifacts"]), "Unscanned or changed release file"
        artifacts.append({"filename":path.name,"sha256":digest,"bytes":path.stat().st_size,"url":base+path.name})
    shutil.copyfile(path,release/path.name)
assert len(artifacts) >= 4
codeql_runs = []
for path in sorted(release.glob("codeql-*.sarif")):
    codeql_runs.extend(json.loads(path.read_text())["runs"])
assert len(codeql_runs) >= 2, "Both CodeQL language reports are required"
for run in codeql_runs:
    rules = {item["id"]:item for item in run["tool"]["driver"].get("rules",[])}
    for finding in run.get("results",[]):
        severity = float(rules.get(finding.get("ruleId"),{}).get("properties",{}).get("security-severity","0"))
        assert severity < 7, "High-severity CodeQL finding blocks release"
(release/"codeql-report.sarif").write_text(json.dumps({"version":"2.1.0","runs":codeql_runs},indent=2)+"\n")
report_files = {}
for name in ("defender.json","clamav.json","semgrep.json","cargo-audit.json","source-summary.json","source-files.json","codeql-report.sarif"):
    path = release/name
    report_files[name] = {"url":base+name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
evidence = {
    "schema":2,"version":version,"repository":"akiondev/darkwhispers","tag":"v"+version,
    "commit":os.environ["GITHUB_SHA"],"run_id":int(os.environ["GITHUB_RUN_ID"]),
    "run_url":"https://github.com/akiondev/darkwhispers/actions/runs/"+os.environ["GITHUB_RUN_ID"],
    "source_url":"https://github.com/akiondev/darkwhispers/tree/"+os.environ["GITHUB_SHA"],
    "release_url":"https://github.com/akiondev/darkwhispers/releases/tag/v"+version,
    "workflow":".github/workflows/release.yml","checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "artifacts":artifacts,"reports":report_files,"source":source,
    "scanners":{"defender":defender,"clamav":clam},
    "codeql":{"findings":sum(len(run.get("results",[])) for run in codeql_runs),"languages":["JavaScript","Python"],"report":report_files["codeql-report.sarif"]},
    "attestation":{"type":"https://slsa.dev/provenance/v1","verification_command":"gh attestation verify <downloaded-file> --repo akiondev/darkwhispers --signer-workflow akiondev/darkwhispers/.github/workflows/release.yml"},
    "limits":source["limits"]
}
(release/"release-evidence.json").write_text(json.dumps(evidence,indent=2)+"\n")
(release/"SHA256SUMS.txt").write_text("".join(hashlib.sha256(path.read_bytes()).hexdigest()+"  "+path.name+"\n" for path in sorted(release.iterdir()) if path.is_file()))
notes = f"""Built from commit {evidence['commit']} in a public GitHub Actions run:
{evidence['run_url']}

The release files, complete scan reports, source inventory and checksum list have
GitHub/Sigstore build-provenance attestations. Release immutability is enabled.
Verify any downloaded file with:

    {evidence['attestation']['verification_command']}

Defender and ClamAV reported zero detections for every listed package.
RustSec advisory notes and all Semgrep findings remain in the full reports.
Open release-evidence.json for exact hashes, source, tool results and limitations.

Attestations prove origin and integrity, not that the software is risk-free.
Windows installers are unsigned. Linux download targets Debian/Ubuntu x64.
"""
(root/"release-notes.md").write_text(notes)
print(json.dumps({"version":version,"artifacts":len(artifacts),"run":evidence["run_url"]}))
