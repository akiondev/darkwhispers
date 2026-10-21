# DarkWhispers Addons

A small desktop addon manager for WoW Retail. Rust handles files, downloads and
verification; Tauri uses the operating system's webview for the interface.
The interface is plain HTML, CSS and JavaScript. There are no accounts, analytics,
ads or system services. Automatic addon checks are opt-in and off by default.

## Use

Open the launcher, choose the World of Warcraft folder if it was not detected,
then use Install, Update or Remove. Check for updates refreshes the catalog.
Restart WoW or reload its UI after changing an addon.

Only DarkWhispers Raid Tool is distributed in the signed launcher catalog and current public source. AkionUI is private and excluded from new exports/releases.
The launcher accepts the WoW root, `_retail_`, or its `Interface/AddOns` folder.
Classic installations are rejected. Linux users select their Wine/Lutris WoW
installation; this app does not install or configure Wine or World of Warcraft.
The initial Linux download is a small Debian/Ubuntu x64 `.deb` package. Its GTK
and WebKit dependencies are provided by the distribution's package manager.
Install with your software installer, or `sudo apt install ./<downloaded-file>.deb`.
Debian 12 and newer is the build baseline. Other distributions and the generated
AppImage need desktop compatibility checks before publication.

Saved settings in WTF and unrelated addons are never edited. Completed addon
updates do not retain previous versions. A temporary copy and small journal
protect the directory swap; both are cleared once the update commits. Interrupted
swaps wait for a manually approved install or removal before recovery. Status checks never modify the WoW addon directory. Reinstall downloads the signed latest
release again; Remove deletes only the selected known addon directory.

The custom window minimizes to the system tray where a tray is available.
Left-click the tray icon or choose Open to return; Quit exits. Closing the window
also exits. Optional background checks only report available updates every five minutes. They never install addons. Install, update and reinstall require explicit approval of the displayed version; launcher updates do not change addons. With the option off there are no background update timers or
catalog requests. Manual startup/check actions can still fetch current metadata.
No operating-system autostart entry is created.

Trust & reports shows the recorded scan results and opens complete readable
reports in the browser. The purple button opens source code; the orange button
opens the original GitHub release files for the user's own review. Neither
GitHub nor a scan result is a guarantee of safety.

## Build

Install stable Rust and the official Tauri v2 prerequisites for your operating
system, then install the free Tauri CLI:

```sh
npm install --global @tauri-apps/cli@2
cargo test -p darkwhispers-core
python build-tools/licenses.py
cd src-tauri
tauri build
```

The workspace `Cargo.lock` pins Rust dependencies. Windows requires MSVC and a
Windows SDK, or the isolated Linux cross-build described below. Linux requires WebKitGTK 4.1 and the Tauri
system packages. Build on each target operating system for release validation.

For the provided Docker builder:

```sh
docker build -t darkwhispers-builder:0.1 build-tools
docker run --rm --cpus=2 --memory=4g -v "$PWD:/work" darkwhispers-builder:0.1 \
  cargo test -p darkwhispers-core
docker run --rm --cpus=2 --memory=4g -v "$PWD:/work" -w /work/src-tauri \
  darkwhispers-builder:0.1 \
  tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
```

The first release was cross-compiled in Debian and packaged on Windows using
`build-tools/bundle-windows.ps1`. Copy the built executable into the same
`target/x86_64-pc-windows-msvc/release` path on Windows before bundling.
Packaging requires Rust and the Tauri CLI, but does not compile C++.
Older Linux-distribution NSIS packages may lack headers required by current Tauri.

The frontend can be previewed with any static HTTP server in `ui/`. In a browser
it is explicitly a design preview and cannot change files.

`build-tools/prepare-ui-test.py` prepares `/tests/ui.html` when serving `launcher/`.
That page uses an explicitly isolated in-memory bridge for checking GUI actions.
It is outside `frontendDist` and is never bundled in the app.

## Release integrity

The app only accepts HTTPS downloads from `darkwhispers.akion.se`. The addon catalog
has an Ed25519 signature verified with the public key compiled into the launcher.
Each ZIP is checked against its signed SHA-256 hash. Archive extraction blocks
traversal, links, Windows device names, duplicate paths and unsupported file types,
and enforces download/extraction limits. A filesystem lock prevents concurrent
operations on one AddOns folder. Updates cannot downgrade a newer installed version.

The private catalog signing key stays outside this repository. Back it up securely;
losing it prevents signing updates for existing launcher builds. Do not put it in
the website, release archive, Docker context or GitHub. The website packaging script
must run before publishing a changed addon catalog. In the parent project:

```sh
python website/tools/package.py
node launcher/build-tools/publish-catalog.mjs
```

`--init-key` is only for the initial key creation. An existing compiled public key
must never be silently replaced. App binaries should be rebuilt when the bundled
catalog changes; older builds can use newly signed online catalogs without rebuilding.

Addon updates do not require a launcher update. Use Check updates in an addon row
to fetch the signed catalog, then Update to install that addon. Compact rows show
the installed and latest versions, release date and expandable release notes.
Cached/offline results are labeled and never claim to be up to date. Returning to
the foreground refreshes the list after one minute without a background timer.
Maintain website/addon-releases.json with the addon's version, release date and
summary before signing a changed catalog. Its publication date also prevents an
older cached catalog from hiding a newer bundled catalog while offline.

The initial Windows installer is unsigned. Catalog signing is separate from
Windows Authenticode and does not suppress SmartScreen prompts. No security
certification or third-party audit is claimed. Windows launcher updates use the
official Tauri updater, a pinned separate public key and version-bound signatures.
The update button downloads an immutable GitHub installer, verifies its signature
and signed version, then installs and restarts. Linux uses normal .deb upgrades.
macOS is not supported.

The updater private key stays local. After the GitHub release passes its public
checks, import-github-release.py can sign the verified installer locally with
--updater-key and --tauri. Only the public signature goes into launcher/latest.json.
Never upload either private key or commit it. Keep an encrypted offline copy of
the keys before moving maintenance to another computer. A local DPAPI backup
protects copies at rest but does not replace an off-device backup.

For a bad release, publish a corrected higher version; automatic downgrades are
not allowed. To stop new addon installs, publish a correctly signed catalog that
withdraws the affected addon. For a website failure, restore its previous release
symlink using the retained deployment directories. Never overwrite an immutable
GitHub release or replace signing keys silently.

## Source publication

The launcher code is MIT licensed and public at
https://github.com/akiondev/darkwhispers. Do not publish private keys, `.tools`,
build caches or credentials. See ../docs/VERIFY.md for public build provenance,
complete scan reports and immutable release verification.
The addon is a separate project; this license covers the launcher, not Blizzard
assets or third-party dependencies. Dependency license notices are generated during
release preparation. No paid signing service or paid hosting product is required
by this code.

Launcher release checks run at startup and every 15 minutes, even in the tray.
A new launcher version triggers one desktop notification per session and a clear
in-app alert. Addon updates only show in-app alerts and need separate approval.
