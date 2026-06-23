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
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build"
cargo build --locked --workspace --exclude test-cabinet-desktop

log "cargo test"
cargo test --locked --workspace --exclude test-cabinet-desktop
