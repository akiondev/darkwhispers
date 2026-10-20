#!/bin/sh
set -eu
cd /work
cargo update --workspace
sh build-tools/run-build.sh
cd /work/src-tauri
tauri build --bundles deb
