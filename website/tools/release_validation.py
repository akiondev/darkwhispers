"""Validate a complete, attested release before changing the website mirror."""
import hashlib
import re

REPOSITORY = "akiondev/darkwhispers"


def require(condition, message):
    # Security checks must remain enabled with PYTHONOPTIMIZE / python -O.
    if not condition:
        raise ValueError(message)


def validate_evidence(evidence, version, checksums, directory):
    prefix = f"https://github.com/{REPOSITORY}/releases/download/v{version}/"
    require(evidence["schema"] == 2 and evidence["repository"] == REPOSITORY
            and evidence["version"] == version and evidence["tag"] == "v" + version,
            "Release identity mismatch")
    require(re.fullmatch(r"[a-f0-9]{40}", evidence["commit"]), "Invalid source commit")
    require(type(evidence["run_id"]) is int and evidence["run_id"] > 0, "Invalid build run")
    require(evidence["run_url"] == f"https://github.com/{REPOSITORY}/actions/runs/{evidence['run_id']}"
            and evidence["release_url"] == f"https://github.com/{REPOSITORY}/releases/tag/v{version}"
            and evidence["source_url"] == f"https://github.com/{REPOSITORY}/tree/{evidence['commit']}"
            and evidence["workflow"] == ".github/workflows/release.yml", "Invalid provenance links")
    artifacts = evidence["artifacts"]
    names = [item["filename"] for item in artifacts]
    require(len(names) == 3 and len(set(names)) == 3, "Exactly three distinct public packages are required")
    require(f"DarkWhispers-Addons-{version}-windows-x64-setup.exe" in names
            and f"DarkWhispers-Addons-{version}-linux-amd64.deb" in names
            and sum(bool(re.fullmatch(r"DarkWhisperRaidTools-\d+\.\d+\.\d+\.zip", name)) for name in names) == 1,
            "Unexpected package inventory")
    for item in artifacts:
        name = item["filename"]
        require(item["url"] == prefix + name and item["sha256"] == checksums.get(name),
                "Package identity mismatch: " + name)
        require(type(item["bytes"]) is int and 0 < item["bytes"] == (directory / name).stat().st_size,
                "Package size mismatch: " + name)
    required_reports = {"defender.json", "clamav.json", "semgrep.json", "cargo-audit.json",
                        "source-summary.json", "source-files.json", "codeql-report.sarif"}
    require(set(evidence["reports"]) == required_reports, "Incomplete release reports")
    for name, item in evidence["reports"].items():
        require(item["url"] == prefix + name and item["sha256"] == checksums.get(name),
                "Report identity mismatch: " + name)
    for scanner in ("defender", "clamav"):
        scan = evidence["scanners"][scanner]
        require(scan["status"] == "passed" and scan["exit_code"] == 0 and scan["detections"] == 0,
                scanner + " did not pass")
        scanned = scan["artifacts"]
        require(len(scanned) == 3 and {item["filename"] for item in scanned} == set(names),
                scanner + " package inventory mismatch")
        for package in artifacts:
            require(any(all(item.get(key) == package[key] for key in ("filename", "sha256", "bytes"))
                        for item in scanned), scanner + " scanned a different package")
    source = evidence["source"]
    require(source["commit"] == evidence["commit"], "Source report commit mismatch")
    require(source["rustsec"]["vulnerabilities"] == 0 and not source["rustsec"]["ignored"],
            "Dependency vulnerabilities or ignored advisories")
    require(source["semgrep"]["errors"] == 0, "Source analysis was incomplete")
    # Recheck every byte immediately before any public mirror file is written.
    for name, digest in checksums.items():
        require(re.fullmatch(r"[A-Za-z0-9_.-]+", name) and re.fullmatch(r"[a-f0-9]{64}", digest),
                "Unsafe checksum entry")
        require(hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest,
                "Release file changed: " + name)
