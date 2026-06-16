#!/usr/bin/env bash
# Builds and tests the Rust CLI and the core library it depends on.
#
# Scoped to `test-cabinet-cli` and `test-cabinet-core`; the Tauri desktop shell
# (`crates/desktop`) is excluded so runners do not need the desktop app's system
# libraries while that app is deferred for v1.0 (see rust-lint.sh). This is the
# critical Rust validation that both Azure DevOps and GitHub run.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo build"
cargo build --locked -p test-cabinet-core -p test-cabinet-cli

log "cargo test"
cargo test --locked -p test-cabinet-core -p test-cabinet-cli
