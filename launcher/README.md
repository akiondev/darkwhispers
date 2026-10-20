# DarkWhispers Addons

A small desktop addon manager for WoW Retail. Rust handles files, downloads and
verification; Tauri uses the operating system's webview for the interface.
The interface is plain HTML, CSS and JavaScript. There are no accounts, analytics,
ads, background services or periodic polling.

## Use

Open the launcher, choose the World of Warcraft folder if it was not detected,
then use Install, Update or Remove. Check for updates refreshes the catalog.
Restart WoW or reload its UI after changing an addon.

Both addon sources are public under the repository's addons directory. Only
DarkWhisper Raid Tools is currently in the signed launcher catalog.
The launcher accepts the WoW root, `_retail_`, or its `Interface/AddOns` folder.
Classic installations are rejected. Linux users select their Wine/Lutris WoW
installation; this app does not install or configure Wine or World of Warcraft.
The initial Linux download is a small Debian/Ubuntu x64 `.deb` package. Its GTK
and WebKit dependencies are provided by the distribution's package manager.
Install with your software installer, or `sudo apt install ./<downloaded-file>.deb`.
Debian 12 and newer is the build baseline. Other distributions and the generated
AppImage need desktop compatibility checks before publication.

Saved settings in `WTF` and unrelated addons are never edited. A replaced or removed
addon is moved into `Interface/AddOns/.darkwhispers-backups/<unique name>/`.
Backups are retained, not automatically pruned. The live addon folder is replaced
as a whole so removed files do not linger after updates. If the final rename fails,
the previous addon is restored; an interrupted process may require restoring the
backup manually.

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
Windows SDK, or the isolated Linux cross-build described below. macOS requires
a Mac with Xcode command line tools. Linux requires WebKitGTK 4.1 and the Tauri
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

The initial Windows installer is unsigned. Catalog signing is separate from
Windows Authenticode and does not suppress SmartScreen prompts. No security
certification or third-party audit is claimed. Launcher self-updates are not
implemented; download a new launcher release from the website.

## Source publication

The launcher code is MIT licensed. The owner will create the public GitHub repository
separately. Do not publish private keys, `.tools`, build caches or credentials.
The addon is a separate project; this license covers the launcher, not Blizzard
assets or third-party dependencies. Dependency license notices are generated during
release preparation. No paid signing service or paid hosting product is required
by this code.
