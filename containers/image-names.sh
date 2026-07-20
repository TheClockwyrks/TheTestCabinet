#!/usr/bin/env bash
# Single source of truth for the run-container image names — the `<name>` in each
# `test-cabinet-<name>` package. Prints one name per line, in build order (base
# first, then base-wasm and the images that are `FROM` it), so a consumer that
# builds in listed order never builds a child before its parent.
#
# Consumed by:
#   - containers/build.sh — the set it builds (ALL_NAMES) + the `containers/<name>/…`
#     it builds each from;
#   - .github/workflows/build-containers.yml (the `manifest` job) — the set it fuses
#     from the per-arch `:latest-<arch>` tags into the multi-arch `:latest`/`:<sha>`
#     manifest lists.
#
# Keeping both consumers driven by this one list prevents the drift where an image
# is built + pushed per-arch but never fused, so its `:<sha>` tag 404s at pull time.
# When you add or remove a run image, edit ONLY this list.
set -euo pipefail

cat <<'EOF'
base
base-wasm
full-stack-2d
game-jam
sprite
sprite-sheet
voxel
voxel-animation
mc
mc-animation
sn
sn-animation
dc
dc-animation
ui
material
mc-skinned
sn-skinned
dc-skinned
blender
particle-2d
particle-3d
sfx-synth
sfx-sample
music
adversarial
performance
EOF
