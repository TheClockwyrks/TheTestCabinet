#!/usr/bin/env bash
# Adds extra Rust compilation targets.
set -euo pipefail

# The musl target backs the portable, fully static `tcab`, `tcab-backend`,
# `tcab-dispatcher`, `tcab-driver`, `tcab-artifacts`, and `gg` builds; see
# https://docs.testcabinet.ai/development/building/#portable-static-builds.
#
# It is the target for THIS machine's architecture, which is the one that can
# actually be linked here: `musl-tools` (system/apt.sh) supplies a native `musl-gcc`
# and no cross toolchain, and `scripts/build-gg-static.sh` builds natively for the
# same reason. The `cargo build-portable-*` aliases are pinned to x86_64, so on an
# aarch64 machine they are a cross build that needs a target and a C toolchain added
# by hand.
case "$(uname -m)" in
x86_64) readonly MUSL_TARGET="x86_64-unknown-linux-musl" ;;
aarch64 | arm64) readonly MUSL_TARGET="aarch64-unknown-linux-musl" ;;
*)
	echo "error: no musl target for $(uname -m)." >&2
	exit 1
	;;
esac
"$HOME/.cargo/bin/rustup" target add "$MUSL_TARGET"

# The wasm target backs the adversarial test type (Foray): `foray-core` compiles
# to wasm for browser replay playback, and adversarial controllers — the bundled
# reference controllers and a model's submission — compile to wasm modules the
# `foray` CLI loads into its wasmtime host. See
# https://docs.testcabinet.ai/testing/adversarial/overview/.
"$HOME/.cargo/bin/rustup" target add wasm32-unknown-unknown
