#!/bin/sh
set -eu
mkdir -p /reports
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/clamav-started.txt
freshclam --stdout > /reports/clamav-update.txt 2>&1
clamscan --version > /reports/clamav-version.txt
set +e
clamscan --recursive --verbose --scan-archive=yes --alert-exceeds-max=yes \
  --max-filesize=128M --max-scansize=512M /inputs > /reports/clamav-console.txt 2>&1
result=$?
set -e
printf '%s\n' "$result" > /reports/clamav-exit.txt
date -u +%Y-%m-%dT%H:%M:%SZ > /reports/clamav-finished.txt
chmod a+r /reports/*.txt
cat /reports/clamav-console.txt
exit "$result"
