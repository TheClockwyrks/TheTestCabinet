#!/usr/bin/env bash
# Orrery — produce every sprite and both sheets with the on-PATH `draw` and
# `draw-sheet` tools (specs/assets.md "The sprites" and "The sheets").
#
# The three production lanes are `gen-sprites.sh`, `gen-fx.sh`, and
# `gen-audio.sh`, run by hand, once. This lane's compositing is a Node program,
# because each sprite is composed as a pixel raster under `scripts/sprites/`
# and handed to the tool as the recorded operations that reproduce it; this
# script is the lane's entry point, so all three are invoked the same way.
#
# Usage:  bash scripts/gen-sprites.sh [out-dir]
#   `draw` and `draw-sheet` must be on the PATH, or built under
#   `$CARGO_TARGET_DIR` (`/cargo-target/the-test-cabinet` by default).
#   `out-dir` defaults to `assets/` beside `scripts/`.
#
# Production is a ONE-TIME step: the finished PNGs are committed, and neither
# `npm ci` nor `npm run build` runs this.
set -euo pipefail
exec node "$(dirname "$0")/gen-sprites.mjs" "$@"
