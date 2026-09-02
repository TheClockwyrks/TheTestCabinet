#!/usr/bin/env bash
# Gantry — motor.wav: the drive turning, produced with `sfx-synth`.
#
# specs/ui.md: `motor` "loops while a run is in progress and any axis's rate is
# nonzero". It is the one cue that repeats without end, and a run can be watched
# at four-times speed, so it is built for two things above all: it must WRAP
# WITHOUT A CLICK, and it must not nag.
#
# How the seamless wrap is achieved, measured rather than hoped for:
#   * The loop is exactly LOOP_MS long and every rate in it — voice frequency,
#     vibrato rate, FM modulator, ring modulator — completes a WHOLE NUMBER of
#     cycles in that time, so the waveform at the end is the waveform at the
#     start.
#   * Every voice is a sine or a triangle: continuous waveforms. A saw or a
#     square carries a hard edge that would land on the wrap.
#   * Every voice is held FLAT for the whole loop (attack 0, sustain 1,
#     release 0), so there is no envelope step at the seam either.
#   * NO FILTER, NO COMPRESSOR, NO REVERB, NO DELAY anywhere. Each of those
#     carries state: a filter starts from rest, so the head of the file is a
#     ramp-up that does not meet the tail (measured: a bus lowpass alone puts a
#     0.67 step on the seam), and a reverb or delay tail would spill past the end
#     and collide with the head. The only bus effect is soft-clip distortion,
#     which is memoryless and so cannot break the wrap — and it is what supplies
#     the harmonic grit a filter-free build would otherwise want a saw for.
#
#   bash build.sh                                  -> motor.wav, the shipped loop
#   DUR=4000 WAV=probe/x2.wav bash build.sh        -> a 2x render, for looptest.js
#   NONOISE=1 ...                                  -> the tonal layers alone
set -euo pipefail
export PATH="/cargo-target/the-test-cabinet/release:$PATH"
cd "$(dirname "$0")"

DUR="${DUR:-2000}"                     # the loop length in ms
WAV="${WAV:-motor.wav}"
PREVIEW="${PREVIEW:-preview.png}"
LOG="${LOG:-log.json}"
CFG="${CFG:-sfx-synth.config.json}"
mkdir -p "$(dirname "$WAV")"

cat > "$CFG" <<JSON
{ "sample_rate": 44100, "channels": "mono", "max_duration_ms": $DUR, "seed": 7,
  "actions": "$LOG", "preview": "$PREVIEW", "wav": "$WAV" }
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }
sfx-synth init --config "$CFG" >/dev/null

# TRIM shifts every voice together, which is how the file's peak is set: there is
# no master gain operation, and the saturator's drive changes colour more than level.
TRIM="${TRIM:--4}"
g() { awk -v a="$1" -v t="$TRIM" 'BEGIN{printf "%.2f", a + t}'; }

# Held flat for the whole loop: no attack, no decay, no release.
hold() { x set-envelope --voice "$1" --attack 0 --decay 0 --sustain 1 --release 0; }

# --- the drive ----------------------------------------------------------------
# SUB — the armature turning: the low hum felt through the deck rather than heard.
# 55 Hz = 110 whole cycles in the loop.
x add-voice --name sub --wave sine --freq 55 --gain "$(g -15)" --start 0 --dur "$DUR"
hold sub
# HUM — its octave, which gives the drive a pitch instead of a rumble.
x add-voice --name hum --wave sine --freq 110 --gain "$(g -13)" --start 0 --dur "$DUR"
hold hum
# BUZZ — the winding's harmonic buzz sitting on the third harmonic, with a little
# FM filling the spectrum between the partials so it reads as iron and not as an
# organ. The slow shallow wander (three cycles per loop) keeps the drone from
# sitting perfectly still — a dead-still drone is what fatigues at 4x.
x add-voice --name buzz --wave triangle --freq 165 --gain "$(g -10)" --start 0 --dur "$DUR"
hold buzz
x add-fm --voice buzz --carrier 1 --modulator 2 --index 1.1
x add-vibrato --voice buzz --rate 1.5 --depth 0.12

# --- the gear train -----------------------------------------------------------
# GEAR — teeth meshing. A triangle chopped by a 30 Hz ring modulator: 60 amplitude
# swings a second, the reduction gear's tooth rate, and 60 whole cycles per loop.
x add-voice --name gear --wave triangle --freq 220 --gain "$(g -11)" --start 0 --dur "$DUR"
hold gear
x add-ringmod --voice gear --freq 30
# LASH — a second, slower mesh a fifth up, chopped at 20 Hz and drifting against
# the first. Two tooth rates beating against each other is what stops a loop this
# short from reading as one repeating sample.
x add-voice --name lash --wave triangle --freq 330 --gain "$(g -15)" --start 0 --dur "$DUR"
hold lash
x add-ringmod --voice lash --freq 20
x add-vibrato --voice lash --rate 0.5 --depth 0.12
# WHINE — the thin metallic edge of the gear train, well down in the mix. FM makes
# it inharmonic; the slow ring modulator keeps it from sitting still.
x add-voice --name whine --wave triangle --freq 440 --gain "$(g -17)" --start 0 --dur "$DUR"
hold whine
x add-fm --voice whine --carrier 1 --modulator 3 --index 1.4
x add-ringmod --voice whine --freq 15
# TOOTH — the tick of the teeth themselves, an octave above the whine and chopped
# at 60 Hz. It is what carries the gear texture on a small speaker, where nothing
# below 200 Hz survives; it is kept thin so it never turns into a whistle.
x add-voice --name tooth --wave triangle --freq 880 --gain "$(g -25)" --start 0 --dur "$DUR"
hold tooth
x add-fm --voice tooth --carrier 1 --modulator 2 --index 2.5
x add-ringmod --voice tooth --freq 60

# BEARING — a quiet broadband bed: the bearing and the air around it. Noise is the
# one layer that cannot be made periodic, so it is kept far down: white noise
# already steps every sample, so its wrap is indistinguishable from its own grain.
if [ -z "${NONOISE:-}" ]; then
  x add-voice --name bearing --wave noise --gain "$(g -24)" --start 0 --dur "$DUR"
  hold bearing
fi

# --- the bus ------------------------------------------------------------------
# Soft clip for machine grit and to glue the layers into one machine. Memoryless,
# so the wrap survives it.
x add-distortion --bus master --drive 1.6
x render
