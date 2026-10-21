# DarkWhispers maintainer review notes

Release: launcher 0.3.7 and DarkWhispers Raid Tool 1.0.4.
Scope: implementation notes, not an independent audit or security certification.
The original automated reports, source commit and exact package hashes are in
the immutable GitHub release and its public workflow.

The default marker preset starts with Skull at north, followed clockwise by Triangle, Moon, Square, Cross, Star, Circle and Diamond. Existing saved layouts are preserved. The existing WoW stub was used locally to check the preset, rendered positions and layout preservation; this is separate from workflow-run checks.

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

The shared hooded logo, native icons and crimson theme replace the previous
crystal and crescent/star marks. The gothic font is self-hosted under the SIL
Open Font License; the runtime makes no external font requests. Website ZIP
links are populated from the independently verified signed addon catalog.

Addon versions come from the independently signed online catalog. Per-addon checks
do not use the launcher self-updater. Compact rows show installed/latest versions,
the release date and expandable notes. A cached result is labeled explicitly and
cannot display Up to date. The list refreshes on return to the foreground after
one minute; no periodic timer or automatic install is added while auto-update is off.
Older saved catalogs cannot hide a more recent bundled catalog during offline fallback.

The custom frame uses native window operations. A system tray offers Open and
Quit; unsupported desktop trays fall back to normal taskbar minimization.
Background addon checks are off by default and only report updates; they never install. No addon check timer runs when the option is off.
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

## Identity and compact controls

Cinzel Bold is a self-hosted, renamed Latin subset under its embedded SIL OFL.
The background check toggle sits above the addon list; only manual approved operations can install addons.
Undecorated window shadow is disabled to avoid Tauri’s extra Windows border;
the custom frame remains. The landing page links to GitHub reports rather than
fetching duplicate scan cards. The raid addon has an original tools mark and
unchanged saved settings and compass behavior.

## Raid addon appearance

The menu retains its layout and handlers, with launcher-inspired colors. The
compass ring, arrow and cardinals use light blue; standard raid icon colors
remain intact. Carlito Regular is bundled unmodified, with its full SIL OFL
notice in Core.lua. Existing native/browser font support is used; no installer
file types or permissions are expanded. /dwrt is the sole addon command.

## Explicit addon approval

Automatic addon installation is removed, including the background install path.
Legacy auto_update preferences do not enable background checks. Status reads no
longer perform recovery writes: interrupted operations wait for a manually
approved install or removal. Manual installation binds approval to the displayed
version and rejects a changed catalog version. Launcher packages contain no addon
runtime files and their updater does not invoke addon installation.

## Update notifications

Launcher versions are checked at startup and every 15 minutes while open. A new
launcher version sets the tray tooltip and emits one native notification per
version per running session. The in-app banner remains until updated. Addon
checks emit only in-app status, never desktop notifications or installation.
