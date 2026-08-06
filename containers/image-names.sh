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
#
# A `<name>-gg` entry is the GG VARIANT of `<name>`: that image plus the language
# toolchains a `gg` run's responses-as-code programs are compiled with. It is a
# separate published image because those toolchains exist for one harness, and a run
# driven by any other must not carry them (see containers/gg/Dockerfile). Each is
# listed immediately after its parent, because build.sh builds in listed order and a
# variant is `FROM` the image above it.
#
# The variants are deliberately a SUBSET: publishing one per run image would double
# the set and the CI matrix for toolchains most of them would never invoke. A gg run
# whose image has no variant falls back to the shared image with a warning
# (`harness::gg_variant` in crates/core), so growing this list is adding the name here
# and the match arm there — and nothing 404s in the meantime.
set -euo pipefail

cat <<'EOF'
base
base-wasm
base-wasm-gg
full-stack-2d
full-stack-2d-gg
game-jam
game-jam-gg
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
