#!/bin/sh
set -eu
cd /work
rustup component add rustfmt
cargo fmt --all
cargo test --locked -p darkwhispers-core
cargo test --locked -p darkwhispers-core live_signed_release_installs_and_removes -- --ignored
python3 build-tools/licenses.py
cd src-tauri
tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
cd /work
cargo xwin test --locked --release -p darkwhispers-core --target x86_64-pc-windows-msvc --no-run
