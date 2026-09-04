#!/usr/bin/env bash
# Gantry — the `fail` cue (specs/assets.md: "sfx-synth ... The run ended badly").
#
# THE READ: a short FALLING figure, FLAT and FINAL. Not a crash (that is `collapse`,
# which plays alongside it on a structural failure) and not an alarm — this is the
# yard's verdict: three stepped tones walking DOWN, each one lower and deader than
# the last, landing on a damped sub thud that stops. Flat = no vibrato, no shimmer,
# no swell; every tone is a gated block at the same level, so nothing "performs".
# Final = it ends, dry and abrupt, with only a hair of room behind it.
#
# PURE SYNTH: the baked sample pack is empty on this machine, so everything here is
# sfx-synth oscillator/noise voices.
#
# Usage: bash build.sh   (sfx-synth on PATH, or under $CARGO_TARGET_DIR/release)
set -euo pipefail

if ! command -v sfx-synth >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-synth" ] || { echo "sfx-synth not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
CFG="$DIR/sfx-synth.config.json"

cat > "$CFG" <<JSON
{
  "sample_rate": 44100,
  "channels": "mono",
  "max_duration_ms": 800,
  "seed": 1337,
  "actions": "$DIR/fail.actions.json",
  "preview": "$DIR/preview.png",
  "wav": "$DIR/fail.wav"
}
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

sfx-synth init --config "$CFG" >/dev/null

# --- the falling figure -------------------------------------------------------
# Three stepped tones descending a minor triad downward (C4 -> Ab3 -> Eb3 -> the
# floor). Each is a SQUARE body (hollow, machine-like, no sweetness) doubled by a
# quieter TRIANGLE to give it a little wood so it is not purely buzzy. `gate`
# envelopes: short rise, flat held block, short fall — dead level, no expression.
step() { # <name> <start> <dur> <freq> <gain-sq> <gain-tri>
  x add-voice --name "sq_$1" --wave square   --freq "$4" --gain "$5" --start "$2" --dur "$3"
  x set-envelope --voice "sq_$1" --env gate
  x add-voice --name "tr_$1" --wave triangle --freq "$4" --gain "$6" --start "$2" --dur "$3"
  x set-envelope --voice "tr_$1" --env gate
}
step a   0 125 262 -5 -8   # C4
step b 155 125 208 -5 -8   # Ab3
step c 310 125 156 -5 -8   # Eb3

# The fourth step does not hold: it SAGS. Same voice pair, but pitched down under
# itself over its whole length — the figure giving out rather than resolving.
x add-voice --name sag --wave square --freq 131 --gain -4 --start 465 --dur 150
x set-envelope --voice sag --attack 3 --decay 55 --sustain 0.42 --release 85
x set-pitch --voice sag --slide-to 98 --over 230
x add-voice --name sagtri --wave triangle --freq 131 --gain -7 --start 465 --dur 150
x set-envelope --voice sagtri --attack 3 --decay 55 --sustain 0.42 --release 85
x set-pitch --voice sagtri --slide-to 98 --over 230

# --- the floor ----------------------------------------------------------------
# A sine SUB under the LANDING only: the weight arriving and then going out of it.
# It starts with the sagging step so the two blocks before it stay clean and flat —
# an overlapping sub beat against the 156 Hz step and made that one waver.
x add-voice --name sub --wave sine --freq 98 --gain -2 --start 465 --dur 210
x set-envelope --voice sub --env punch
x set-pitch --voice sub --slide-to 38 --over 250

# A single dull, lowpassed noise THUD on the last step — the dead stop, no ring.
x add-voice --name thud --wave noise --gain -7 --start 465 --dur 80
x set-envelope --voice thud --env pluck
x add-filter --voice thud --type lowpass --cutoff 620 --resonance 1.0

# --- the master: flat, dry, closed --------------------------------------------
# Lowpassed hard so nothing sparkles (flat, not bright); a whisper of distortion
# for machine grit; a compressor to hold every step at the same height; a very
# small, short room so it reads as a yard and not a hall — it must not tail off.
x add-distortion --bus master --drive 1.15
x add-filter --bus master --type lowpass --cutoff 2400 --resonance 0.7
x add-compressor --bus master --threshold -9 --ratio 3
# Same cut as creak had: let the reverb tail finish inside the file rather than be
# chopped at 4.3% of peak.
x add-voice --name tailroom --wave sine --freq 98 --gain -72 --start 620 --dur 160
x add-reverb --bus master --size 0.16 --mix 0.06

x render
echo "wrote $DIR/fail.wav"
