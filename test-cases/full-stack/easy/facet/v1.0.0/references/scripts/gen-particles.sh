#!/usr/bin/env bash
# Facet — produce the PARTICLE SYSTEMS with the on-PATH `particle-2d` tool
# (specs/assets.md → "Particle systems").
#
# These are authored systems, not baked frames: `particle-2d` records emitters,
# forces, and per-particle curves and its render step writes the `system.json`
# that is the asset. The game plays them live through
# `@test-cabinet/particle-runtime`'s ParticleCanvasPlayer, so every burst is
# simulated afresh and no two look quite alike — which is correct.
#
# Produces, under assets/fx/ (3 system.json files):
#   clear-burst.system.json    one short burst at every cell a chain step clears
#   flawed-burst.system.json   the heavier detonation where a gem at MAX_STRAIN
#                              (3) clears — visibly bigger and more violent
#   cut-flash.system.json      the prismatic flash where a brilliant, a star, or
#                              a prism is created
#
# `particle-2d` is planar: there is no z, and y points UP, so a NEGATIVE gravity
# pulls a particle down the screen. The simulator also holds a hard ceiling of
# 10,000 live particles per system; the heaviest of these three peaks near 300,
# so a board throwing a dozen bursts at once stays far inside it.
#
# ParticleCanvasPlayer maps a particle at field `(x, y)` straight onto its canvas
# as `(x * cw / fieldW, ch - y * ch / fieldH)`, so an emitter at the origin would
# composite in the bottom-left corner. Every emitter here therefore sits at the
# MIDDLE of its field, and the game draws each system's canvas centered on the
# cell that threw it. The field extents are the effects' relative sizes too: the
# flawed detonation's field is more than twice the clear burst's on a side.
#
# Usage:  bash scripts/gen-particles.sh   (particle-2d must be on PATH, or built
#         under $CARGO_TARGET_DIR/{debug,release}).
set -euo pipefail

# Resolve the tool: prefer PATH, else the devcontainer's cargo target volume.
if ! command -v particle-2d >/dev/null 2>&1; then
  for d in "${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"/{release,debug}; do
    [ -x "$d/particle-2d" ] && export PATH="$d:$PATH" && break
  done
  command -v particle-2d >/dev/null 2>&1 || { echo "particle-2d not found on PATH" >&2; exit 1; }
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/../assets}/fx"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newfx <w> <h> <duration_ms> <loop> <out.system.json> — start a fresh system.
# The preview GIF is a working file; the `system.json` is the asset.
newfx() {
  local stem; stem="$(basename "$5" .system.json)"
  printf '{ "width": %s, "height": %s, "duration_ms": %s, "fps": 30, "loop": %s, "background": "transparent", "actions": "%s", "preview": "%s", "system": "%s" }\n' \
    "$1" "$2" "$3" "$4" "$TMP/$stem.actions.json" "$TMP/$stem.preview.gif" "$5" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================== CLEAR BURST ===================================
# Thrown at each cell a chain step clears. Deliberately compact and short: a set
# of a dozen cleared cells has to read as a dozen separate bursts rather than one
# wash across the board, so this is ~34 particles inside about a cell's width,
# gone in under half a second.
#   chips    the stone coming apart — a ring of fragments thrown out and pulled
#            down, fading from white through the warm gold of a lit bench
#   sparks   a handful of faster, thinner streaks that outrun the chips
FIELD_CLEAR=96; HALF_CLEAR=$((FIELD_CLEAR / 2))
newfx "$FIELD_CLEAR" "$FIELD_CLEAR" 420 false "$OUT/clear-burst.system.json"
p set-timeline --loop false
p add-emitter --name chips --shape disc --radius 3 --x "$HALF_CLEAR" --y "$HALF_CLEAR" \
  --burst 24 --at 0 --lifetime 320 --lifetime-spread 90 \
  --speed 195 --speed-spread 58 --dir-y 1 --cone-angle 180 --seed 5171
p set-particle --emitter chips --size-curve ease-out --size-from 5.5 --size-to 0.6 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient '#ffffff@0,#ffe9a8@0.4,#ffab3a@1' --rotation 200
p set-forces --emitter chips --gravity -260 --drag 1.0
p add-emitter --name sparks --shape point --x "$HALF_CLEAR" --y "$HALF_CLEAR" \
  --burst 10 --at 0 --lifetime 260 --lifetime-spread 70 \
  --speed 330 --speed-spread 75 --dir-y 1 --cone-angle 180 --seed 917
p set-particle --emitter sparks --size-curve linear --size-from 2.4 --size-to 0.4 \
  --opacity-curve linear --opacity-from 1 --opacity-to 0 \
  --color-gradient '#ffffff@0,#fff2c8@1' --stretch 0.35
p set-forces --emitter sparks --gravity -150 --drag 1.4
p render >/dev/null
echo "  fx/clear-burst.system.json"

# ============================ FLAWED DETONATION ===============================
# Thrown where a gem at MAX_STRAIN (3) clears. Everything about it is bigger than
# the clear burst — four times the particles, twice the speed, twice the reach and
# nearly twice the length — so a chain tearing through a primed corner looks like
# the payoff it is.
#   core       the white heart of the blast, over almost at once
#   shrapnel   heavy fragments thrown hard and dragged down, each trailing embers
#   embers     the sub-emitter those fragments shed as they die
#   smoke      a slow dark bloom that outlives everything else
FIELD_FLAW=256; HALF_FLAW=$((FIELD_FLAW / 2))
newfx "$FIELD_FLAW" "$FIELD_FLAW" 760 false "$OUT/flawed-burst.system.json"
p set-timeline --loop false
p add-emitter --name core --shape point --x "$HALF_FLAW" --y "$HALF_FLAW" \
  --burst 8 --at 0 --lifetime 190 --lifetime-spread 40 \
  --speed 26 --speed-spread 12 --dir-y 1 --cone-angle 180 --seed 3301
p set-particle --emitter core --size-curve ease-out --size-from 17 --size-to 2 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient '#ffffff@0,#ffd58a@0.5,#ff8a2e@1'
p set-forces --emitter core --drag 4
p add-emitter --name embers --shape point --x "$HALF_FLAW" --y "$HALF_FLAW" \
  --burst 3 --lifetime 220 --lifetime-spread 80 \
  --speed 62 --speed-spread 26 --dir-y 1 --cone-angle 180 --seed 8123
p set-particle --emitter embers --size-curve linear --size-from 2.2 --size-to 0.3 \
  --opacity-curve linear --opacity-from 0.9 --opacity-to 0 \
  --color-gradient '#ffd27a@0,#ff6a22@1'
p set-forces --emitter embers --gravity -160 --drag 2
p add-emitter --name shrapnel --shape disc --radius 5 --x "$HALF_FLAW" --y "$HALF_FLAW" \
  --burst 68 --at 0 --lifetime 620 --lifetime-spread 160 \
  --speed 258 --speed-spread 84 --dir-y 1 --cone-angle 180 --seed 4409
p set-particle --emitter shrapnel --size-curve ease-out --size-from 7 --size-to 0.8 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient '#ffffff@0,#ff9a3c@0.35,#e0431c@0.75,#5c1408@1' \
  --rotation 300 --stretch 0.2
p set-forces --emitter shrapnel --gravity -215 --drag 0.9
p add-subemitter --parent shrapnel --on death --emitter embers
p add-emitter --name smoke --shape disc --radius 8 --x "$HALF_FLAW" --y "$HALF_FLAW" \
  --burst 10 --at 40 --lifetime 700 --lifetime-spread 160 \
  --speed 52 --speed-spread 24 --dir-y 1 --cone-angle 180 --seed 6620
p set-particle --emitter smoke --size-curve ease-out --size-from 6 --size-to 19 \
  --opacity-curve ease-in --opacity-from 0.26 --opacity-to 0 \
  --color-gradient '#7a5540@0,#1c1310@1'
p set-forces --emitter smoke --gravity 70 --drag 2.6 --turbulence 30,0.05
p render >/dev/null
echo "  fx/flawed-burst.system.json"

# =============================== CUT FLASH ====================================
# Thrown where a brilliant, a star, or a prism is created, marking the new stone
# on the frame it arrives. It is the one effect that does not fall: a cut gem is
# light being split, so the particles hang, hold a clean ring, and each runs the
# whole spectrum over its own life — the prism's colors, in motion.
FIELD_CUT=128; HALF_CUT=$((FIELD_CUT / 2))
newfx "$FIELD_CUT" "$FIELD_CUT" 480 false "$OUT/cut-flash.system.json"
p set-timeline --loop false
p add-emitter --name flare --shape point --x "$HALF_CUT" --y "$HALF_CUT" \
  --burst 5 --at 0 --lifetime 220 --lifetime-spread 40 \
  --speed 14 --speed-spread 8 --dir-y 1 --cone-angle 180 --seed 2255
p set-particle --emitter flare --size-curve ease-out --size-from 11 --size-to 1 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient '#ffffff@0,#dbe8ff@1'
p set-forces --emitter flare --drag 5
# One emitter per split color, each thrown on its own heading, so the ring is a
# rainbow at every instant rather than one ring that changes color as a whole.
SPECTRUM=('#ff5a7a' '#ffa23c' '#f5ee5a' '#5ef2a0' '#4fb8ff' '#c07bff')
for i in 0 1 2 3 4 5; do
  p add-emitter --name "arc$i" --shape disc --radius 2 --x "$HALF_CUT" --y "$HALF_CUT" \
    --burst 7 --at $((i * 8)) --lifetime 400 --lifetime-spread 70 \
    --speed 292 --speed-spread 30 --dir-y 1 --cone-angle 180 --seed $((7788 + i * 131))
  p set-particle --emitter "arc$i" --size-curve ease-out --size-from 4.4 --size-to 0.5 \
    --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
    --color-gradient "#ffffff@0,${SPECTRUM[$i]}@0.14,${SPECTRUM[$i]}@1" --rotation 260
  p set-forces --emitter "arc$i" --drag 1.1 --vortex 34
done
p add-emitter --name motes --shape disc --radius 12 --x "$HALF_CUT" --y "$HALF_CUT" \
  --burst 16 --at 60 --lifetime 420 --lifetime-spread 120 \
  --speed 52 --speed-spread 26 --dir-y 1 --cone-angle 180 --seed 1616
p set-particle --emitter motes --size-curve linear --size-from 2 --size-to 0.4 \
  --opacity-curve ease-in --opacity-from 0.9 --opacity-to 0 \
  --color-gradient '#ffffff@0,#a8d8ff@1'
p set-forces --emitter motes --gravity 30 --drag 2
p render >/dev/null
echo "  fx/cut-flash.system.json"

echo "gen-particles.sh: done -> $OUT"
