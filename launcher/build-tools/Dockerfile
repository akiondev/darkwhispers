FROM rust:1.99.1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang lld llvm nsis nodejs npm pkg-config libssl-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf file \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-pc-windows-msvc
RUN CARGO_BUILD_JOBS=2 cargo install --locked cargo-xwin
RUN npm install --global @tauri-apps/cli@2
ENV CARGO_BUILD_JOBS=2
WORKDIR /work
