#!/usr/bin/env bash
# Gantry — `complete`: the site cleared. A short RISING AFFIRMATIVE figure.
#
# The cue fires once, at the end of a cleared run, so it is the payoff read: brighter and
# longer than any edit clack, but still short — about a second, ringing out to silence.
#
# Character follows the yard: this is a construction site, not a fairy chime, so the figure
# is a bright METAL-EDGED fanfare rather than a soft bell. A low sine THUMP grounds it (the
# yard's weight), a saw SWOOP rises into the first note (the lift completing), and a
# four-note MAJOR ARPEGGIO climbs C5 - G5 - C6 - E6 with a lightly FM'd bell over the top
# so the tone carries a hint of struck steel. Delay + reverb let it ring out and settle.
#
# Pure synth: the baked sample pack and instrument bank are empty on this machine, so every
# voice here is an oscillator or noise voice of `sfx-synth`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if ! command -v sfx-synth >/dev/null 2>&1; then
  export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
fi
command -v sfx-synth >/dev/null 2>&1 || { echo "sfx-synth not found on PATH" >&2; exit 1; }

CFG="$HERE/sfx-synth.config.json"
cat > "$CFG" <<JSON
{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": 1300, "seed": 7,
  "actions": "$HERE/actions.json", "preview": "$HERE/preview.png", "wav": "$HERE/complete.wav" }
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

sfx-synth init --config "$CFG" >/dev/null

# --- the ground under the fanfare -------------------------------------------------------
# A short low sine thump on the downbeat: the yard's weight, so the cue is felt as well as
# heard. Dropped in pitch and gone inside 200 ms — it must not muddy the climb above it.
x add-voice --name thump --wave sine --freq 131 --gain -9.5 --start 0 --dur 170
x set-envelope --voice thump --env punch
x set-pitch --voice thump --slide-to 78 --over 170

# --- the run-up --------------------------------------------------------------------------
# A quiet saw glissando sweeping UP into the first note: the whole figure's rising gesture
# announced before the arpeggio takes over. Swell in, gone by the time note two lands.
x add-voice --name swoop --wave saw --freq 200 --gain -17.5 --start 0 --dur 150
x set-envelope --voice swoop --env swell
x set-pitch --voice swoop --slide-to 520 --over 140

# --- the rising figure -------------------------------------------------------------------
# C5 - G5 - C6 - E6: a major arpeggio climbing, each step a little brighter and panned a
# little further right, so the figure visibly (and audibly) ascends. Plucks, so each step
# rings and decays under the next rather than piling up.
x add-voice --name n1 --wave sine     --freq 523  --gain -6   --start 0   --dur 300 --pan -0.22
x set-envelope --voice n1 --attack 1 --decay 80 --sustain 0.18 --release 240
x add-voice --name n2 --wave sine     --freq 784  --gain -5   --start 110 --dur 320 --pan -0.07
x set-envelope --voice n2 --attack 1 --decay 90 --sustain 0.20 --release 230
x add-voice --name n3 --wave triangle --freq 1047 --gain -3.5 --start 220 --dur 380 --pan 0.08
x set-envelope --voice n3 --env pluck
x add-voice --name n4 --wave triangle --freq 1319 --gain -2   --start 330 --dur 560 --pan 0.22
x set-envelope --voice n4 --env pluck

# --- the struck-steel top ----------------------------------------------------------------
# A lightly FM'd sine over the last two steps: an inharmonic partial that reads as struck
# metal, keeping the fanfare in the construction yard instead of a music box.
x add-voice --name bell --wave sine --freq 2093 --gain -11.5 --start 330 --dur 460 --pan 0.0
x set-envelope --voice bell --env pluck
x add-fm --voice bell --carrier 1 --modulator 2.4 --index 3

# --- the room -----------------------------------------------------------------------------
# A short delay tuned to the arpeggio's step (110 ms) so the echoes fall in time with the
# climb rather than smearing it, then a modest hall so the last note rings out and settles.
x add-delay --bus master --time 110 --feedback 0.28 --mix 0.2
x add-reverb --bus master --size 0.5 --mix 0.2

x render
echo "wrote $HERE/complete.wav"
