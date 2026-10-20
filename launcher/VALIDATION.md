# Current release 0.1.2 — 2026-10-20

Frost visual release: blue palette, crystal branding, subtle mist and button
animation, reduced-motion support. Installation logic is unchanged.

Verification repeated for the actual 0.1.2 artifacts:

- Windows: 9 core tests plus live signed-catalog integration passed.
- Linux: 10 core tests plus live signed-catalog integration passed.
- Windows NSIS install/uninstall and installed executable hash passed in the
  project test directory; test registration removed.
- Debian install/uninstall, executable hash, runtime dependencies and desktop
  entry passed in a disposable container.
- Native frontend preview: folder choice, install, removal dialog and cancel
  smoke-tested through the isolated browser test adapter.
- Defender and ClamAV: zero detections for the exact release files.
- Full current reports are published under the website's security directory.

The browser preview verifies frontend layout and behavior; it does not replace
running the GUI on every supported desktop. Windows remains unsigned. No macOS
artifact is available yet.

## Previous 0.1.1 validation

ZIP dependency upgraded to 9.0.5. Windows: 9 core tests and live HTTPS integration
passed. Linux: 10 core tests and live HTTPS integration passed. The Windows
installer/uninstaller and Debian package install/removal checks passed again.

Microsoft Defender scanned the release files with signatures 1.461.118.0 and
found no threats. RustSec reports zero vulnerability entries and two informational
advisories, both disclosed without ignores. The manual source review, dates,
engine versions and exact hashes are published at:
https://darkwhispers.akion.se/security/release-checks.json

Windows SHA-256:
b24e31b8a7e01b40b15877efdea57a099be4592c8ee24c35f434b4e6e261d6e0

Debian SHA-256:
5a0c4ab2c189c696adf4acf85659189c541d8de4d4cc3b270590e71ae6d10790

Browser installer: 11 disk-safety tests and the real browser File System
handle/private-sandbox end-to-end check passed. The production frost animation,
OS selection, manual platform menu, reports, addon dialog and responsive layout
were visually checked.

## Historical release 0.1.0 validation

- Linux core tests: 10 passed, plus the explicit live HTTPS integration test.
- Windows core tests: 9 passed, plus the explicit live HTTPS integration test.
  The extra Linux test checks symlink refusal; Windows builds use reparse-point checks.
- Tests cover supported Retail folders, package hashes and signatures, archive
  traversal and duplicate paths, upgrades, removal, downgrade blocking, operation
  locking, and preservation of other addons and WoW saved settings.
- Live integration downloaded the actual signed catalog and addon ZIP from
  `https://darkwhispers.akion.se/`, then installed and removed the addon in a
  temporary WoW fixture. The user's real installation was not changed.
- Windows NSIS installer and uninstaller ran successfully in an isolated project
  directory. The installed executable matched the built executable after Tauri's
  expected NSIS bundle-type marker patch. Test registry entries were removed.
- Debian package installed and uninstalled in a disposable container. Executable
  hash, dynamic dependencies and desktop entry were verified.
- Browser GUI checks used the real frontend and an in-memory test bridge:
  folder selection, installation, update, removal, Cancel, Escape after a prior
  removal, download errors, recovery, and minimum window width.
- The published website was checked on desktop and mobile. Actual public downloads
  matched local SHA-256 hashes; the Windows button was also downloaded in a browser.

## Practical limits

This is an initial beta. Native graphical interactions have not been exercised on
each operating system; the GUI checks were browser-based. Linux desktop compatibility
across distributions remains to be tested. The published Linux package is for
Debian/Ubuntu x64; an AppImage was built but is not published pending additional checks.
No macOS binary has been built: that requires a Mac build environment.

The Windows installer is unsigned. No third-party security audit or safety
certification has been performed. GitHub publication is pending the owner's repo.

## Published binary hashes

Windows installer (2,005,769 bytes):
`6085c198fb10a88a5752cdd3dc56d5a2c481aa59574cb6eb3f2b86f9ed35a3a7`

Debian package (2,796,160 bytes):
`166126190ada89373d7eb5eef65bb9a571d5ebeff773815a06a662bdcfd3547c`
