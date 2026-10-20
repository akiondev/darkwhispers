# Verify DarkWhispers downloads

The website and VPS are distribution mirrors, not a certificate authority.
Use GitHub directly when checking evidence.

## Without command-line tools

1. Open https://github.com/akiondev/darkwhispers directly. Confirm the owner and
   repository name, rather than trusting a screenshot or a badge on another site.
2. Open the release for your version. Its public workflow run links to the exact
   source commit, build jobs, tests, scanner logs and complete reports.
3. Download from that GitHub release if you do not want to rely on the VPS mirror.
   Published releases are immutable: existing assets and the tag are locked.
4. Read release-evidence.json and the full per-tool reports. A passed workflow is
   not an independent human security review. RustSec and Semgrep notes are kept.

## Cryptographically verify an exact file

Install the free GitHub CLI from https://cli.github.com/ and run:

    gh attestation verify <downloaded-file> --repo akiondev/darkwhispers --signer-workflow akiondev/darkwhispers/.github/workflows/release.yml

Use this for the downloaded installer, addon ZIP or report. The verification
checks the file digest and GitHub/Sigstore provenance, including workflow
identity and source revision. A modified file or a forged JSON report does not
pass verification against its original attestation.

The release also includes attestation-bundle.jsonl for independent/offline
verification. The normal online command retrieves the trusted attestation
without relying on the VPS's copy.

Compare a Windows file's SHA-256 manually if desired:

    Get-FileHash -Algorithm SHA256 -LiteralPath '.\downloaded-file.exe'

Read the expected hash from the GitHub release's SHA256SUMS.txt, not solely from
the same website that supplied the binary.

## What remains a trust decision

- A valid attestation proves that a particular workflow produced an exact file.
  It does not prove that its source, compiler, dependency or scanner is flawless.
- The repository owner can change future code and workflows. Inspect the source
  revision and pinned workflow for the release you actually install.
- The project uses standard GitHub-hosted runners. It does not claim fully
  reproducible, byte-identical builds across machines or SLSA certification.
- Scanner coverage is limited. Zero detections is not a malware-free guarantee.
  Source findings and known dependency notes are published, not hidden.
- Windows installers remain unsigned; GitHub provenance is different from
  Microsoft Authenticode signing or reputation.
- Reports predating the public build pipeline were run by the maintainer. Their
  local timestamps and hashes do not independently establish execution.

## Official documentation

- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub CLI attestation verification](https://cli.github.com/manual/gh_attestation_verify)
- [Immutable releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)
