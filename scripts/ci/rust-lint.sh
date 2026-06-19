#!/usr/bin/env bash
# Lints the Rust side of the workspace: verifies formatting and runs Clippy with
# warnings denied.
#
# Formatting is checked across the whole workspace (it needs no compilation, so
# the deferred desktop crate costs nothing here). Clippy covers every headless
# crate via `--workspace --exclude test-cabinet-desktop`; only the Tauri desktop
# shell (`crates/desktop`) is left out so CI runners do not need the desktop app's
# heavy system libraries while that app is deferred for v1.0.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo fmt --check"
cargo fmt --all --check

log "cargo clippy (warnings denied)"
cargo clippy --locked --workspace --exclude test-cabinet-desktop --all-targets -- -D warnings
