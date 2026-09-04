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
# driven by any other must not carry them (see containers/gg/Dockerfile).
#
# EVERY run image has one. A program's language is resolved per agent, so a gg run on
# any case at all may drive a compiled-language agent, and there is no combination of
# test type, asset kind, and asset dimension for which gg may be handed an image with no
# compilers in it. `ImageSpec::gg_variant` in crates/core derives the name the same way
# rather than consulting a list, and `every_resolvable_image_is_one_the_build_publishes`
# fails the build if what it resolves and what this publishes ever disagree — so a new
# run image is TWO lines here, its own and its variant's.
#
# `base` is the exception, and the only one: it is the build-time parent of the images
# below it, never a run image, so nothing resolves it and it needs no variant.
#
# Each variant is listed immediately after its parent, because build.sh builds in listed
# order and a variant is `FROM` the image above it.
set -euo pipefail

cat <<'EOF'
base
base-wasm
base-wasm-gg
full-stack-2d
full-stack-2d-gg
full-stack-3d
full-stack-3d-gg
game-jam
game-jam-gg
sprite
sprite-gg
sprite-sheet
sprite-sheet-gg
voxel
voxel-gg
voxel-animation
voxel-animation-gg
mc
mc-gg
mc-animation
mc-animation-gg
sn
sn-gg
sn-animation
sn-animation-gg
dc
dc-gg
dc-animation
dc-animation-gg
ui
ui-gg
material
material-gg
mc-skinned
mc-skinned-gg
sn-skinned
sn-skinned-gg
dc-skinned
dc-skinned-gg
blender
blender-gg
particle-2d
particle-2d-gg
particle-3d
particle-3d-gg
sfx-synth
sfx-synth-gg
sfx-sample
sfx-sample-gg
music
music-gg
adversarial
adversarial-gg
performance
performance-gg
EOF
