"""Readable download links above optional verification files on GitHub Releases."""
import re


def render_release_notes(evidence, changelog):
    version = evidence["version"]
    files = {item["filename"]: item["url"] for item in evidence["artifacts"]}
    windows = files[f"DarkWhispers-Addons-{version}-windows-x64-setup.exe"]
    linux = files[f"DarkWhispers-Addons-{version}-linux-amd64.deb"]
    addon_name = next(name for name in files if re.fullmatch(r"DarkWhisperRaidTools-\d+\.\d+\.\d+\.zip", name))
    addon_version = addon_name.removeprefix("DarkWhisperRaidTools-").removesuffix(".zip")
    base = f"https://github.com/akiondev/darkwhispers/releases/download/v{version}/"
    changes = next((item["changes"] for item in changelog["entries"] if item["version"] == version), [])
    bullets = "\n".join("- " + change for change in changes)
    return f"""## Downloads

| What you want | Direct download |
| --- | --- |
| **Windows launcher {version}** | [Download Windows installer (.exe)]({windows}) |
| **Linux launcher {version}** | [Download Debian / Ubuntu package (.deb)]({linux}) |
| **Addon only · DarkWhispers Raid Tool {addon_version}** | [Download addon ZIP · no launcher needed]({files[addon_name]}) |

For the addon ZIP, extract **DarkWhisperRaidTools** into your WoW Retail
`_retail_/Interface/AddOns/` folder, then restart WoW or `/reload`.
Addon updates can also be checked and installed separately inside the launcher.
Windows installers are unsigned. Linux packages target x64 Debian / Ubuntu.

## Latest changes

{bullets}

<details>
<summary>Optional: complete scan reports, hashes and signed build evidence</summary>

The JSON, SARIF and TXT assets below are verification reports and developer logs.
They are **not required to install or use the launcher or addon**.

- [Exact release evidence]({base}release-evidence.json)
- [SHA-256 checksums]({base}SHA256SUMS.txt)
- [Microsoft Defender report]({base}defender.json) · [ClamAV report]({base}clamav.json)
- [CodeQL report]({base}codeql-report.sarif) · [Semgrep report]({base}semgrep.json)
- [RustSec dependency audit]({base}cargo-audit.json)
- [Public build and scan run]({evidence['run_url']})
- [Exact source commit](https://github.com/akiondev/darkwhispers/tree/{evidence['commit']})

Defender and ClamAV reported zero detections for every package. All dependency
advisories and source findings remain in the reports. Files and the release tag
are immutable; verify a downloaded file using:

```sh
{evidence['attestation']['verification_command']}
```

Attestations prove workflow origin and file integrity, not that software is risk-free.

</details>
"""
