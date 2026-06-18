#!/usr/bin/env bash
# Adds extra Rust compilation targets.
set -euo pipefail

# The musl target backs the portable, fully static `tcab` and `tcab-worker`
# builds (`cargo build-portable` / `cargo build-portable-worker`); see
# https://docs.testcabinet.ai/development/building/#portable-static-builds.
"$HOME/.cargo/bin/rustup" target add x86_64-unknown-linux-musl
