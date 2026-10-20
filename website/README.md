# DarkWhispers website

Production URL: https://darkwhispers.akion.se/

Minimal English DarkWhispers page with animated frost-blue mist, snowfall,
an OS-selected glowing launcher button and a manual platform dropdown.
No npm packages, remote fonts,
analytics or browser storage. The website code and artwork are MIT licensed.
Reduced-motion preferences disable the background animation.

Only actual published installers are enabled, using `public/launcher/releases.json`.
Unavailable platforms stay labelled Coming soon. Public source:
https://github.com/akiondev/darkwhispers. Reports link directly to the public
release workflow and attested GitHub release assets when available.
Historical maintainer-run reports are labelled separately. No safety
certification is claimed. Launcher sources are maintained in ../launcher.

## Local preview

Serve `public/` with any static server. For example:

```text
python -m http.server 8783 --bind 127.0.0.1 --directory website/public
```

## Packaging

From the project root:

```text
python website/tools/package.py
```

This builds the existing DarkWhisper Raid Tools runtime as a deterministic ZIP,
checks every packaged file against the source, validates local HTML links and
generates a deployment archive and SHA-256 inventory in `website/build/`.
AkionUI, saved settings, research files and credentials are never packaged.
No addon runtime files are modified by this process.
CSS and JavaScript receive content-addressed filenames so cached old assets
cannot break a freshly deployed page.

If the addon version changes, update the download references, version labels
and release notes in `public/` before packaging. Archive older release downloads
when publishing new ones so existing links remain useful.

## VPS deployment

From Windows, run `website/deploy.ps1 -Python <path-to-python.exe>` to package,
upload, install and verify in order. The script requires the already configured
SSH identity and network/filesystem approval when enforced by the environment.

Configure the vps1-deploy SSH alias for your own authorized host, identity and
pinned host key. The scoped server installer requires permission to update this
site's Caddy snippet and release directory. No SSH credentials are in the repo.

- Website root: `/srv/darkwhispers-site/current`.
- Versioned releases: `/srv/darkwhispers-site/releases/<release hash>`.
- Site-specific Caddy file: `/etc/caddy/darkwhispers.caddy`.
- One import is appended to the existing Caddyfile.
- Root-only configuration backups: `/srv/darkwhispers-site/config-backups/`.
- Existing Caddy provides free automatic HTTPS.
- Cloudflare proxies the public hostname.

Upload the generated archive, `deploy/darkwhispers.caddy`, and `deploy/install.py`
to a dedicated staging directory owned by deploy. Run the installer using sudo,
passing the archive path, SHA-256, release ID and Caddy snippet path as arguments.
The installer verifies the upload, rejects archive path traversal, backs up and
validates Caddy, atomically switches a webroot symlink, then reloads Caddy.
On validation/reload failure it restores the old config and webroot.

Verify both direct origin HTTPS and the public Cloudflare hostname. Compare
download hashes and check representative existing sites after deployment.
Only this website's files and Caddy host entry are within deployment scope.

## Launcher releases

Place verified installers in `public/launcher/downloads/` and record their exact
filenames, version labels and SHA-256 hashes in `public/launcher/releases.json`.
The page only enables same-origin URLs under `/launcher/downloads/`.
The addon catalog is at `public/api/v1/catalog.json`; it is signed locally by
`../launcher/build-tools/publish-catalog.mjs`. The private key is never deployed.

The launcher checks the catalog signature and each addon's SHA-256 before installing.
The site's release JSON is download metadata, not an automatic app updater.
Operating-system signing is separate from catalog-signature verification.
Do not advertise signatures, completed scans or platform support before they
are actually available. GitHub is for source publication later; this VPS can
continue serving the binaries without a paid distribution service.

## Browser installation

Install an addon opens the browser installer. Desktop folder-write support
(such as Chrome/Edge), HTTPS and explicit folder permission are required.
Other browsers can use the ZIP download. No folder data is uploaded.

Run addon packaging, then launcher/build-tools/publish-catalog.mjs, then package
the final site. The signed catalog contains ZIP and per-file hashes. Runtime
files under /addons/ have gzip sidecars to avoid transferring raw textures.
The catalog stays compatible with the desktop launcher.

Browser installation verifies downloads, stages and reads back files, backs up
the previous addon, then writes and verifies the live folder. Failures trigger
restoration. Browser replacement is not atomic; an interrupted tab or revoked
permission may require restoring from Interface/AddOns/.darkwhispers-web-backups/.

Run Node tests on tests/browser-installer.test.mjs for disk safety checks.
tests/prepare-browser-qa.py creates a local-only QA page using the browser's
private origin file system. Remove public/__qa files afterwards; packaging
refuses to include them.

## Dated security evidence

tools/scan-release.ps1 updates Defender signatures and scans the public release
directory. It records artifact hashes, scanner versions and dates under
build/security/. Private scan logs are never deployed.

Run Cargo audit in the isolated builder, copy its JSON into
build/security/cargo-audit.json, then run tools/publish-checks.py. That helper
requires unchanged artifact hashes and zero ignored/unresolved vulnerability
entries. Informational advisories stay visible. The review scope and limits
are published in public/security/source-review.md.

Fingerprint web assets before scanning and recording review hashes. Re-package
after adding reports; unchanged source inputs retain the same fingerprints.
The page only marks malware checks passed for matching current-release hashes.
