#!/bin/sh
set -eu
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/clamav-started.txt
freshclam --stdout > /reports/clamav-update.txt 2>&1
clamscan --version > /reports/clamav-version.txt
# Read-only release mount. No removal, quarantine or daemon is enabled.
set +e
clamscan --recursive --verbose --scan-archive=yes --alert-exceeds-max=yes \
  --max-filesize=128M --max-scansize=512M --log=/reports/clamav-scan.txt /scan
result=$?
set -e
printf '%s\n' "$result" > /reports/clamav-exit.txt
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/clamav-finished.txt
exit "$result"
