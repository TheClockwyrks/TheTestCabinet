#!/usr/bin/env bash
# Gantry — creak.wav: steel complaining under load (specs/assets.md, specs/ui.md).
#
# Cue: a member's utilisation crosses CREAK_THRESHOLD (0.8) — the WARNING that the
# structure is close to letting go. It is gated to at most one per CREAK_COOLDOWN
# (0.5) run-clock seconds, so at four-times watch speed it can retrigger every
# ~125 ms of wall clock: the sound has to be short enough not to pile into a drone,
# yet long enough to read as a strained GROAN rather than a tick. ~600 ms, swelling
# in and sagging away, so overlapping repeats layer as continuous straining.
#
# The baked sample pack is EMPTY on this machine (`sfx-sample list-samples` → "no
# samples"), so this is authored entirely from sfx-sample's oscillator/noise VOICES
# and its EFFECT chain — the same constraint the Arc Foundry case works under.
#
# The sound is stick-slip friction in loaded steel:
#   groan  — a low inharmonic saw, ring-modulated off the harmonic series, rising in
#            pitch as the member tightens (rising = tension building = warning)
#   strain — a metallic upper partial, FM-detuned and wobbling, the "complaint"
#   grind  — bandpassed noise chopped by a slow ring-mod: the rasp of steel slipping
#   load   — a low sine swelling underneath: the weight that is causing it
#
# Usage: bash build.sh    (sfx-sample must be on PATH)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
command -v sfx-sample >/dev/null 2>&1 || export PATH="/cargo-target/the-test-cabinet/release:$PATH"
command -v sfx-sample >/dev/null 2>&1 || { echo "sfx-sample not on PATH" >&2; exit 1; }

CFG="$HERE/sfx-sample.config.json"
cat > "$CFG" <<JSON
{
  "sample_rate": 44100,
  "channels": "mono",
  "max_duration_ms": 700,
  "seed": 7,
  "sample_pack": "combat-core@0.1.0",
  "actions": "log.json",
  "preview": "preview.png",
  "wav": "creak.wav"
}
JSON

x() { sfx-sample "$@" --config "$CFG" >/dev/null; }

cd "$HERE"
sfx-sample init --config "$CFG" >/dev/null

# --- groan: the body of the complaint -----------------------------------------
# A saw low in the mids, ring-modulated at 41 Hz so its partials fall off the
# harmonic series (steel does not ring in tune under strain), sliding UP as the
# member tightens, with a slow deep wobble for the stick-slip judder. A resonant
# bandpass opening upward keeps it a groan rather than a buzz.
x add-voice --name groan --wave saw --freq 138 --gain 0.5 --start 0 --dur 380
x set-envelope --voice groan --attack 95 --decay 130 --sustain 0.6 --release 180
x set-pitch --voice groan --slide-to 178 --over 380
x add-vibrato --voice groan --rate 6.5 --depth 0.9
x add-ringmod --voice groan --freq 41
x add-filter --voice groan --type bandpass --cutoff 420 --sweep-to 720 --over 380 --resonance 3.2

# --- strain: the upper metallic partial ---------------------------------------
# The part of a creak that makes you look: a squarish partial FM-detuned to an
# inharmonic ratio, wobbling wider than the groan and climbing with it.
x add-voice --name strain --wave square --freq 470 --gain -6.5 --start 45 --dur 340
x set-envelope --voice strain --attack 110 --decay 110 --sustain 0.55 --release 170
x set-pitch --voice strain --slide-to 620 --over 340
x add-vibrato --voice strain --rate 5.2 --depth 1.4
x add-fm --voice strain --carrier 1 --modulator 1.87 --index 3.5
x add-filter --voice strain --type bandpass --cutoff 900 --sweep-to 1450 --over 340 --resonance 2.8

# --- grind: the friction rasp -------------------------------------------------
# Noise through a tight bandpass sweeping up, chopped by a 27 Hz ring-mod so it
# stutters instead of hissing — steel slipping in fits against steel.
x add-voice --name grind --wave noise --gain -6.5 --start 12 --dur 390
x set-envelope --voice grind --attack 70 --decay 140 --sustain 0.5 --release 190
x add-ringmod --voice grind --freq 33
x add-filter --voice grind --type bandpass --cutoff 1600 --sweep-to 2600 --over 380 --resonance 3.0

# --- load: the weight underneath ----------------------------------------------
x add-voice --name load --wave sine --freq 62 --gain -3.5 --start 0 --dur 420
x set-envelope --voice load --env swell

# --- master -------------------------------------------------------------------
# Soft-clip grit, a lowpass so nothing is shrill, a compressor to hold the body
# steady under the wobble, and a small yard-sized room.
x add-distortion --bus master --drive 1.3
x add-filter --bus master --type lowpass --cutoff 4200 --resonance 0.8
x add-compressor --bus master --threshold -9 --ratio 2.0
# `render` trims the file to the last voice's end, which was cutting the reverb tail off
# at 4.4% of peak — a faint tick every time a cue that repeats under load fires. A
# near-silent hold voice past the last audible one lets the tail decay inside the file.
x add-voice --name tailroom --wave sine --freq 62 --gain -72 --start 400 --dur 260
x add-reverb --bus master --size 0.35 --mix 0.13
x render

echo "produced: $HERE/creak.wav"
