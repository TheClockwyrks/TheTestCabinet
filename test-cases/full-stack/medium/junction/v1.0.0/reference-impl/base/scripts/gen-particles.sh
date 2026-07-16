#!/usr/bin/env bash
# Junction — author the city's atmospheric & celebratory VFX as particle SYSTEMS with the
# on-PATH `particle-2d` tool (ASSETS.md §3, specs/assets.md "Particle systems"). Each effect
# is authored as a system (emitters + forces + per-particle size/opacity/color curves), NOT
# baked frames: `render` emits a compact `system.json` that the game plays LIVE via
# `@test-cabinet/particle-runtime`'s ParticleCanvasPlayer (src/particles.ts). Three effects
# land under assets/fx/ — pollution (looping smog haze), dust (one-shot construction puff),
# and fireworks (one-shot milestone burst). Re-run to regenerate. The tool's
# *.actions.json / *.preview.gif scratch is written to a temp dir (never committed); only the
# finished system.json files under assets/fx/ are kept.
#
# Usage:  bash scripts/gen-particles.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Coordinate convention (from the tool + the runtime): x across, y UP. The canvas player
# flips y up->down for the screen, so a larger y renders higher. Positive `--gravity`
# accelerates in -y (falls DOWN on screen); negative `--gravity` gives an upward buoyancy
# (smoke/haze rise). Field is 128x128, centered at (64,64), the footprint each is scaled to
# on the map (ASSETS.md §3).
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

# ---- helpers -----------------------------------------------------------------
# newfx <loop:true|false> <duration_ms> <out.system.json> : seed a fresh 128x128, 30fps
#   system whose emitted system.json lands at <out>. Preview/action scratch -> $TMP.
newfx() {
  printf '{ "width":128, "height":128, "duration_ms":%s, "fps":30, "loop":%s, "background":"transparent", "actions":"%s", "preview":"%s", "system":"%s" }\n' \
    "$2" "$1" "$TMP/actions.json" "$TMP/preview.gif" "$3" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ POLLUTION (drifting smog haze, LOOP) =============
# Slow, drifting, SETTLING smog over heavy industry / jammed corridors. Driven by the tile
# pollution field: src/particles.ts spawns/scales it where pollution is present and thins it
# as pollution clears. A wide, soft haze bed that wells up, drags to a near-stall and drifts
# sideways on a light wind, plus a few darker low wisps that settle. pollution #8a7d5a with a
# paler haze tint #b3a883 and a dirtier core #6a5f43.
newfx true 3200 "$FX/pollution.system.json"
p add-emitter --name haze --shape disc --x 64 --y 46 --radius 26 \
  --rate 9 --lifetime 2600 --lifetime-spread 500 \
  --speed 12 --speed-spread 6 --dir-y 1 --cone-angle 70 --seed 21
p set-forces --emitter haze --gravity -4 --drag 1.6 --wind "9,0" --turbulence "6,0.02"
p set-particle --emitter haze --size-curve ease-out --size-from 0.7 --size-to 2.1 \
  --opacity-curve ease-in-out --opacity-from 0.0 --opacity-to 0.0 \
  --color-gradient "#b3a883@0,#8a7d5a@0.5,#6a5f43@1"
p add-emitter --name wisp --shape disc --x 64 --y 40 --radius 20 \
  --rate 5 --lifetime 2200 --lifetime-spread 400 \
  --speed 8 --speed-spread 4 --dir-y 1 --cone-angle 120 --seed 34
p set-forces --emitter wisp --gravity 5 --drag 2.2 --wind "6,0" --turbulence "5,0.03"
p set-particle --emitter wisp --size-curve ease-out --size-from 0.5 --size-to 1.5 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 \
  --color-gradient "#8a7d5a@0,#6a5f43@1"
p set-timeline --loop true
p render
echo "produced pollution.system.json"

# ============================ DUST (construction puff, one-shot) ==============
# A short earthy puff thrown when a lot develops/upgrades, played at the constructing tile
# and paired with the construction sheet (specs/map.md). A soft grey-brown cloud that swells
# and settles + a few flung grit bits that arc and fall. earth #2a2f26, dust #9aa4af, and a
# mid tone #5b6570.
newfx false 620 "$FX/dust.system.json"
p add-emitter --name puff --shape disc --x 64 --y 58 --radius 8 \
  --burst 20 --at 0 --lifetime 480 --lifetime-spread 120 \
  --speed 52 --speed-spread 24 --dir-y 1 --cone-angle 150 --seed 6
p set-forces --emitter puff --gravity 30 --drag 2.6
p set-particle --emitter puff --size-curve ease-out --size-from 0.7 --size-to 1.6 \
  --opacity-curve ease-out --opacity-from 0.85 --opacity-to 0.0 \
  --color-gradient "#9aa4af@0,#5b6570@0.55,#2a2f26@1"
p add-emitter --name grit --shape point --x 64 --y 60 \
  --burst 11 --at 0 --lifetime 340 --lifetime-spread 80 \
  --speed 96 --speed-spread 38 --dir-y 1 --cone-angle 360 --seed 16
p set-forces --emitter grit --gravity 150 --drag 1.4
p set-particle --emitter grit --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#9aa4af@0,#5b6570@0.5,#2a2f26@1"
p set-timeline --loop false
p render
echo "produced dust.system.json"

# ============================ FIREWORKS (milestone burst, one-shot) ===========
# A celebratory milestone burst (first rail line, a population threshold, a maxed district —
# specs/flow.md). A bright white flash, then three overlapping radial sprays in the celebratory
# palette — money #7cd45a, com #4a90d9, power #ffcb52 — that fan out, fall under gravity and
# leave a fading trail (a step subemitter). #ffffff spark cores.
newfx false 1100 "$FX/fireworks.system.json"
# a small hot flash at the launch point
p add-emitter --name flash --shape point --x 64 --y 66 \
  --burst 8 --at 0 --lifetime 150 --lifetime-spread 30 \
  --speed 28 --speed-spread 14 --dir-y 1 --cone-angle 360 --seed 2
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 1.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcb52@1"
# green shell — the trailing sparks
p add-emitter --name green --shape point --x 64 --y 66 \
  --burst 26 --at 30 --lifetime 720 --lifetime-spread 160 \
  --speed 190 --speed-spread 45 --dir-y 1 --cone-angle 360 --seed 8
p set-forces --emitter green --drag 2.6 --radial 150 --gravity 120
p set-particle --emitter green --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#7cd45a@0.35,#7cd45a@1"
# a wisp that trails each green spark along its path
p add-emitter --name gtrail --shape point --x 64 --y 66 \
  --rate 34 --lifetime 260 --lifetime-spread 60 --speed 6 --speed-spread 4 \
  --dir-y 1 --cone-angle 360 --seed 18
p set-forces --emitter gtrail --drag 3.0 --gravity 40
p set-particle --emitter gtrail --size-curve ease-out --size-from 0.55 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.7 --opacity-to 0.0 \
  --color-gradient "#c9f0b0@0,#7cd45a@1"
p add-subemitter --parent green --on step --emitter gtrail
# blue shell — a wider, slightly later fan
p add-emitter --name blue --shape point --x 64 --y 66 \
  --burst 22 --at 90 --lifetime 780 --lifetime-spread 170 \
  --speed 165 --speed-spread 42 --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter blue --drag 2.6 --radial 130 --gravity 120
p set-particle --emitter blue --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#4a90d9@0.35,#4a90d9@1"
# amber shell — the last, brightest pop
p add-emitter --name amber --shape point --x 64 --y 66 \
  --burst 24 --at 150 --lifetime 700 --lifetime-spread 150 \
  --speed 205 --speed-spread 50 --dir-y 1 --cone-angle 360 --seed 15
p set-forces --emitter amber --drag 2.8 --radial 165 --gravity 120
p set-particle --emitter amber --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcb52@0.35,#ffcb52@1"
p set-timeline --loop false
p render
echo "produced fireworks.system.json"

echo "all particle systems produced under $FX"
