#!/bin/sh
set -eu
cd /src
semgrep --version > /reports/semgrep-version.txt
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/semgrep-started.txt
semgrep scan --config p/security-audit --config p/secrets --metrics off --disable-version-check \
  --no-git-ignore --jobs 1 --json --output /reports/semgrep-report.json /src \
  > /reports/semgrep-console.txt 2>&1
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/semgrep-finished.txt
