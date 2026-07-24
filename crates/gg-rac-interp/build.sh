#!/usr/bin/env bash
#
# Build the responses-as-code interpreter to `wasm32-unknown-unknown` and copy the
# artifact to where the gg host embeds it (`crates/gg/src/rac/gg_rac_interp.wasm`).
#
# This is the documented step that refreshes the COMMITTED `.wasm` — mirroring how
# the `foray-ref-*` / `lattice-ref-*` guests are built and checked in. Run it after
# changing anything under `crates/gg-rac-interp/src/` that affects the guest (the
# language, the interpreter, or the ABI in `abi.rs`), then commit the updated
# `.wasm` alongside the source.
#
# Requires the wasm target: `rustup target add wasm32-unknown-unknown`.
#
# Usage:
#   crates/gg-rac-interp/build.sh
set -euo pipefail

# Repo root, independent of the caller's working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEST="crates/gg/src/rac/gg_rac_interp.wasm"

echo "Building gg-rac-interp for wasm32-unknown-unknown (release)..."
cargo build -p gg-rac-interp --release --target wasm32-unknown-unknown

# Honour a relocated CARGO_TARGET_DIR (the devcontainer points it elsewhere) by
# asking cargo where the target directory actually is.
TARGET_DIR="$(cargo metadata --no-deps --format-version 1 | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
TARGET_DIR="${TARGET_DIR:-target}"
SRC="$TARGET_DIR/wasm32-unknown-unknown/release/gg_rac_interp.wasm"
mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"

echo "Wrote $DEST ($(wc -c < "$DEST") bytes)."
echo "Remember to commit the refreshed artifact together with the source change."
