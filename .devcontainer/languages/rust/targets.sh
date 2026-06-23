#!/usr/bin/env bash
# Adds extra Rust compilation targets.
set -euo pipefail

# The musl target backs the portable, fully static `tcab`, `tcab-backend`,
# `tcab-dispatcher`, `tcab-driver`, and `tcab-artifacts` builds
# (`cargo build-portable` / `-backend` / `-dispatcher` / `-driver` / `-artifacts`);
# see https://docs.testcabinet.ai/development/building/#portable-static-builds.
"$HOME/.cargo/bin/rustup" target add x86_64-unknown-linux-musl

# The wasm target backs the adversarial test type (Foray): `foray-core` compiles
# to wasm for browser replay playback, and adversarial controllers — the bundled
# reference controllers and a model's submission — compile to wasm modules the
# `foray` CLI loads into its wasmtime host. See
# https://docs.testcabinet.ai/testing/adversarial/overview/.
"$HOME/.cargo/bin/rustup" target add wasm32-unknown-unknown
