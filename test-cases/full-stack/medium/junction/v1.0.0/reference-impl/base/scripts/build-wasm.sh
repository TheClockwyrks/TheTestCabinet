#!/usr/bin/env bash
# Junction — compile the Rust simulation core to its committed wasm build input.
#
# DEV-ONLY. This is NOT part of `npm run build`: the compiled module in
# `src/sim-core-pkg/` is committed and the Node build consumes it as-is (exactly like the
# produced assets). The Rust → wasm toolchain is on `PATH` only while the run is live, so
# the wasm is produced once here, committed, and never rebuilt by `npm ci && npm run build`
# (specs/simulation.md). Re-run this after changing anything under `sim-core/`, then commit
# the updated `src/sim-core-pkg/`.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"

cd "$here/sim-core"
wasm-pack build --release --target web --out-dir ../src/sim-core-pkg --out-name junction_sim_core

# wasm-pack writes a `.gitignore` (`*`) into the out dir intended for a publishable package;
# here the package IS committed as a build input, so drop it.
rm -f "$here/src/sim-core-pkg/.gitignore"

echo "sim-core-pkg rebuilt — commit src/sim-core-pkg/ as the wasm build input."
