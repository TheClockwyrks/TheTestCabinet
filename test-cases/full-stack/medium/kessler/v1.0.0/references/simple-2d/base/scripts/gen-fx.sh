#!/usr/bin/env bash
# Kessler — author the three particle EFFECTS as simulated systems with the
# on-PATH `particle-2d` tool (specs/assets.md → "The particle effects"). Each
# `render` emits a compact `system.json` the game plays LIVE through
# @test-cabinet/particle-runtime's `./canvas` binding; because the systems are
# simulated, every play varies — that variation is the contract.
#
# RADIAL SYMMETRY is the authored invariant: an instance must read correctly at
# ANY angle around the planet, so every emitter here is a centered point/disc
# with a full 360-degree cone, and the only forces are radial push, drag, and
# (for the burn-up) a rotationally-symmetric vortex swirl. NO gravity and NO
# wind — a directional force would stamp an up/down onto an effect the game
# fires at every bearing. Placing and scaling an instance at its event's
# position stays the build's code.
#
# The look is COLD ORBITAL DEMOLITION: white-hot cores cooling into steel
# debris and cold cyan energy; only the burn-up is warm (it happens at the
# planet, the one warm thing in view — its embers share the planet's ambers).
#
# Produces, at the exact paths specs/assets.md lists:
#   assets/particles/burst.json   destruction burst — a target dies: flash,
#                                 shockwave shell, tumbling steel debris.
#   assets/particles/spark.json   impact spark — paddle / containment / shield
#                                 reflection: a quick cold pin-flash + sparks.
#   assets/particles/burnup.json  burn-up — a ball or pod reaches the planet:
#                                 a warm flare collapsing into drifting embers.
#
# Field is 128x128 centered at (64,64) — the neutral footprint each instance is
# scaled to at spawn. Systems are one-shot (loop false); the runtime replays a
# fresh instance per event.
#
# Usage:  bash scripts/gen-fx.sh   (particle-2d must be on PATH, or built under
#         $CARGO_TARGET_DIR).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release/debug dirs.
TARGET="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"
if ! command -v particle-2d >/dev/null 2>&1; then
  for dir in "$TARGET/release" "$TARGET/debug"; do
    [ -x "$dir/particle-2d" ] && { export PATH="$dir:$PATH"; break; }
  done
fi
command -v particle-2d >/dev/null 2>&1 || { echo "particle-2d not found on PATH or under $TARGET" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/assets/particles"
mkdir -p "$FX"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
CFG="$TMP/cfg.json"

# newfx <duration_ms> <out.json> — seed a fresh one-shot 128x128, 30fps system.
newfx() {
  printf '{ "width":128, "height":128, "duration_ms":%s, "fps":30, "loop":false, "background":"transparent", "actions":"%s", "preview":"%s", "system":"%s" }\n' \
    "$1" "$TMP/actions.json" "$TMP/preview.gif" "$2" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ============================ DESTRUCTION BURST ===============================
# A derelict target is destroyed (fired at its arc center): a white-hot core
# flash blooming into cold cyan, a fast expanding shockwave shell, and a spray
# of tumbling steel debris that stretches along its motion and cools to dark
# metal. Everything radiates from the center with no preferred direction.
newfx 700 "$FX/burst.json"
# core flash — big, brief, white -> cyan
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 14 --at 0 --lifetime 240 --lifetime-spread 60 --speed 30 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter flash --drag 4.5
p set-particle --emitter flash --size-curve ease-out --size-from 4.2 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#d6f7ff@0.45,#6ee6ff@1"
# shockwave shell — a thin bright ring driven hard outward (disc + radial)
p add-emitter --name shell --shape disc --x 64 --y 64 --radius 6 \
  --burst 44 --at 0 --lifetime 340 --lifetime-spread 50 --speed 70 --speed-spread 20 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter shell --radial 240 --drag 4.8
p set-particle --emitter shell --size-curve ease-out --size-from 1.9 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.9 --opacity-to 0.0 --stretch 0.12 \
  --color-gradient "#ffffff@0,#6ee6ff@0.6,#1e9cc8@1"
# steel debris — slower chunks that fly, stretch, and cool to dark metal
p add-emitter --name debris --shape point --x 64 --y 64 \
  --burst 28 --at 0 --lifetime 620 --lifetime-spread 180 --speed 125 --speed-spread 55 \
  --dir-y 1 --cone-angle 360 --seed 37
p set-forces --emitter debris --drag 1.6
p set-particle --emitter debris --size-curve ease-out --size-from 1.5 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.09 --rotation 180 \
  --color-gradient "#e8f0f8@0,#9aa7b5@0.4,#3a424e@1"
p set-timeline --loop false
p render
echo "produced burst.json"

# ============================== IMPACT SPARK =================================
# A reflection contact (paddle face, containment field, shield ring): a small,
# fast, COLD spark — a pin-flash and a handful of glassy slivers that die
# quickly. It fires constantly, so it stays short, tight, and cheap, and it is
# clearly smaller and colder than the burst.
newfx 380 "$FX/spark.json"
p add-emitter --name pin --shape point --x 64 --y 64 \
  --burst 6 --at 0 --lifetime 150 --lifetime-spread 35 --speed 14 --speed-spread 7 \
  --dir-y 1 --cone-angle 360 --seed 5
p set-forces --emitter pin --drag 5
p set-particle --emitter pin --size-curve ease-out --size-from 4.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#d6f7ff@1"
p add-emitter --name slivers --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 320 --lifetime-spread 90 --speed 150 --speed-spread 60 \
  --dir-y 1 --cone-angle 360 --seed 19
p set-forces --emitter slivers --drag 2.4
p set-particle --emitter slivers --size-curve ease-out --size-from 1.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.16 \
  --color-gradient "#ffffff@0,#6ee6ff@0.5,#1e9cc8@1"
p set-timeline --loop false
p render
echo "produced spark.json"

# ================================ BURN-UP ====================================
# A ball or pod reaches the planet: the one WARM effect — a white-amber flare
# that collapses while a swirl of embers spins outward and dies to deep planet
# rust, with a faint lingering ash haze. The vortex is rotationally symmetric
# about the center, so the swirl reads identically at any bearing.
newfx 900 "$FX/burnup.json"
# the flare — hot core, briefly huge, warm white -> amber
p add-emitter --name flare --shape point --x 64 --y 64 \
  --burst 16 --at 0 --lifetime 300 --lifetime-spread 70 --speed 24 --speed-spread 12 \
  --dir-y 1 --cone-angle 360 --seed 7
p set-forces --emitter flare --drag 4
p set-particle --emitter flare --size-curve ease-out --size-from 4.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffd9a0@0.4,#ff9d4a@1"
# embers — swirling motes that cool amber -> rust and drift out
p add-emitter --name embers --shape disc --x 64 --y 64 --radius 5 \
  --burst 34 --at 0 --lifetime 760 --lifetime-spread 220 --speed 62 --speed-spread 30 \
  --dir-y 1 --cone-angle 360 --seed 29
p set-forces --emitter embers --radial 34 --vortex 95 --drag 1.7
p set-particle --emitter embers --size-curve ease-out --size-from 1.6 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.07 \
  --color-gradient "#ffd9a0@0,#ff9d4a@0.45,#c9662a@1"
# ash — a few soft, slow motes that linger and fade to nothing
p add-emitter --name ash --shape disc --x 64 --y 64 --radius 8 \
  --burst 14 --at 120 --lifetime 720 --lifetime-spread 200 --speed 20 --speed-spread 10 \
  --dir-y 1 --cone-angle 360 --seed 41
p set-forces --emitter ash --drag 2.6
p set-particle --emitter ash --size-curve ease-out --size-from 1.6 --size-to 2.6 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 \
  --color-gradient "#8a5a3a@0,#5a4a44@1"
p set-timeline --loop false
p render
echo "produced burnup.json"

echo "produced kessler particle systems under $FX:"
ls -la "$FX"
