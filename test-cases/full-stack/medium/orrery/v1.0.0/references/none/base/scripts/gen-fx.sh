#!/usr/bin/env bash
# Orrery — author the three particle EFFECTS as simulated systems with the
# on-PATH `particle-2d` tool (specs/assets.md → "The particle effects"). Each
# `render` emits a compact `system.json` the game plays LIVE through
# @clockwyrks/particle-runtime's `./canvas` binding, on the same context the
# field is drawn into; because the systems are simulated, every play varies,
# and that variation is the contract.
#
# RADIAL SYMMETRY is the authored invariant. specs/assets.md requires each
# system to read correctly wherever on the field it plays, so every emitter
# here is a centered point or disc with a full 360-degree cone, and the only
# forces are radial push or pull, drag, and a rotationally symmetric vortex.
# NO gravity and NO wind: a directional force would stamp an up and a down onto
# an effect the game fires on any of ninety-one hexes. Placing and scaling an
# instance at its event's position stays the build's own code.
#
# The look is A BRASS INSTRUMENT UNDER A NIGHT SKY, so the three read as one
# workshop: warm brass and gold when the machine does what it was built to do,
# and the one alarm color when it fails.
#
# Produces, at the exact paths specs/assets.md lists:
#   assets/particles/deliver.json   a set consumed an accepted constellation:
#                                   a brass flash and a ring of gold sparks
#                                   drawn INWARD into the aperture, plus a few
#                                   escaping motes. The small, frequent one.
#   assets/particles/fault.json     the run halted: a hard white strike
#                                   collapsing to the alarm red, fast angular
#                                   shards, and dark smoke left behind. The one
#                                   effect in the game that is not warm.
#   assets/particles/complete.json  the run completed at hex (0, 0): the
#                                   biggest and slowest — a white-gold bloom, a
#                                   wide brass shockwave, and a long swirl of
#                                   gold motes settling out.
#
# The field is 128 x 128 centered at (64, 64) — the neutral footprint an
# instance is scaled to at its event's position. Every system is one-shot
# (`set-timeline --loop false`), so it decays to empty rather than settling
# into a steady state; the build plays a fresh instance per event.
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
# The tool writes its log and preview beside the config, so it works from a
# scratch directory and only the finished system.json lands under assets/.
cd "$TMP"
CFG="$TMP/cfg.json"

# --- the palette, the same brass ramp the sprites are painted from -----------
BRASS_HIGH='#fff4dc'
BRASS_PALE='#f6dca6'
BRASS_LIT='#e8b661'
BRASS_MID='#a97a2f'
BRASS_DARK='#6a4a1d'
GLASS_LIT='#9fe8ff'
ALARM='#e2664f'
EMBER_LIT='#ffb84a'

# newfx <duration_ms> <out.json> — seed a fresh one-shot 128x128, 30fps system.
newfx() {
  printf '{ "width":128, "height":128, "duration_ms":%s, "fps":30, "loop":false, "background":"transparent", "actions":"%s", "preview":"%s", "system":"%s" }\n' \
    "$1" "$TMP/actions.json" "$TMP/preview.gif" "$2" > "$CFG"
  particle-2d init --config "$CFG" >/dev/null
}
p() { particle-2d "$@" --config "$CFG" >/dev/null; }

# ================================ DELIVERY ===================================
# Fired on the anchor hex of each set that consumed at least one accepted
# constellation at this boundary. It fires often — a working machine delivers
# every few cycles — so it is the SHORT one: a brass flash on the aperture, a
# ring of gold sparks pulled INWARD (a negative radial: the set is taking the
# constellation in, not throwing it out), and a handful of motes that escape
# outward and fade. Warm and quick; it never covers the field it plays on.
newfx 620 "$FX/deliver.json"
# The aperture flash: bright, brief, brass cooling to its own dark.
p add-emitter --name flash --shape point --x 64 --y 64 \
  --burst 12 --at 0 --lifetime 220 --lifetime-spread 50 --speed 26 --speed-spread 12 \
  --dir-y 1 --cone-angle 360 --seed 17
p set-forces --emitter flash --drag 4.6
p set-particle --emitter flash --size-curve ease-out --size-from 4.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "$BRASS_HIGH@0,$BRASS_PALE@0.4,$BRASS_LIT@1"
# The intake: a ring launched outward and hauled back in by a negative radial,
# so the sparks turn and fall into the aperture. Reads as consumption.
p add-emitter --name intake --shape disc --x 64 --y 64 --radius 30 \
  --burst 34 --at 0 --lifetime 480 --lifetime-spread 90 --speed 30 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 31
p set-forces --emitter intake --radial -230 --vortex 70 --drag 0.8
p set-particle --emitter intake --size-curve ease-out --size-from 2.0 --size-to 0.3 \
  --opacity-curve ease-in-out --opacity-from 0.95 --opacity-to 0.0 --stretch 0.10 \
  --color-gradient "$BRASS_PALE@0,$BRASS_LIT@0.5,$BRASS_MID@1"
# A few motes that get away, so the effect has an outer edge to read against.
p add-emitter --name escapes --shape point --x 64 --y 64 \
  --burst 11 --at 40 --lifetime 400 --lifetime-spread 120 --speed 110 --speed-spread 45 \
  --dir-y 1 --cone-angle 360 --seed 53
p set-forces --emitter escapes --drag 1.4
p set-particle --emitter escapes --size-curve ease-out --size-from 1.5 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.14 \
  --color-gradient "$BRASS_HIGH@0,$BRASS_LIT@0.55,$BRASS_DARK@1"
p set-timeline --loop false
p render
echo "produced deliver.json"

# ================================== FAULT ====================================
# Fired at the mote or the part the fault names. This is the machine BREAKING,
# and it is the one effect that leaves the brass palette: a hard white strike
# that goes straight to the alarm red, fast angular shards thrown clear, and a
# slow dark smoke that hangs after everything else has gone. Nobody mistakes it
# for a delivery.
newfx 900 "$FX/fault.json"
# The strike: a single hard flash, white into the alarm color.
p add-emitter --name strike --shape point --x 64 --y 64 \
  --burst 10 --at 0 --lifetime 190 --lifetime-spread 40 --speed 18 --speed-spread 9 \
  --dir-y 1 --cone-angle 360 --seed 7
p set-forces --emitter strike --drag 5.2
p set-particle --emitter strike --size-curve ease-out --size-from 7.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,#ffd9c8@0.35,$ALARM@1"
# The shards: hard, fast, stretched, thrown out on a strong radial and stopped
# by heavy drag, so they read as pieces rather than as sparks.
p add-emitter --name shards --shape disc --x 64 --y 64 --radius 4 \
  --burst 30 --at 0 --lifetime 520 --lifetime-spread 140 --speed 150 --speed-spread 62 \
  --dir-y 1 --cone-angle 360 --seed 23
p set-forces --emitter shards --radial 130 --drag 1.5
p set-particle --emitter shards --size-curve ease-out --size-from 2.2 --size-to 0.1 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.20 --rotation 220 \
  --color-gradient "#fff0e8@0,#ff8f74@0.3,$ALARM@0.7,#8f2a18@1"
# The smoke: slow, wide, and dark, and the last thing left on the hex.
p add-emitter --name smoke --shape disc --x 64 --y 64 --radius 9 \
  --burst 18 --at 90 --lifetime 780 --lifetime-spread 200 --speed 34 --speed-spread 15 \
  --dir-y 1 --cone-angle 360 --seed 41
p set-forces --emitter smoke --drag 1.2
p set-particle --emitter smoke --size-curve ease-out --size-from 2.4 --size-to 4.6 \
  --opacity-curve ease-out --opacity-from 0.55 --opacity-to 0.0 \
  --color-gradient "#7a3a2c@0,#2a1b20@1"
p set-timeline --loop false
p render
echo "produced fault.json"

# ================================ COMPLETION =================================
# Fired once, on hex (0, 0), on the boundary the run completes. The biggest and
# the slowest of the three: a white-gold bloom at the middle, a wide brass
# shockwave shell riding out past it, a long swirl of gold motes coming round
# the center, and a few cold glass glints for the sky the machine works under.
# It is unmistakably the reward, and it decays to nothing like the other two.
newfx 1500 "$FX/complete.json"
# The bloom: large, slower than the other flashes, white into brass.
p add-emitter --name bloom --shape point --x 64 --y 64 \
  --burst 18 --at 0 --lifetime 460 --lifetime-spread 110 --speed 30 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 11
p set-forces --emitter bloom --drag 3.8
p set-particle --emitter bloom --size-curve ease-out --size-from 8.0 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,$BRASS_HIGH@0.35,$BRASS_LIT@1"
# The shockwave: a thin bright shell driven hard out and braked, so it reads as
# one expanding ring rather than as a spray.
p add-emitter --name shell --shape disc --x 64 --y 64 --radius 5 \
  --burst 54 --at 0 --lifetime 620 --lifetime-spread 60 --speed 104 --speed-spread 14 \
  --dir-y 1 --cone-angle 360 --seed 29
p set-forces --emitter shell --radial 90 --drag 1.9
p set-particle --emitter shell --size-curve ease-out --size-from 2.4 --size-to 0.0 \
  --opacity-curve ease-out --opacity-from 0.95 --opacity-to 0.0 --stretch 0.12 \
  --color-gradient "$BRASS_HIGH@0,$BRASS_LIT@0.55,$BRASS_MID@1"
# The swirl: gold motes coming round the center on a symmetric vortex, the
# longest-lived layer and the one that says the orrery is turning.
p add-emitter --name swirl --shape disc --x 64 --y 64 --radius 10 \
  --burst 44 --at 60 --lifetime 1150 --lifetime-spread 260 --speed 66 --speed-spread 28 \
  --dir-y 1 --cone-angle 360 --seed 37
p set-forces --emitter swirl --radial 22 --vortex 120 --drag 0.85
p set-particle --emitter swirl --size-curve ease-out --size-from 2.2 --size-to 0.2 \
  --opacity-curve ease-out --opacity-from 1.0 --opacity-to 0.0 --stretch 0.08 \
  --color-gradient "$BRASS_PALE@0,$EMBER_LIT@0.5,$BRASS_MID@1"
# A scatter of cold glints: the night sky the whole machine sits under, and the
# only cold thing in the effect.
p add-emitter --name glints --shape disc --x 64 --y 64 --radius 26 \
  --burst 16 --at 180 --lifetime 900 --lifetime-spread 300 --speed 16 --speed-spread 9 \
  --dir-y 1 --cone-angle 360 --seed 59
p set-forces --emitter glints --drag 2.0
p set-particle --emitter glints --size-curve ease-in-out --size-from 0.5 --size-to 1.8 \
  --opacity-curve ease-in-out --opacity-from 0.9 --opacity-to 0.0 \
  --color-gradient "#ffffff@0,$GLASS_LIT@1"
p set-timeline --loop false
p render
echo "produced complete.json"

echo "produced orrery particle systems under $FX:"
ls -la "$FX"
