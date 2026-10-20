# Project instructions

- Source folders: launcher/, website/, addons/AkionUI/ and addons/DarkWhisperRaidTools/.
- Keep the addons independent and all product UI in English.
- Never commit private keys, credentials, WoW settings, build caches or machine logs.
- Preserve the signed-catalog verification, safe paths, backups and rollback behavior.
- Run relevant existing tests; use Lua 5.1 from addons/ for tests/smoke.lua.
- Runtime addon deployment requires the user's target-folder authorization.
  deploy.ps1 copies only addon runtime files and verifies SHA-256 hashes.
- Public releases must come from the main-branch GitHub release workflow.
  Keep third-party actions pinned by commit and never give pull-request code
  publishing tokens or signing permissions.
- Do not claim that provenance, a clean scan or a GitHub badge guarantees safety.
- Reports must retain findings, exact file hashes, source revision and scope.
