#!/bin/sh
set -eu
mkdir -p /reports/tools
if [ ! -x /reports/tools/bin/cargo-audit ]; then
  cargo install --locked cargo-audit --root /reports/tools > /reports/install.log 2>&1
fi
/reports/tools/bin/cargo-audit --version > /reports/tool-version.txt
set +e
/reports/tools/bin/cargo-audit audit --file /work/Cargo.lock --json > /reports/cargo-audit.json 2> /reports/audit.log
result=$?
set -e
printf '%s\n' "$result" > /reports/exit-code.txt
cat /reports/tool-version.txt
cat /reports/audit.log
exit "$result"
