# Security policy

Please report a suspected vulnerability through the repository owner's GitHub
profile contact options. Do not post private keys, credentials, personal WoW
settings or exploitable sensitive data in a public issue.

The launcher verifies an Ed25519-signed addon catalog and SHA-256 package hashes.
It rejects unsafe paths, links, unknown folders and downgrades, stages updates,
clears temporary previous-version copies after a completed update, and does not modify other addons or WTF saved settings.
The browser installer verifies the signed catalog and each file before writing.
Browser folder replacement cannot be atomic; keep WoW and other managers closed.

Catalog private keys are not stored in this repository or the public release
workflow. Only the public verification key and signed catalog are checked in.
Releases use GitHub's short-lived workflow identity for provenance attestations;
they do not require a stored long-lived signing secret.

See docs/VERIFY.md for the trust model, limitations and verification commands.
Known dependency notes and complete scanner reports are release assets.
An attestation or successful automated scan is not an independent security audit.
