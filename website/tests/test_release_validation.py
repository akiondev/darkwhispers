"""Release mirroring must reject inconsistent evidence before writing public files."""
import copy
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "release_validation", Path(__file__).resolve().parents[1] / "tools/release_validation.py")
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        fixture_root = Path(__file__).resolve().parents[1] / "build/release-tests"
        fixture_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=fixture_root)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.version = "0.1.4"
        prefix = "https://github.com/akiondev/darkwhispers/releases/download/v0.1.4/"
        names = ["DarkWhispers-Addons-0.1.4-windows-x64-setup.exe",
                 "DarkWhispers-Addons-0.1.4-linux-amd64.deb",
                 "DarkWhisperRaidTools-1.0.0.zip"]
        reports = ["defender.json", "clamav.json", "semgrep.json", "cargo-audit.json",
                   "source-summary.json", "source-files.json", "codeql-report.sarif"]
        self.checksums = {}
        for name in names + reports:
            data = ("fixture: " + name).encode()
            (self.directory / name).write_bytes(data)
            self.checksums[name] = hashlib.sha256(data).hexdigest()
        artifacts = [{"filename": name, "url": prefix + name, "sha256": self.checksums[name],
                      "bytes": (self.directory / name).stat().st_size} for name in names]
        scanned = [{key: item[key] for key in ("filename", "sha256", "bytes")} for item in artifacts]
        scan = {"status": "passed", "exit_code": 0, "detections": 0, "artifacts": scanned}
        self.evidence = {
            "schema": 2, "repository": "akiondev/darkwhispers", "version": self.version,
            "tag": "v" + self.version, "commit": "a" * 40, "run_id": 42,
            "run_url": "https://github.com/akiondev/darkwhispers/actions/runs/42",
            "source_url": "https://github.com/akiondev/darkwhispers/tree/" + "a" * 40,
            "release_url": "https://github.com/akiondev/darkwhispers/releases/tag/v0.1.4",
            "workflow": ".github/workflows/release.yml", "artifacts": artifacts,
            "reports": {name: {"url": prefix + name, "sha256": self.checksums[name]} for name in reports},
            "scanners": {"defender": copy.deepcopy(scan), "clamav": copy.deepcopy(scan)},
            "source": {"commit": "a" * 40, "rustsec": {"vulnerabilities": 0, "ignored": []},
                       "semgrep": {"errors": 0}},
        }

    def validate(self):
        validation.validate_evidence(self.evidence, self.version, self.checksums, self.directory)

    def test_complete_release(self):
        self.validate()

    def test_private_addon_is_not_a_public_release_package(self):
        item = copy.deepcopy(self.evidence["artifacts"][-1])
        item["filename"] = "AkionUI-0.8.1.zip"
        self.evidence["artifacts"][-1] = item
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_or_duplicate_platform(self):
        self.evidence["artifacts"][1] = self.evidence["artifacts"][0]
        with self.assertRaises(ValueError):
            self.validate()

    def test_scanner_cannot_claim_pass_with_detections(self):
        self.evidence["scanners"]["defender"]["detections"] = 1
        with self.assertRaises(ValueError):
            self.validate()

    def test_scan_must_cover_exact_package_bytes(self):
        self.evidence["scanners"]["clamav"]["artifacts"][0]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.validate()

    def test_wrong_release_link(self):
        self.evidence["release_url"] = "https://example.com/report"
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_report(self):
        del self.evidence["reports"]["defender.json"]
        with self.assertRaises(ValueError):
            self.validate()

    def test_tampering_after_download(self):
        (self.directory / "defender.json").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            self.validate()

    def test_checks_are_explicit_even_in_optimized_python(self):
        with self.assertRaises(ValueError):
            validation.require(False, "must reject")


if __name__ == "__main__":
    unittest.main()
