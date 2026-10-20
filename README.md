# DarkWhispers

Open source raid tools for World of Warcraft Retail, with a small desktop addon
manager and a frost-themed download site.

[Website](https://darkwhispers.akion.se/) ·
[Downloads and complete reports](https://github.com/akiondev/darkwhispers/releases) ·
[Public builds](https://github.com/akiondev/darkwhispers/actions) ·
[Verify a download](docs/VERIFY.md)

## Project layout

| Folder | Contents |
| --- | --- |
| launcher/ | Rust installation core, Tauri desktop app, plain HTML/CSS/JS interface |
| website/ | Static download site, browser addon installer and scoped VPS deployment tools |
| addons/DarkWhisperRaidTools/ | Standalone marker compass, commands /dwrt and /acomp |
| addons/AkionUI/ | Moonkin warning, Bloodlust lockout and Soothe text, commands /aui and /akionui |
| tests/ | Simulated WoW API and addon regression tests |
| ci/ | Public build, scan, packaging and evidence scripts |
| .github/workflows/ | Source checks and attested release pipeline |
| docs/ | Usage, trust model and implementation research |

The two addons are independent. Only DarkWhisper Raid Tools is currently offered
by the signed launcher/browser catalog. Both addon sources and standalone ZIP
packages are public.

## Trust and verification

Published releases are built on GitHub-hosted runners from a named commit.
The workflow runs addon/browser/core tests, RustSec, Semgrep Community Edition,
CodeQL, Microsoft Defender and ClamAV. It publishes complete reports and exact
file hashes, with GitHub/Sigstore provenance attestations. Release immutability
locks published files and their release tag.

    gh attestation verify <downloaded-file> --repo akiondev/darkwhispers --signer-workflow akiondev/darkwhispers/.github/workflows/release.yml

This verifies origin and integrity, not that the application cannot contain
malware or bugs. Read the warnings and scope in each release's reports.
Historical reports produced on the maintainer's own machines are labelled as
such; committing a report does not turn it into an independent scan.

Windows installers are unsigned. The Linux package is for Debian/Ubuntu x64.
macOS builds are not published yet. No accounts, telemetry, subscriptions or
paid services are required to use the software.

## Development

See [launcher build instructions](launcher/README.md),
[website instructions](website/README.md) and the
[addon guide](docs/addons-guide.md).

Prepare the signed-catalog fixtures and both deterministic addon archives:

    python ci/prepare.py

Run the browser installer tests:

    node --test website/tests/browser-installer.test.mjs

Run the addon suite with Lua 5.1 from the addon parent directory:

    cd addons
    lua ../tests/smoke.lua

Run Rust core tests from launcher/:

    cargo test --locked -p darkwhispers-core

The tests simulate APIs and filesystem operations; they do not establish
compatibility during every WoW boss encounter or on every desktop.

## License

Original project code and artwork: [MIT](LICENSE).
Dependency notices retain their authors' licenses. World of Warcraft and its
in-game assets are Blizzard's; the project is not affiliated with Blizzard.
Private signing keys, credentials, WoW saved settings, caches and local builds
are excluded from this repository.
