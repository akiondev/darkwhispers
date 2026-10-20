"""Verify GitHub provenance and mirror an immutable release. Never build locally.

Uses an existing GitHub CLI login; credentials are not read or written here.
The public website cannot verify its own honesty: visitors verify on GitHub.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from release_validation import require, validate_evidence

args = argparse.ArgumentParser()
args.add_argument("--version",required=True)
args.add_argument("--gh",default="gh")
options = args.parse_args()
require(re.fullmatch(r"\d+\.\d+\.\d+",options.version), "Invalid release version")
repo = "akiondev/darkwhispers"
tag = "v"+options.version
site = Path(__file__).resolve().parents[1]
public = site/"public"
directory = site/"build"/("github-"+tag)
directory.mkdir(parents=True,exist_ok=True)

def gh(*arguments):
    return subprocess.check_output([options.gh,*arguments],text=True,encoding="utf-8")

metadata = json.loads(gh("api","repos/"+repo+"/releases/tags/"+tag))
require(metadata["tag_name"] == tag and metadata["immutable"] and not metadata["draft"], "Only published immutable releases may be mirrored")
subprocess.run([options.gh,"release","download",tag,"--repo",repo,"--dir",str(directory),"--clobber"],check=True)
evidence_path = directory/"release-evidence.json"
evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
require(evidence["repository"] == repo and evidence["version"] == options.version, "Release identity mismatch")
require(re.fullmatch(r"[a-f0-9]{40}",evidence["commit"]), "Invalid source commit")
tag_object = json.loads(gh("api","repos/"+repo+"/git/ref/tags/"+tag))["object"]
if tag_object["type"] == "tag":
    tag_object = json.loads(gh("api","repos/"+repo+"/git/tags/"+tag_object["sha"]))["object"]
require(tag_object["type"] == "commit" and tag_object["sha"] == evidence["commit"], "Release tag differs from attested source")
checksums = {}
for line in (directory/"SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
    digest,name = line.split("  ",1)
    require(re.fullmatch(r"[a-f0-9]{64}",digest) and re.fullmatch(r"[A-Za-z0-9_.-]+",name), "Invalid checksum entry")
    require(name not in checksums, "Duplicate checksum entry")
    checksums[name] = digest
    require(hashlib.sha256((directory/name).read_bytes()).hexdigest() == digest, "Changed file: " + name)
verification = []
require({item["filename"] for item in evidence["artifacts"]}.issubset(checksums), "Missing package checksums")
require(all(re.fullmatch(r"[A-Za-z0-9_.-]+",item["filename"]) for item in evidence["artifacts"]), "Unsafe package name")
for name in ["release-evidence.json","SHA256SUMS.txt"]+[item["filename"] for item in evidence["artifacts"]]:
    result = json.loads(gh("attestation","verify",str(directory/name),"--repo",repo,
                          "--signer-workflow",repo+"/.github/workflows/release.yml",
                          "--source-digest",evidence["commit"],"--source-ref","refs/heads/main",
                          "--deny-self-hosted-runners","--format","json"))
    require(result, "No verified attestation")
    verification.append({"file":name,"result":result})
require(checksums["release-evidence.json"] == hashlib.sha256(evidence_path.read_bytes()).hexdigest(), "Evidence changed")
validate_evidence(evidence, options.version, checksums, directory)
prefix = "https://github.com/"+repo+"/releases/download/"+tag+"/"
platforms = {}
for item in evidence["artifacts"]:
    name = item["filename"]
    require(item["url"] == prefix+name, "Invalid package URL")
    platform = "windows" if name.endswith("-windows-x64-setup.exe") else "linux" if name.endswith("-linux-amd64.deb") else None
    if platform:
        destination = public/"launcher/downloads"/name
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(directory/name,destination)
        platforms[platform] = {
            "url":"/launcher/downloads/"+name,"sha256":item["sha256"],"bytes":item["bytes"],
            "label":("v"+options.version+" · x64 · "+str(round(item["bytes"]/1024/1024,1))+" MB") if platform=="windows" else "Debian / Ubuntu · .deb",
            "github_url":item["url"]
        }
    elif name.endswith(".zip"):
        destination = public/"downloads"/name
        shutil.copyfile(directory/name,destination)
require(set(platforms) == {"windows","linux"}, "Missing launcher platform")
release = {"version":options.version,"platforms":platforms,"note":"Public GitHub build · Windows installer is unsigned.","github_release":evidence["release_url"]}
(public/"launcher/releases.json").write_text(json.dumps(release,indent=2)+"\n")
(public/"launcher/downloads/SHA256SUMS.txt").write_text("".join(item["sha256"]+"  "+Path(item["url"]).name+"\n" for item in platforms.values()))
target = public/"security"
target.mkdir(exist_ok=True)
for name,destination in (("defender.json","defender-report.json"),("clamav.json","clamav-report.json"),
                         ("semgrep.json","semgrep-report.json"),("cargo-audit.json","dependency-audit.json"),
                         ("release-evidence.json","release-evidence.json"),("codeql-report.sarif","codeql-report.sarif")):
    shutil.copyfile(directory/name,target/destination)
source = evidence["source"]
defender = evidence["scanners"]["defender"]
clam = evidence["scanners"]["clamav"]
report = {
    "schema":2,"version":options.version,"checked_at":evidence["checked_at"],
    "malware":defender,
    "artifacts":[{**item,"scan":{"status":"passed","detections":0,"scanner":"Microsoft Defender Antivirus","exit_code":0}} for item in evidence["artifacts"]],
    "scanners":{"clamav":{**clam,"artifacts":[{**item,"status":"passed"} for item in clam["artifacts"]]}},
    "static_analysis":{"status":"completed",**source["semgrep"],"report_url":evidence["reports"]["semgrep.json"]["url"],"summary":"Public GitHub-hosted Semgrep Community Edition scan. All findings are retained; see the original report and workflow logs."},
    "dependencies":{"status":"completed_with_notes" if source["rustsec"]["advisory_notes"] else "passed","vulnerabilities":source["rustsec"]["vulnerabilities"],"warnings":source["rustsec"]["advisory_notes"],"summary":"Public RustSec audit; no ignored advisories. Read all vulnerability entries and informational notes in the full report."},
    "source_review":{"status":"completed","method":"Public automated source analysis, not an independent human audit","summary":"Source and test code are public at the exact release commit. Tests and scans ran on GitHub-hosted runners; see the signed original evidence. Historical developer review is separate.","report_url":"/security/source-review.md"},
    "codeql":evidence["codeql"],
    "provenance":{"repository":repo,"commit":evidence["commit"],"run_url":evidence["run_url"],"source_url":evidence["source_url"],"release_url":evidence["release_url"],"immutable":metadata["immutable"],
                  "report_links":{"defender":prefix+"defender.json","clamav":prefix+"clamav.json","semgrep":prefix+"semgrep.json","rustsec":prefix+"cargo-audit.json","evidence":prefix+"release-evidence.json","codeql":prefix+"codeql-report.sarif"}},
    "limitations":evidence["limits"]
}
(target/"release-checks.json").write_text(json.dumps(report,indent=2)+"\n")
(site/"build/github-verification.json").write_text(json.dumps(verification,indent=2)+"\n")
print("Verified immutable GitHub release",tag,"at",evidence["commit"],"; mirrored exact attested binaries and reports.")
