#!/usr/bin/env bash
# Gantry — `placed` cue: a load's weight SETTLING onto its pad.
#
# The read (specs/assets.md): "A load's weight settling onto its pad" — a soft,
# heavy thud, satisfied rather than alarming. It fires once per load set down, so
# it can be a little longer than the editor clacks, but it must not boom: the
# weight is in the low end, the surface contact is muffled (rubberised pad, not
# steel-on-steel), and the tail dies away cleanly inside ~half a second so a site
# that places several loads in a row never smears.
#
# Authored with `sfx-sample` VOICES + EFFECTS only: the baked sample pack on this
# machine is empty (`sfx-sample list-samples` -> "no samples"), so every layer is
# an oscillator/noise voice, exactly as the Arc Foundry script does.
#
# Usage:  bash build.sh    (sfx-sample must be on PATH, or built under
#         $CARGO_TARGET_DIR/release).
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
  "channels": "mono",
  "max_duration_ms": 520,
  "seed": 1337,
  "sample_pack": "combat-core@0.1.0",
  "actions": "$DIR/log.json",
  "preview": "$DIR/preview.png",
  "wav": "$DIR/placed.wav"
}
JSON

x() { sfx-sample "$@" --config "$CFG" >/dev/null; }

sfx-sample init --config "$CFG" >/dev/null

# --- the mass -----------------------------------------------------------------
# The bulk of the sound: a low sine BODY that drops as the weight comes to rest,
# under a deeper SUB that holds a moment longer so the thud reads as heavy rather
# than as a knock. `punch` gives the instant contact and a held body, no ring.
x add-voice --name body --wave sine --freq 132 --gain -3 --start 0 --dur 200
x set-envelope --voice body --attack 1 --decay 95 --sustain 0.06 --release 70
x set-pitch --voice body --slide-to 66 --over 190

x add-voice --name sub --wave sine --freq 88 --gain -3 --start 4 --dur 250
x set-envelope --voice sub --attack 2 --decay 150 --sustain 0.26 --release 200
x set-pitch --voice sub --slide-to 52 --over 230

# --- the pad ------------------------------------------------------------------
# The contact itself: a very short noise THUMP pushed through a low lowpass, so it
# is a muffled pad impact (dust, rubber, timber) rather than a bright clack.
x add-voice --name pad --wave noise --gain -7 --start 0 --dur 70
x set-envelope --voice pad --env pluck
x add-filter --voice pad --type lowpass --cutoff 620 --sweep-to 240 --over 70 --resonance 1.0

# --- the settle ---------------------------------------------------------------
# The "satisfied" half: a soft mid triangle KNOCK just after contact — the load
# rocking once and coming to rest — and a brief low CREEP of the pad taking the
# weight, both quiet enough to be felt rather than heard.
x add-voice --name knock --wave triangle --freq 196 --gain -13 --start 12 --dur 130
x set-envelope --voice knock --env pluck
x set-pitch --voice knock --slide-to 132 --over 120

x add-voice --name creep --wave noise --gain -21 --start 55 --dur 150
x set-envelope --voice creep --attack 25 --decay 60 --sustain 0.22 --release 90
x add-filter --voice creep --type lowpass --cutoff 900 --sweep-to 380 --over 150 --resonance 1.3

# --- master -------------------------------------------------------------------
# Lowpassed hard so nothing bright survives (soft, not alarming), a small room so
# it lands in the yard rather than in a box, and a gentle compressor to even the
# transient into the body.
x add-filter --bus master --type lowpass --cutoff 1500 --resonance 0.7
x add-compressor --bus master --threshold -10 --ratio 2.5
x add-reverb --bus master --size 0.28 --mix 0.10
x render

echo "produced $DIR/placed.wav"
