#!/usr/bin/env bash
# Gantry — break.wav (specs/assets.md "The sound"): "A member letting go: a hard snap."
# A hard SNAP with a METALLIC CRACK — sudden and loud, over in a quarter of a second.
#
# Authored entirely with sfx-sample's VOICE and EFFECT operations: the baked sample pack
# is empty on this machine (`sfx-sample list-samples` -> "no samples"), so there is no
# `add-sample` here — oscillator/noise voices plus filters, FM, ring modulation,
# distortion and a compressor do the work.
#
# The cue fires on a tick that breaks one or more members (specs/ui.md), so it can land
# several ticks running as a structure comes apart: it has to be SHORT and it must not
# smear into the next one. Envelope shape aimed for:
#   0-8 ms    a near-instant crack (broadband noise, highpassed hard)
#   8-90 ms   the steel body letting go (low sine punch, pitch collapsing)
#   40-220 ms an inharmonic metallic ring dying away fast
# Nothing sustains; the file ends in silence.
set -euo pipefail

if ! command -v sfx-sample >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-sample" ] || { echo "sfx-sample not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
CFG="$HERE/sfx-sample.config.json"

cat > "$CFG" <<'JSON'
{
  "sample_rate": 44100,
  "channels": "mono",
  "max_duration_ms": 300,
  "seed": 7,
  "sample_pack": "combat-core@0.1.0",
  "actions": "log.json",
  "preview": "preview.png",
  "wav": "break.wav"
}
JSON

x() { sfx-sample "$@" --config "$CFG" >/dev/null; }

sfx-sample init --config "$CFG" >/dev/null

# --- the CRACK: the fracture itself. Broadband noise, highpassed into the top end so it
# reads as a splitting report rather than a puff of air. Instant attack, gone in ~30 ms.
x add-voice --name crack --wave noise --gain -13 --start 0 --dur 34
x set-envelope --voice crack --env pluck
x add-filter --voice crack --type highpass --cutoff 3200 --sweep-to 7000 --over 32 --resonance 1.5

# --- the SNAP body: the member's tension releasing. A low sine with a hard knee, pitch
# collapsing fast. It is the weight UNDER the snap, not the sound itself, so it is kept
# short and well below the crack -- a break is a snap, not a boom.
x add-voice --name body --wave sine --gain -12 --freq 240 --start 0 --dur 60
x set-envelope --voice body --env pluck
x set-pitch --voice body --slide-to 90 --over 50

# --- the METALLIC CRACK: steel-on-steel, the loudest voice after the transient. A square
# carrier under inharmonic FM (ratio 3.1) and ring modulation, swept down fast so it
# cracks rather than sings.
x add-voice --name clang --wave square --gain -6 --freq 1450 --start 0 --dur 120
x set-envelope --voice clang --env pluck
x add-fm --voice clang --carrier 1 --modulator 3.1 --index 7
x add-ringmod --voice clang --freq 173
x set-pitch --voice clang --slide-to 540 --over 100

# --- a second, higher metallic partial, detuned against the first so the two beat against
# each other: the clangorous, inharmonic edge that says STEEL rather than wood or stone.
x add-voice --name shard --wave square --gain -13 --freq 3260 --start 2 --dur 90
x set-envelope --voice shard --env pluck
x add-fm --voice shard --carrier 1 --modulator 1.77 --index 4
x add-ringmod --voice shard --freq 611
x set-pitch --voice shard --slide-to 2100 --over 80

# --- the RING: what is left humming in the broken steel. Triangle + FM through a resonant
# bandpass, on a pluck so it decays exponentially to nothing -- no shelf, no held tail --
# and is inaudible well before the file ends, so nothing clicks and consecutive breaks on
# consecutive ticks do not smear into each other.
x add-voice --name ring --wave triangle --gain -7.5 --freq 2360 --start 5 --dur 190
x set-envelope --voice ring --env pluck
x add-fm --voice ring --carrier 1 --modulator 2.41 --index 3
x add-filter --voice ring --type bandpass --cutoff 2900 --sweep-to 1600 --over 180 --resonance 2.4

# --- bus: soft-clip drive for the hardness, a fast compressor so the whole thing reads
# LOUD at a sane peak, and a very small room so it lands in the yard without a tail.
x add-distortion --bus master --drive 1.5
x add-compressor --bus master --threshold -18 --ratio 4
x add-reverb --bus master --size 0.16 --mix 0.07

sfx-sample render --config "$CFG" >/dev/null
echo "wrote $HERE/break.wav"
