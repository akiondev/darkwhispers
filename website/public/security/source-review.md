# DarkWhispers maintainer review notes

Release: launcher 0.3.0 and DarkWhispers Raid Tool 1.0.1.
Scope: implementation notes, not an independent audit or security certification.
The original automated reports, source commit and exact package hashes are in
the immutable GitHub release and its public workflow.

## Installation and storage

Only the signed public raid addon is distributed. AkionUI is excluded from new
exports and release packages; previously published Git history and old immutable
releases may still contain files that were public at the time.

Downloads use HTTPS, an Ed25519-signed catalog and SHA-256 package/file checks.
Archive paths, links, size limits and installed-folder identity are checked.
A temporary previous directory and journal protect native swaps. Completed
updates delete that temporary copy; no restore/history feature retains old
versions. The browser installer uses verified staging and temporary copy-based
rollback; a closed tab or lost permission can still interrupt browser recovery.

## Desktop behavior

The custom frame uses native window operations. A system tray offers Open and
Quit; unsupported desktop trays fall back to normal taskbar minimization.
Automatic addon updates are off by default, update installed addons only, and
wait while WoW is running. With the option off no background catalog timer runs.
There are no accounts, telemetry, autostart entries or system services.

External browser targets are selected from a fixed resource allowlist.
Report content and catalog text render as text, not executable HTML.
Both desktop and website make the direct GitHub route visible for personal
source/build verification without claiming that any route is risk-free.

## Verification scope

The release workflow records the exact checks run. Targeted browser checks cover
folder selection, update cleanup and rollback on write/deletion failure. Core
checks cover integrity, safe paths, opt-in settings, temporary-swap recovery and
preservation of unrelated addon/WTF files. Installer/package checks run on clean
GitHub hosts. Source and binary scans retain all informational notes/findings.

Visual/browser checks and manual desktop testing complement these tests; they
do not certify every desktop or WoW encounter. Windows installers remain without
Authenticode publisher signing. Read the original RustSec report for every
transitive dependency advisory. No report or provenance claim guarantees safety.
