#!/usr/bin/env bash
# Builds and tests every headless Rust crate: the `tcab` CLI, the `tcab-backend`
# server, the `tcab-dispatcher`/`tcab-driver`/`tcab-artifacts` run-topology
# services, and the `test-cabinet-core`/`test-cabinet-telemetry` libraries they
# share.
#
# Scoped with `--workspace --exclude test-cabinet-desktop`: the only crate left
# out is the Tauri desktop shell (`crates/desktop`), so the per-change CI runners
# do not need the desktop app's heavy GUI system libraries (see rust-lint.sh). The
# desktop app is built and bundled for every platform in the GitHub Release
# workflow (.github/workflows/release.yml) instead. This is the critical Rust
# validation that both Azure DevOps and GitHub run.
#
# Tests run with cargo-nextest (the repo's runner; see .config/nextest.toml —
# retries=1, fail-fast=false, and a per-test hard timeout). nextest does not
# execute doctests, so those run separately with `cargo test --doc`. Both CI
# systems install nextest first (scripts/ci/install-nextest.sh).
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# gg's PureScript program-language arm compiles a model's program with a real `purs` and
# bundles it with a real `esbuild`, and its tests drive both. Neither can ride inside gg's
# binary the way the Ruby arm's compiler does — `purs` is a ~100 MB statically linked
# Haskell executable with a build per platform — so they are installed, here as in the run
# image (containers/gg-toolchains/Dockerfile). Pinned in
# packages/gg-sandbox-purescript/purescript-version.sh; idempotent, so an agent that
# already has them pays nothing.
log "install the PureScript toolchain (gg's purescript arm compiles with it)"
./scripts/ci/install-purescript.sh
export PATH="$HOME/.local/bin:$PATH"

# gg's Java program-language arm compiles a model's program with a real `javac` and a real TeaVM,
# and its tests drive both. Neither can ride inside gg's binary — a JDK is ~190 MB with a build per
# platform, and TeaVM is ~29 MB of jars named on a classpath rather than a binary on PATH — so they
# are installed, here as in the run image (containers/gg-toolchains/Dockerfile). Pinned in
# packages/gg-sandbox-java/java-version.sh; idempotent, so an agent that already has them pays
# nothing. `crates/gg` looks under $HOME for them by name, so nothing has to be exported.
log "install the Java toolchain (gg's java arm compiles with it)"
./scripts/ci/install-java.sh

# gg's Kotlin arm compiles with a real Kotlin compiler and hands the bytecode to the same TeaVM,
# so this installs ~67 MB of compiler jars on top of what the line above put there — and it runs
# that script itself, which is idempotent. Pinned in packages/gg-sandbox-kotlin/kotlin-version.sh.
log "install the Kotlin toolchain (gg's kotlin arm compiles with it)"
./scripts/ci/install-kotlin.sh

log "cargo build"
cargo build --locked --workspace --exclude test-cabinet-desktop

log "cargo nextest run"
cargo nextest run --locked --workspace --exclude test-cabinet-desktop

log "cargo test --doc"
cargo test --locked --workspace --exclude test-cabinet-desktop --doc
