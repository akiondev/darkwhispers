# Project instructions

- Source folders: launcher/, website/, addons/DarkWhisperRaidTools/.
- Keep the raid addon independent and all product UI in English.
- Never commit private keys, credentials, WoW settings, build caches or machine logs.
- Preserve the signed-catalog verification, safe paths and temporary crash recovery; do not retain completed-version backups.
- Run relevant existing checks for modified behavior. AkionUI and its private tests are not exported.
- Runtime addon deployment requires the user's target-folder authorization.
  deploy.ps1 copies only addon runtime files and verifies SHA-256 hashes.
- Public releases must come from the main-branch GitHub release workflow.
  Keep third-party actions pinned by commit and never give pull-request code
  publishing tokens or signing permissions.
- Do not claim that provenance, a clean scan or a GitHub badge guarantees safety.
- Reports must retain findings, exact file hashes, source revision and scope.
