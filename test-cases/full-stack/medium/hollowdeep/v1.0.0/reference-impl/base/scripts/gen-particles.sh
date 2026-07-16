#!/usr/bin/env bash
# Hollowdeep — produce the particle systems with the on-PATH `particle-2d` tool
# (specs/assets.md, ASSETS.md "Particle systems"). Each op is recorded into a per-effect
# action log; `render` simulates the system and emits the committed `system.json` (played
# live at runtime by `@test-cabinet/particle-runtime`). We never bake frames.
#
# Four systems on a 128×128 field:
#   fx/oxygen_haze.system.json   loop  — fine RISING haze, breathable-air overlay
#   fx/co2_plume.system.json     loop  — heavier SETTLING plume, waste-gas overlay
#   fx/dig_dust.system.json      once  — one-shot puff at a mined tile
#   fx/machine_steam.system.json loop  — small vent that drifts up at a running machine
#
# Buoyancy (specs/gas.md) reads by MOTION, not color: y is up, and per the tool a
# negative `--gravity` pulls down — so oxygen uses a positive (up) gravity and CO2 a
# negative (down) one.
#
# Usage:  bash scripts/gen-particles.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
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

# The .config.json / .actions.json / .preview.gif written beside each system.json are
# authoring scratch (git-ignored); only the *.system.json is committed.
CFG="$FX/_scratch.config.json"

# newsys <system-name> <duration-ms> <loop:true|false>
#   Seed a fresh 128×128 config for one effect and start its log. `render` reads $CFG.
newsys() {
  local name="$1" dur="$2" loop="$3"
  printf '{ "width": 128, "height": 128, "duration_ms": %s, "fps": 30, "loop": %s, "background": "transparent", "actions": "%s", "preview": "%s", "system": "%s" }\n' \
    "$dur" "$loop" "$FX/$name.actions.json" "$FX/$name.preview.gif" "$FX/$name.system.json" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ OXYGEN HAZE (rising, breathable air) =============
# A fine, low-opacity haze that rises: a wide floor edge emits small particles upward
# with a gentle up-gravity + turbulence so it drifts and thins as it climbs the field.
newsys oxygen_haze 2400 true
p add-emitter --name haze --shape edge --x 64 --y 10 --size-x 120 \
  --rate 46 --lifetime 2300 --lifetime-spread 500 \
  --speed 16 --speed-spread 6 --dir-x 0 --dir-y 1 --cone-angle 22 --seed 21
p set-forces --emitter haze --gravity 10 --drag 0.6 --turbulence 6,0.03 --wind 3,0
p set-particle --emitter haze \
  --size-curve ease-in-out --size-from 0.5 --size-to 0.9 \
  --opacity-curve ease-out --opacity-from 0.42 --opacity-to 0.0 \
  --color-gradient '#47e0c8@0,#7ee9d6@0.5,#a6f0e4@1'
p set-timeline --loop true
p render

# ============================ CO2 PLUME (settling, waste gas) ==================
# Heavier, larger, slower particles that sink: a ceiling edge emits downward with a
# down-gravity and heavier opacity, pooling low. Slower speed + bigger caps than O2.
newsys co2_plume 2600 true
p add-emitter --name plume --shape edge --x 64 --y 118 --size-x 120 \
  --rate 34 --lifetime 2600 --lifetime-spread 500 \
  --speed 11 --speed-spread 4 --dir-x 0 --dir-y -1 --cone-angle 20 --seed 37
p set-forces --emitter plume --gravity=-9 --drag 0.5 --turbulence 4,0.025 --wind=-2,0
p set-particle --emitter plume \
  --size-curve ease-in-out --size-from 0.9 --size-to 1.5 \
  --opacity-curve ease-out --opacity-from 0.6 --opacity-to 0.0 \
  --color-gradient '#b6c24a@0,#c6cf62@0.5,#d0d97a@1'
p set-timeline --loop true
p render

# ============================ DIG DUST (one-shot mined-tile puff) ==============
# A short omnidirectional burst at the tile center, shoved out then pulled down by
# gravity with heavy drag — a quick brown puff that settles and fades.
newsys dig_dust 720 false
p add-emitter --name dust --shape disc --x 64 --y 64 --radius 5 \
  --burst 26 --at 0 --lifetime 520 --lifetime-spread 130 \
  --speed 95 --speed-spread 35 --dir-x 0 --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter dust --gravity=-55 --drag 3.2
p set-particle --emitter dust \
  --size-curve ease-out --size-from 1.0 --size-to 0.25 \
  --opacity-curve ease-out --opacity-from 0.85 --opacity-to 0.0 \
  --color-gradient '#6b6355@0,#4a3524@0.6,#3a2a1c@1'
p set-timeline --loop false
p render

# ============================ MACHINE STEAM (looping vent) =====================
# A small warm vent at a machine's spout: a tight cone of steam rises, expands, and
# fades — gentle up-gravity + a little turbulence so it curls as it drifts.
newsys machine_steam 1700 true
p add-emitter --name steam --shape disc --x 64 --y 22 --radius 4 \
  --rate 18 --lifetime 1500 --lifetime-spread 300 \
  --speed 20 --speed-spread 7 --dir-x 0 --dir-y 1 --cone-angle 24 --seed 11
p set-forces --emitter steam --gravity 14 --drag 0.9 --turbulence 5,0.04
p set-particle --emitter steam \
  --size-curve ease-out --size-from 0.55 --size-to 1.6 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 \
  --color-gradient '#a89e8d@0,#cfc7b8@0.5,#eaf7f3@1'
p set-timeline --loop true
p render

# Drop the shared scratch config (the per-effect .actions/.preview scratch is git-ignored).
rm -f "$CFG"

echo "produced particle systems under $FX:"
ls -1 "$FX"/*.system.json
