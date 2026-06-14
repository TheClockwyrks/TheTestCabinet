#!/usr/bin/env bash
# Adds extra Rust compilation targets.
set -euo pipefail

# The musl target backs the portable, fully static `tcab` build
# (`cargo build-portable`); see DEVELOPMENT.md.
"$HOME/.cargo/bin/rustup" target add x86_64-unknown-linux-musl
