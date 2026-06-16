#!/usr/bin/env bash
# Lints the Rust side of the workspace: verifies formatting and runs Clippy with
# warnings denied.
#
# Formatting is checked across the whole workspace (it needs no compilation, so
# the deferred desktop crate costs nothing here). Clippy is scoped to the `tcab`
# CLI and the `test-cabinet-core` library it builds on; the Tauri desktop shell
# (`crates/desktop`) is intentionally excluded so CI runners do not need the
# desktop app's heavy system libraries while that app is deferred for v1.0.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo fmt --check"
cargo fmt --all --check

log "cargo clippy (warnings denied)"
cargo clippy --locked -p test-cabinet-core -p test-cabinet-cli --all-targets -- -D warnings
