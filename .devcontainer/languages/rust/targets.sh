#!/usr/bin/env bash
# Adds extra Rust compilation targets.
set -euo pipefail

# The musl target backs the portable, fully static `tcab`, `tcab-worker`, and
# `tcab-backend` builds (`cargo build-portable` / `-worker` / `-backend`); see
# https://docs.testcabinet.ai/development/building/#portable-static-builds.
"$HOME/.cargo/bin/rustup" target add x86_64-unknown-linux-musl
