#!/usr/bin/env bash
# Holdfast — author the colony VFX as particle SYSTEMS with the on-PATH `particle-2d`
# tool (ASSETS.md §3, specs/assets.md "Particle systems"). Each effect is authored as a
# system (emitters + forces + per-particle size/opacity/color curves), NOT baked frames:
# `render` emits a compact `system.json` that the game plays LIVE via
# `@test-cabinet/particle-runtime`'s ParticleCanvasPlayer. Six effects land under
# assets/fx/ — muzzle, blood, impact, fire (looping), explosion, dust. Re-run to
# regenerate. The tool's *.actions.json / *.preview.gif scratch is written to a temp dir
# (never committed); only the finished system.json files under assets/fx/ are kept.
#
# Usage:  bash scripts/gen-particles.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
#
# Coordinate convention (from the tool + the runtime): x across, y UP. The canvas player
# flips y up->down for the screen, so a larger y renders higher. Positive `--gravity`
# accelerates in -y (falls DOWN on screen); negative `--gravity` gives an upward buoyancy
# (smoke/flame rise). Field is 128x128, centered at (64,64), matching valence.
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

# ============================ MUZZLE (warm barrel flash, one-shot) =============
# A short, bright warm flash at a shooter's barrel: a punchy white core + a warm
# orange spray that decays fast. #ffcf6a / #ffffff / #ff8646.
newfx false 250 "$FX/muzzle.system.json"
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 170 --lifetime-spread 40 \
  --speed 120 --speed-spread 45 --dir-y -1 --cone-angle 360 --seed 7
p set-forces --emitter flash --drag 4
p set-particle --emitter flash --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf6a@0.45,#ff8646@1"
p add-emitter --name core --shape point --x 64 --y 64 \
  --burst 6 --at 0 --lifetime 110 --lifetime-spread 20 \
  --speed 40 --speed-spread 20 --dir-y -1 --cone-angle 360 --seed 17
p set-forces --emitter core --drag 5
p set-particle --emitter core --size-curve ease-out --size-from 1.3 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf6a@1"
p set-timeline --loop false
p render
echo "produced muzzle.system.json"

# ============================ BLOOD (person hit, one-shot) =====================
# A red spray that arcs out and falls under gravity. #e05a6a / #c0473f.
newfx false 550 "$FX/blood.system.json"
p add-emitter --name spray --shape point --x 64 --y 64 \
  --burst 22 --at 0 --lifetime 380 --lifetime-spread 90 \
  --speed 100 --speed-spread 45 --dir-y 1 --cone-angle 360 --seed 3
p set-forces --emitter spray --gravity 320 --drag 1.2
p set-particle --emitter spray --size-curve ease-out --size-from 1.0 --size-to 0.15 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#e05a6a@0,#c0473f@1"
p add-emitter --name mist --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 250 --lifetime-spread 60 \
  --speed 60 --speed-spread 30 --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter mist --gravity 180 --drag 2.0
p set-particle --emitter mist --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 \
  --color-gradient "#e05a6a@0,#c0473f@1"
p set-timeline --loop false
p render
echo "produced blood.system.json"

# ============================ IMPACT (wall/turret hit, one-shot) ===============
# A duller chip/spark burst of stone-brown grit that falls. #a89e8d / #8a6a44 / #38332c.
newfx false 450 "$FX/impact.system.json"
p add-emitter --name chips --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 300 --lifetime-spread 80 \
  --speed 120 --speed-spread 55 --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter chips --gravity 280 --drag 1.8
p set-particle --emitter chips --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#a89e8d@0,#8a6a44@0.5,#38332c@1"
p add-emitter --name spark --shape point --x 64 --y 64 \
  --burst 8 --at 0 --lifetime 180 --lifetime-spread 40 \
  --speed 155 --speed-spread 50 --dir-y 1 --cone-angle 360 --seed 15
p set-forces --emitter spark --drag 3.0
p set-particle --emitter spark --size-curve ease-out --size-from 0.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#a89e8d@0,#8a6a44@1"
p set-timeline --loop false
p render
echo "produced impact.system.json"

# ============================ FIRE (burning structure, LOOP) ===================
# A rising, flickering flame + a lazy smoke plume that loops. Flame cools
# orange->red->smoke as it rises; turbulence gives the flicker.
# #ff5a52 / #ffcf6a / #6b6355 smoke.
newfx true 1200 "$FX/fire.system.json"
p add-emitter --name flame --shape disc --x 64 --y 48 --radius 9 \
  --rate 46 --lifetime 650 --lifetime-spread 160 \
  --speed 46 --speed-spread 14 --dir-y 1 --cone-angle 22 --seed 13
p set-forces --emitter flame --gravity -30 --drag 0.8 --turbulence "22,0.04"
p set-particle --emitter flame --size-curve ease-out --size-from 1.1 --size-to 0.3 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffcf6a@0,#ff5a52@0.55,#6b6355@1"
p add-emitter --name smoke --shape disc --x 64 --y 70 --radius 7 \
  --rate 14 --lifetime 1000 --lifetime-spread 200 \
  --speed 34 --speed-spread 12 --dir-y 1 --cone-angle 18 --seed 14
p set-forces --emitter smoke --gravity -20 --drag 0.5 --turbulence "14,0.05"
p set-particle --emitter smoke --size-curve ease-in --size-from 0.6 --size-to 1.6 \
  --opacity-curve ease-in-out --opacity-from 0.5 --opacity-to 0.0 \
  --color-gradient "#6b6355@0,#6b6355@1"
p set-timeline --loop true
p render
echo "produced fire.system.json"

# ============================ EXPLOSION (destroyed turret, one-shot) ===========
# A fast radial spray of hot sparks + an expanding smoke puff that rises and fades.
# #ffcf6a / #ff5a52 / #6b6355.
newfx false 850 "$FX/explosion.system.json"
p add-emitter --name sparks --shape point --x 64 --y 64 \
  --burst 34 --at 0 --lifetime 420 --lifetime-spread 110 \
  --speed 230 --speed-spread 70 --dir-y 1 --cone-angle 360 --seed 8
p set-forces --emitter sparks --drag 3.0 --radial 210
p set-particle --emitter sparks --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffcf6a@0.4,#ff5a52@0.8,#6b6355@1"
p add-emitter --name smoke --shape point --x 64 --y 64 \
  --burst 20 --at 0 --lifetime 720 --lifetime-spread 160 \
  --speed 90 --speed-spread 35 --dir-y 1 --cone-angle 360 --seed 9
p set-forces --emitter smoke --drag 2.0 --radial 80 --gravity -25
p set-particle --emitter smoke --size-curve ease-in --size-from 0.7 --size-to 1.8 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 \
  --color-gradient "#ffcf6a@0,#6b6355@0.6,#6b6355@1"
p set-timeline --loop false
p render
echo "produced explosion.system.json"

# ============================ DUST (worked node / build done, one-shot) ========
# A short earthy puff that swells and settles, plus a few flung grit bits that fall.
# #b98b4e / #5a4632 / #a89e8d.
newfx false 500 "$FX/dust.system.json"
p add-emitter --name puff --shape disc --x 64 --y 60 --radius 6 \
  --burst 18 --at 0 --lifetime 420 --lifetime-spread 110 \
  --speed 55 --speed-spread 25 --dir-y 1 --cone-angle 130 --seed 6
p set-forces --emitter puff --gravity 40 --drag 2.5
p set-particle --emitter puff --size-curve ease-out --size-from 0.7 --size-to 1.4 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 \
  --color-gradient "#b98b4e@0,#a89e8d@0.5,#5a4632@1"
p add-emitter --name grit --shape point --x 64 --y 62 \
  --burst 10 --at 0 --lifetime 300 --lifetime-spread 70 \
  --speed 90 --speed-spread 35 --dir-y 1 --cone-angle 360 --seed 16
p set-forces --emitter grit --gravity 120 --drag 1.5
p set-particle --emitter grit --size-curve ease-out --size-from 0.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#b98b4e@0,#5a4632@1"
p set-timeline --loop false
p render
echo "produced dust.system.json"

echo "all particle systems produced under $FX"
