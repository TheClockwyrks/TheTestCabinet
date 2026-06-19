#!/usr/bin/env bash
# Builds and tests every headless Rust crate: the `tcab` CLI, the `tcab-worker`
# and `tcab-backend` servers, and the `test-cabinet-core`/`test-cabinet-telemetry`
# libraries they share.
#
# Scoped with `--workspace --exclude test-cabinet-desktop`: the only crate left
# out is the Tauri desktop shell (`crates/desktop`), so runners do not need the
# desktop app's heavy system libraries while that app is deferred for v1.0 (see
# rust-lint.sh). This is the critical Rust validation that both Azure DevOps and
# GitHub run.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build"
cargo build --locked --workspace --exclude test-cabinet-desktop

log "cargo test"
cargo test --locked --workspace --exclude test-cabinet-desktop
