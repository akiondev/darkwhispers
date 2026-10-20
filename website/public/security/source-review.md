# DarkWhispers source review — 2026-10-20

Release: launcher 0.1.2 and the frost website/browser installer.
Review type: manual code review by the development assistant, backed by automated
tests and separately published RustSec, Defender, ClamAV and Semgrep results. This is not an
independent audit or a security certification.

## Changes resulting from this review

- Updated the launcher's zip dependency from 6.0.0 to 9.0.5. RustSec advisories
  RUSTSEC-2026-0367, RUSTSEC-2026-0368 and RUSTSEC-2026-0369 are no longer reported.
  The launcher uses bounded extraction rather than ZipArchive::extract.
- Browser installation verifies an Ed25519-signed catalog, validates paths and
  metadata, then checks each downloaded file's SHA-256 and length before writing.
  It uses no ZIP parser, third-party script, account or uploaded folder data.
- Fixed rollback around a partially failed recursive removal. The live-mutation
  flag is set before removal starts, so partial deletion triggers restoration.
- Prepared files and any previous addon backup are written and read back for
  integrity verification before replacing the live addon. Failed writes restore
  the previous files where permission and disk conditions allow.
- Existing empty directories are preserved in backups. Download sizes, recursion,
  file counts and total memory usage are bounded. Unsafe paths, Windows device
  names, duplicate filenames, unknown addon folders and downgrades are rejected.
- Catalog/report text uses textContent; the only HTML insertion is a fixed,
  local set of OS icons. Launcher download links are restricted to the same site.
  Content Security Policy allows no third-party scripts.
- OS detection distinguishes desktop Windows, macOS and Linux, with a manual
  selector. Mobile devices do not receive a misleading desktop recommendation.
- Snowfall is capped at 24 fps, uses a capped canvas resolution, stops when the
  document is hidden, and respects reduced-motion preferences.
- The two installation entry points are separate primary buttons. Release
  evidence and full per-tool reports are visible without opening a dialog.
- Launcher 0.1.2 uses the same frost palette and original crystal art. The
  install/update/remove backend and permission model are unchanged.
- The public deployment verifier now uses a fixed HTTPS origin, explicit
  certificate validation and no redirects or file-URL handling.

## Verification

- Browser installer: 11 automated tests passed, including actual temporary disk
  writes, tampered signatures, corrupt files, traversal, rollback, partial deletion,
  upgrade backups, downgrade blocking and preservation of other addons/WTF.
- Browser end-to-end check: installed the seven actual release files through
  real File System handles in a private origin sandbox; verified their SHA-256
  hashes, previous-version backup and preserved OtherAddon/WTF files. The sandbox
  was removed afterwards. The host's real WoW folder was not used.
- Launcher 0.1.2: Linux core tests and live HTTPS integration passed. Windows core
  tests and live HTTPS integration passed. The NSIS installer/uninstaller were
  tested in a separate project directory and their executable hash checked.
- Debian package installation/removal and runtime dependencies are checked in a
  disposable container. This does not certify GUI compatibility on every desktop.

## Open dependency notes

The complete RustSec lockfile audit reports zero vulnerability entries and two
informational advisories. No advisory was ignored:

1. RUSTSEC-2024-0370: proc-macro-error 1.0.4 is unmaintained, through transitive
   dependencies. This is a maintenance warning.
2. RUSTSEC-2024-0429: glib 0.18.5 has an unsound VariantStrIter implementation,
   through the Linux GTK stack. Application code does not directly use this
   iterator. That does not prove affected code is unreachable in dependencies.
   Windows does not ship the Linux GTK stack. A future compatible GTK/Tauri
   upgrade is still needed to remove this informational warning.

The page displays these notes rather than an unqualified clean audit.
See dependency-audit.json for the complete RustSec report.

## Additional scanning

Microsoft Defender and ClamAV scanned the exact Windows installer, Linux package
and addon archive listed in release-checks.json. Both reported zero detections.
ClamAV 1.5.4 used 3,628,175 signatures with recursive archive scanning enabled.
Full console output, engine/database metadata, dates and SHA-256 hashes are
published in defender-report.json and clamav-report.json.

Semgrep Community Edition ran the security-audit and secrets rule sets locally,
with telemetry disabled. Its one remaining API-usage audit note is retained in
the full original JSON. The supported verifier uses Python 3.12.3 with an explicit
validating TLS context. See semgrep-review.md for the assessment and scope.
No finding was suppressed. Community rules do not establish full Rust or
whole-program coverage.

These tools were run by the project maintainer; their results are not an
independent third-party endorsement.

## Limits

Direct host-folder writes require a supporting desktop browser, HTTPS, and the
user's explicit folder permission. Firefox/Safari do not currently provide this
picker/write flow. Browser or operating-system policy may block protected
locations. ZIP downloads and the desktop launcher remain available.

Browser directory replacement is not atomic. Keep WoW and other addon managers
closed during installation. An interrupted tab or revoked permission can require
manual restoration from Interface/AddOns/.darkwhispers-web-backups/.
Browser Web Locks coordinate tabs on this origin, not other desktop apps.

Windows builds remain unsigned. No macOS build is published. The owner has not
yet created the public GitHub repository. Malware checks are dated results for
exact file hashes, not a claim that software can never contain bugs or malware.

## Primary references

- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://rustsec.org/advisories/RUSTSEC-2026-0367.html
- https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus
