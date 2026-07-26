#!/usr/bin/env bash
# Midway — author the particle systems with the on-PATH `particle-2d` tool (specs/assets.md, ASSETS.md §3).
#
# Four effects, played live in-game through @test-cabinet/particle-runtime's /canvas binding
# (never baked frames): a celebratory FIREWORKS burst (one-shot), a rising STEAM/aroma vent
# over a running food/drink stall (loop), a light SPARKLE at a running ride (loop), and a short
# CLEANUP puff when a janitor clears litter (one-shot). Each is authored as a system
# (emitters + forces + per-particle curves) and its `render` step emits the `system.json`
# asset. Re-run this to regenerate the four fx/*.system.json files.
#
# Usage:  bash scripts/gen-particles.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Palette (specs/overview.md): rating #ffcb52, thrill #c46bff, thirst #45c6f0, cash #5fce6e,
# happiness #ffd24a, grass #4f8f4a, primary-text #f2efe8, secondary #aeb6c6.
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
if ! command -v particle-2d >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/particle-2d" ] || { echo "particle-2d not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/assets/fx"
mkdir -p "$FX"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsys <name> <duration_ms> <loop:true|false> : seed a fresh 128x128 system whose
# emitted system.json lands at $FX/<name>.system.json (actions/preview stay in scratch).
newsys() {
  printf '{ "width": 128, "height": 128, "duration_ms": %s, "fps": 30, "loop": %s, "background": "transparent", "actions": "%s", "preview": "%s", "system": "%s" }\n' \
    "$2" "$3" "$TMP/$1.actions.json" "$TMP/$1.preview.gif" "$FX/$1.system.json" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ FIREWORKS (one-shot celebration) =================
# A staggered multi-color shell burst over the park at a milestone. Each color is its own
# point-burst with a radial pop; global gravity arcs the embers back down and drag settles
# them, so the burst reads as festival fireworks (bright core -> palette color -> dark ash).
newsys fireworks 1500 false
p set-forces --gravity -55 --drag 1.4

p add-emitter --name gold --shape point --x 64 --y 80 \
  --burst 46 --at 0 --lifetime 950 --lifetime-spread 160 --speed 96 --speed-spread 26 \
  --dir-y 1 --cone-angle 360 --seed 21
p set-forces --emitter gold --radial 130
p set-particle --emitter gold --size-curve ease-out --size-from 1.7 --size-to 0.2 \
  --opacity-curve ease-in --opacity-from 1 --opacity-to 0 \
  --color-gradient "#fff6d0@0,#ffcb52@0.4,#e0603c@1"

p add-emitter --name thrill --shape point --x 44 --y 66 \
  --burst 40 --at 260 --lifetime 900 --lifetime-spread 150 --speed 86 --speed-spread 22 \
  --dir-y 1 --cone-angle 360 --seed 34
p set-forces --emitter thrill --radial 118
p set-particle --emitter thrill --size-curve ease-out --size-from 1.6 --size-to 0.2 \
  --opacity-curve ease-in --opacity-from 1 --opacity-to 0 \
  --color-gradient "#f4e2ff@0,#c46bff@0.45,#4a2f6d@1"

p add-emitter --name thirst --shape point --x 88 --y 72 \
  --burst 40 --at 520 --lifetime 900 --lifetime-spread 150 --speed 88 --speed-spread 22 \
  --dir-y 1 --cone-angle 360 --seed 47
p set-forces --emitter thirst --radial 122
p set-particle --emitter thirst --size-curve ease-out --size-from 1.6 --size-to 0.2 \
  --opacity-curve ease-in --opacity-from 1 --opacity-to 0 \
  --color-gradient "#dff6ff@0,#45c6f0@0.45,#1f4a5e@1"

p add-emitter --name cash --shape point --x 64 --y 60 \
  --burst 42 --at 800 --lifetime 920 --lifetime-spread 150 --speed 90 --speed-spread 24 \
  --dir-y 1 --cone-angle 360 --seed 58
p set-forces --emitter cash --radial 124
p set-particle --emitter cash --size-curve ease-out --size-from 1.6 --size-to 0.2 \
  --opacity-curve ease-in --opacity-from 1 --opacity-to 0 \
  --color-gradient "#e6ffe0@0,#5fce6e@0.45,#20402a@1"

p set-timeline --loop false
p render >/dev/null

# ============================ STEAM (looping stall vent) ======================
# A small, continuous plume of steam/aroma rising off a running food/drink stall. A narrow
# upward cone from a low vent; slight turbulence + drag wisps it; particles grow and fade as
# they climb (white -> cool grey). Loops while the stall is serving.
newsys steam 1600 true
p set-forces --drag 0.9 --turbulence "9,0.05" --wind "3,6"
p add-emitter --name vent --shape edge --x 64 --y 40 --size-x 10 \
  --rate 16 --lifetime 1350 --lifetime-spread 220 --speed 24 --speed-spread 7 \
  --dir-y 1 --cone-angle 16 --seed 12
p set-particle --emitter vent --size-curve ease-in --size-from 0.45 --size-to 2.4 \
  --opacity-curve ease-in-out --opacity-from 0.72 --opacity-to 0 \
  --color-gradient "#f2efe8@0,#cfd4de@0.5,#aeb6c6@1"
p set-timeline --loop true
p render >/dev/null

# ============================ SPARKLE (looping ride glint) ====================
# Light twinkles at a running ride (carousel lights / coaster sparks): quick in-place golden
# glints scattered across the footprint, plus a few slow rising motes. Loops while running.
newsys sparkle 1200 true
p set-forces --drag 1.6
p add-emitter --name twinkle --shape disc --x 64 --y 64 --radius 30 \
  --rate 26 --lifetime 620 --lifetime-spread 180 --speed 8 --speed-spread 6 \
  --dir-y 1 --cone-angle 360 --seed 5
p set-particle --emitter twinkle --size-curve ease-in-out --size-from 0.2 --size-to 1.4 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient "#ffffff@0,#ffcb52@0.4,#ffd24a@1"
p add-emitter --name motes --shape disc --x 64 --y 52 --radius 24 \
  --rate 10 --lifetime 1000 --lifetime-spread 200 --speed 16 --speed-spread 6 \
  --dir-y 1 --cone-angle 40 --seed 9
p set-particle --emitter motes --size-curve ease-out --size-from 1.0 --size-to 0.1 \
  --opacity-curve ease-in-out --opacity-from 0.9 --opacity-to 0 \
  --color-gradient "#ffe9a8@0,#ffd24a@1"
p set-timeline --loop true
p render >/dev/null

# ============================ CLEANUP (one-shot litter puff) ==================
# A short puff kicked up when a janitor clears litter (or litter is dropped): a quick low
# radial burst of dust and grass flecks that arcs down and settles. One-shot.
newsys cleanup 700 false
p set-forces --gravity -42 --drag 2.0
p add-emitter --name dust --shape disc --x 64 --y 56 --radius 4 \
  --burst 26 --at 0 --lifetime 520 --lifetime-spread 110 --speed 54 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 3
p set-forces --emitter dust --radial 90
p set-particle --emitter dust --size-curve ease-out --size-from 1.4 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 0.95 --opacity-to 0 \
  --color-gradient "#c9cfd9@0,#aeb6c6@0.6,#7c8494@1"
p add-emitter --name flecks --shape disc --x 64 --y 56 --radius 3 \
  --burst 12 --at 0 --lifetime 560 --lifetime-spread 120 --speed 66 --speed-spread 24 \
  --dir-y 1 --cone-angle 360 --seed 7
p set-forces --emitter flecks --radial 70
p set-particle --emitter flecks --size-curve ease-out --size-from 1.0 --size-to 0.1 \
  --opacity-curve ease-out --opacity-from 1 --opacity-to 0 \
  --color-gradient "#6fae5a@0,#4f8f4a@0.6,#2f5a2c@1"
p set-timeline --loop false
p render >/dev/null

echo "produced particle systems under $FX:"
ls -la "$FX"
