#!/usr/bin/env bash
# Gantry — collapse.wav, built from nothing with `sfx-sample`.
#
# The cue: "the whole crane coming down, with real weight" (specs/assets.md), played when a run
# fails as `collapse` or `ring-overload` (specs/ui.md). It is the heaviest sound in the game and
# it fires once, at the end of a run, so it is allowed to be long: a hard give-way, a tumbling
# clatter of steel coming down, a ground-shaking low end under all of it, and a settling rumble.
#
# NOTE ON THE TOOL: the baked sample library on this machine is EMPTY (`sfx-sample list-samples`
# -> "no samples"), so nothing here uses `add-sample`. Every layer is an oscillator or noise
# voice through `sfx-sample`'s voice and effect operations — the same constraint the Arc Foundry
# case works under.
#
# Usage:  bash build.sh    (sfx-sample must be on PATH, or under $CARGO_TARGET_DIR/release)
set -euo pipefail

if ! command -v sfx-sample >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-sample" ] || { echo "sfx-sample not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
CFG="$DIR/sfx-sample.config.json"

cat > "$CFG" <<JSON
{
  "sample_rate": 44100,
  "channels": "stereo",
  "max_duration_ms": 2600,
  "seed": 4711,
  "sample_pack": "combat-core@0.1.0",
  "actions": "$DIR/collapse.actions.json",
  "preview": "$DIR/preview.png",
  "wav": "$DIR/collapse.wav"
}
JSON

x() { sfx-sample "$@" --config "$CFG" >/dev/null; }

sfx-sample init --config "$CFG" >/dev/null

# ---------------------------------------------------------------- the give-way
# The instant the structure loses it: a broadband crash of steel letting go all at once, its
# filter slamming shut as the brightness collapses into the body of the fall. This is the loudest
# moment in the cue — everything after it is the wreck coming down.
x add-voice --name crash --wave noise --gain -4 --start 0 --dur 460 --pan 0.0
x set-envelope --voice crash --attack 1 --decay 170 --sustain 0.30 --release 280
x add-filter --voice crash --type lowpass --cutoff 7500 --sweep-to 800 --over 430 --resonance 1.2

# The tearing crack of the members themselves — a distorted saw dragged hard downward.
x add-voice --name crack --wave saw --freq 460 --gain -7 --start 0 --dur 340 --pan -0.12
x set-envelope --voice crack --env punch
x set-pitch --voice crack --slide-to 70 --over 320
x add-ringmod --voice crack --freq 47
x add-distortion --voice crack --drive 2.2

# ------------------------------------------------------------------- the weight
# The low end BEHIND the crash, not in front of it: the mass of the crane arriving at the ground.
# A deep sine sagging from a chest thump to a floor-shaking sub, held under the clatter.
x add-voice --name sub --wave sine --freq 64 --gain -6 --start 0 --dur 1400 --pan 0.0
x set-envelope --voice sub --attack 3 --decay 380 --sustain 0.26 --release 780
x set-pitch --voice sub --slide-to 26 --over 1200

# The second, bigger hit: the tower itself landing a beat after the arm goes.
x add-voice --name boom --wave sine --freq 100 --gain -10 --start 540 --dur 780 --pan 0.06
x set-envelope --voice boom --env punch
x set-pitch --voice boom --slide-to 32 --over 700
x add-distortion --voice boom --drive 1.5

# ------------------------------------------------------------------ the tumbling
# A lattice crane comes down in many pieces, so the body of the cue is a DENSE, irregular clatter
# that thins and dulls as the debris loses height. Each strike is a bandpassed noise hit (steel
# meeting steel or ground) under a ring-modded square clang (the member ringing off), spread
# across the yard, falling in pitch and level toward the pile.
hit() { # <name> <start> <gain> <band Hz> <clang Hz> <pan> <dur>
  local n="$1" s="$2" g="$3" b="$4" c="$5" p="$6" d="$7"
  x add-voice --name "n_$n" --wave noise --gain "$g" --start "$s" --dur "$d" --pan "$p"
  x set-envelope --voice "n_$n" --env pluck
  x add-filter --voice "n_$n" --type bandpass --cutoff "$b" --sweep-to "$(( b / 3 ))" --over "$d" --resonance 2.2
  x add-voice --name "c_$n" --wave square --freq "$c" --gain "$(( g - 4 ))" --start "$s" --dur "$(( d + 60 ))" --pan "$p"
  x set-envelope --voice "c_$n" --env pluck
  x add-fm --voice "c_$n" --carrier 1 --modulator 3.3 --index 5
  x set-pitch --voice "c_$n" --slide-to "$(( c * 2 / 3 ))" --over "$(( d + 40 ))"
}
#    n  start  gain  band clang   pan  dur
hit  1     90    -4  3600  680  -0.35  170
hit  2    170    -5  2900  520   0.28  200
hit  3    280    -4  3300  600   0.40  180
hit  4    390    -6  2500  440  -0.20  210
hit  5    510    -5  2800  560   0.12  190
hit  6    650    -6  2200  400  -0.44  220
hit  7    790    -6  2600  480   0.36  200
hit  8    930    -7  2000  360  -0.28  230
hit  9   1080    -7  2300  420   0.44  200
hit 10   1230    -9  1800  330  -0.16  220
hit 11   1390   -10  2000  370   0.30  200
hit 12   1550   -12  1600  290  -0.38  220
hit 13   1710   -13  1700  310   0.20  200
hit 14   1880   -16  1400  250  -0.26  210

# The last few pieces settling on top of the pile: small, dull, far apart.
hit 15   2060   -19  1200  210   0.34  180
hit 16   2240   -24  1000  180  -0.30  160

# -------------------------------------------------------------------- the settle
# What is left after the fall: a dark rumble of dust and shifting steel, swelling under the last
# of the debris and dying away to nothing so the cue ends clean.
x add-voice --name rumble --wave noise --gain -8 --start 60 --dur 1900 --pan 0.0
x set-envelope --voice rumble --attack 90 --decay 620 --sustain 0.26 --release 1100
x add-filter --voice rumble --type lowpass --cutoff 480 --sweep-to 150 --over 1800 --resonance 1.0

# ---------------------------------------------------------------------- the room
# The yard is big and hard-surfaced, so the crash carries. Saturation glues the layers into one
# event, a lowpass keeps it heavy rather than brittle, and the compressor holds the peak down.
x add-distortion --bus master --drive 1.6
x add-filter --bus master --type lowpass --cutoff 6200 --resonance 0.7
x add-reverb --bus master --size 0.70 --mix 0.26
x add-compressor --bus master --threshold -7 --ratio 3.0

x render
echo "wrote $DIR/collapse.wav"
