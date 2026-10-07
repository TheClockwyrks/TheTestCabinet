#!/usr/bin/env bash
# Gantry — the `delete` cue (specs/assets.md §The sound).
#
#   delete — "A part coming away, lighter than `place`."  It fires on every removal of a
#   member, the ring, or a counterweight, AND on every `undo` (specs/ui.md), so it is one of
#   the most-repeated sounds in the game: it must be SHORT, dry, and small enough to press
#   twenty times in a row without fatiguing.
#
# It is authored as `place`'s SIBLING, not a different family: the same yard-steel clack —
# a small hollow body tock, a metallic pin click, and a dry contact tick, in a barely-there
# room — but LIGHTER on every axis. Higher and thinner (less low end, so it does not thud),
# quieter, shorter, and inflected UPWARD instead of down: `place` seats a part with a falling
# pitch, `delete` lifts one away with a rising one. Same voices, same room, opposite gesture —
# which is exactly what makes a pair read as a pair.
#
# Everything is pure `sfx-synth` (oscillator + noise voices): the baked sample pack on this
# machine is empty, and this cue is specified as a `sfx-synth` cue anyway.
#
# Usage:  bash build.sh     (writes delete.wav, preview.png, actions.json beside this script)
set -euo pipefail

if ! command -v sfx-synth >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-synth" ] || { echo "sfx-synth not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HERE/sfx-synth.config.json"

cat > "$CFG" <<JSON
{
  "sample_rate": 44100,
  "channels": "mono",
  "max_duration_ms": 180,
  "seed": 7,
  "actions": "$HERE/actions.json",
  "preview": "$HERE/preview.png",
  "wav": "$HERE/delete.wav"
}
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

sfx-synth init --config "$CFG" >/dev/null

# --- body ---------------------------------------------------------------------
# The hollow TOCK of the part leaving its node. A sine, kept up at 300 Hz (place's body sits
# lower and hits harder) and sliding UP as it releases, so there is a lift in it rather than a
# thud. `punch` gives the instant attack with a very short held knee — a tock, not a boom.
x add-voice --name body --wave sine --freq 340 --gain -12 --start 0 --dur 75
x set-envelope --voice body --attack 1 --decay 58 --sustain 0 --release 14
x set-pitch --voice body --slide-to 500 --over 55

# --- pin ----------------------------------------------------------------------
# The metallic CLICK of the pin coming out of the lattice node — the steel in the cue. A short
# square with a little FM for the inharmonic clank, sweeping up and out of the way fast.
x add-voice --name pin --wave square --freq 880 --gain -16 --start 2 --dur 45
x set-envelope --voice pin --env pluck
x add-fm --voice pin --carrier 1 --modulator 2.4 --index 3
x set-pitch --voice pin --slide-to 1320 --over 40

# --- scrape -------------------------------------------------------------------
# The part SLIDING free of the node: a short band of noise whose band sweeps UP and out, the
# same lifting gesture as the two tuned voices. It is what keeps the cue a clack rather than a
# bell — texture across the middle of the decay instead of a bare ringing tone.
x add-voice --name scrape --wave noise --gain -18 --start 3 --dur 38
x set-envelope --voice scrape --env pluck
x add-filter --voice scrape --type bandpass --cutoff 1600 --sweep-to 2900 --over 36 --resonance 1.8

# --- tick ---------------------------------------------------------------------
# The dry CONTACT tick: a couple of frames of highpassed noise, all snap and no substance.
x add-voice --name tick --wave noise --gain -15 --start 0 --dur 22
x set-envelope --voice tick --env pluck
x add-filter --voice tick --type highpass --cutoff 3200 --resonance 1.2

# --- master -------------------------------------------------------------------
# A highpass keeps the cue off the low end entirely (that register belongs to `place`,
# `placed` and `collapse`), and a very small room stops it sounding pasted on. Dry by design.
x add-filter --bus master --type highpass --cutoff 240 --resonance 0.7
x add-reverb --bus master --size 0.12 --mix 0.05

x render
echo "wrote $HERE/delete.wav"
