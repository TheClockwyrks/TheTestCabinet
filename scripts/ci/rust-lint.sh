#!/usr/bin/env bash
# Lints the Rust side of the workspace: verifies formatting, then runs Clippy and
# rustdoc with warnings denied.
#
# The rustdoc pass is what catches broken intra-doc links. The workspace denies
# `warnings` ([workspace.lints.rust] in the root Cargo.toml) and that group covers
# rustdoc's lints, so those are already hard errors — but only once something runs
# `cargo doc`. It is deliberately NOT doctests: `cargo test --doc` (in
# rust-test.sh) runs the code examples inside doc comments and says nothing about
# whether their links resolve. `--no-deps` keeps this to workspace crates only.
#
# Formatting is checked across the whole workspace (it needs no compilation, so
# the desktop crate costs nothing here). Clippy and rustdoc cover every headless
# crate via `--workspace --exclude test-cabinet-desktop`; only the Tauri desktop shell
# (`crates/desktop`) is left out so the per-change CI runners do not need the
# desktop app's heavy GUI system libraries. It gets the same clippy and rustdoc
# passes from `desktop-build.sh`, whose runner installs them.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "cargo fmt --check"
cargo fmt --all --check

log "cargo clippy (warnings denied)"
cargo clippy --locked --workspace --exclude test-cabinet-desktop --all-targets -- -D warnings

log "cargo doc (warnings denied)"
cargo doc --locked --workspace --exclude test-cabinet-desktop --no-deps
