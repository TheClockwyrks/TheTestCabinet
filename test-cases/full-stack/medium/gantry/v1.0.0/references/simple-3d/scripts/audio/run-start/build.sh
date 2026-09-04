#!/usr/bin/env bash
# Gantry — the `run-start` cue (specs/ui.md "a run starts"; specs/assets.md
# "the yard's signal that the tape is about to run").
#
# Pure `sfx-synth`: an oscillator-built TWO-TONE YARD KLAXON. Not an alarm — a
# PURPOSEFUL "stand clear, the machine is moving" signal, the kind bolted to a
# gantry leg. Two brassy blasts a fourth apart, LOW then HIGH: the rising pair
# reads as "about to run" rather than "something is wrong".
#
# Each blast is built the way a real air horn is: two slightly DETUNED reeds
# (square + saw) beating against each other, a sine an octave down giving the
# horn its chest, and a brief filtered-noise AIR chuff at the mouth as the
# valve opens. A gate envelope holds each blast flat and lets it stop clean.
# Master soft-clip gives the brass its edge, a lowpass keeps it from turning
# shrill, and a small yard reverb sets it outdoors against concrete.
#
# Usage: bash build.sh   (sfx-synth on PATH, or in the cargo release dir)
set -euo pipefail

command -v sfx-synth >/dev/null 2>&1 || \
  export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
command -v sfx-synth >/dev/null 2>&1 || { echo "sfx-synth not found" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HERE/sfx-synth.config.json"

cat > "$CFG" <<JSON
{ "sample_rate": 44100, "channels": "mono", "max_duration_ms": 1500, "seed": 7,
  "actions": "$HERE/run-start.actions.json", "preview": "$HERE/preview.png",
  "wav": "$HERE/run-start.wav" }
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# shape_env <voice> <gate|fall>
shape_env() {
  if [ "$2" = "fall" ]; then
    x set-envelope --voice "$1" --attack 14 --decay 70 --sustain 0.88 --release 260
  else
    x set-envelope --voice "$1" --env gate
  fi
}

sfx-synth init --config "$CFG" >/dev/null

# blast <tag> <start ms> <dur ms> <freq Hz> <reed dB> <body dB> <shape>
# One horn blast: reed pair (detuned square + saw), sub-octave chest, air chuff.
# <shape> is `gate` (flat blast, clean stop) or `fall` (flat blast that releases
# into the yard — used on the last blast so the cue decays instead of being cut).
blast() {
  local n="$1" s="$2" d="$3" f="$4" rg="$5" bg="$6" shape="$7"
  local f2 fb
  f2=$(awk "BEGIN{printf \"%.2f\", $f*1.0075}")   # second reed, ~13 cents sharp
  fb=$(awk "BEGIN{printf \"%.2f\", $f/2}")        # chest, an octave down

  # Reed 1 — the square body of the horn, the note you hear.
  x add-voice --name "reed1_$n" --wave square --freq "$f" --gain "$rg" --start "$s" --dur "$d"
  shape_env "reed1_$n" "$shape"
  x add-vibrato --voice "reed1_$n" --rate 5.5 --depth 0.14
  x add-filter --voice "reed1_$n" --type lowpass --cutoff 2600 --resonance 1.0

  # Reed 2 — detuned saw beating against reed 1; the horn's rasp and thickness.
  x add-voice --name "reed2_$n" --wave saw --freq "$f2" --gain "$(awk "BEGIN{print $rg-4}")" --start "$s" --dur "$d"
  shape_env "reed2_$n" "$shape"
  x add-vibrato --voice "reed2_$n" --rate 5.1 --depth 0.18
  x add-filter --voice "reed2_$n" --type lowpass --cutoff 2200 --resonance 1.2

  # Chest — a sub-octave sine so the blast has weight across the yard.
  x add-voice --name "body_$n" --wave sine --freq "$fb" --gain "$bg" --start "$s" --dur "$d"
  shape_env "body_$n" "$shape"

  # Air — the valve opening: a short band-limited chuff on the leading edge.
  x add-voice --name "air_$n" --wave noise --gain "$(awk "BEGIN{print $rg-9}")" --start "$s" --dur 55
  x set-envelope --voice "air_$n" --env pluck
  x add-filter --voice "air_$n" --type bandpass --cutoff 2000 --resonance 1.6
}

#            tag  start  dur   freq  reed  body  shape
blast lo       0    330   262    -4    -8   gate   # C4 — the low call, stopped clean
blast hi     415    440   349    -3    -7   fall   # F4 — the answer, released into the yard

# Yard tail — an inaudible hold (-72 dB) past the last blast so the reverb has
# room to fall to silence inside the file instead of being cut off at the edge.
x add-voice --name tail --wave sine --freq 60 --gain -72 --start 1110 --dur 210
x set-envelope --voice tail --env swell

# Master — brass edge, a lid on the top so it never turns shrill, and the yard.
x add-distortion --bus master --drive 1.4
x add-filter --bus master --type lowpass --cutoff 4600 --resonance 0.8
x add-compressor --bus master --threshold -8 --ratio 2.6
x add-reverb --bus master --size 0.34 --mix 0.12

sfx-synth render --config "$CFG"
