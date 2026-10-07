#!/usr/bin/env bash
# Gantry — `place` cue: a part seating on the lattice. A short, DRY CLACK.
#
# Plays on every structure edit that places a member, the ring, or a counterweight
# (specs/ui.md), so it fires many times a second while the player builds: it must be
# SHORT, dry, and low-fatigue — a single seated tap, no ring-out, no long tail.
#
# The read is steel-into-a-socket: a low seating THUNK (the member bottoming into the
# node), a hard inharmonic CLACK (steel meeting steel, FM + a touch of ringmod so it is
# a clack and not a musical tone), and a tight highpassed CONTACT tick on top. Everything
# decays inside ~100 ms; the master reverb is only a hair of room so it is dry.
set -euo pipefail

command -v sfx-synth >/dev/null 2>&1 || export PATH="/cargo-target/the-test-cabinet/release:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HERE/sfx-synth.config.json"
cat > "$CFG" <<JSON
{ "sample_rate": 44100, "channels": "mono", "max_duration_ms": 200, "seed": 7,
  "actions": "$HERE/actions.json", "preview": "$HERE/preview.png", "wav": "$HERE/place.wav" }
JSON

x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

sfx-synth init --config "$CFG" >/dev/null

# THUNK — the member bottoming into its node. Low, fast, no boom.
x add-voice --name thunk --wave sine --freq 260 --gain -9 --start 0 --dur 60
x set-envelope --voice thunk --env pluck
x set-pitch --voice thunk --slide-to 130 --over 50

# CLACK — steel on steel. FM + ringmod make it inharmonic (a clack, not a note).
x add-voice --name clack --wave triangle --freq 1150 --gain -5 --start 0 --dur 90
x set-envelope --voice clack --env pluck
x add-fm --voice clack --carrier 1 --modulator 3.4 --index 5
x set-pitch --voice clack --slide-to 780 --over 60
x add-ringmod --voice clack --freq 210

# TAIL — a whisper of damped body so the clack decays to silence instead of being cut.
x add-voice --name tail --wave triangle --freq 620 --gain -22 --start 4 --dur 120
x set-envelope --voice tail --env pluck
x add-filter --voice tail --type lowpass --cutoff 2200 --resonance 0.8

# CONTACT — the dry tick of the two faces meeting.
x add-voice --name contact --wave noise --gain -7 --start 0 --dur 30
x set-envelope --voice contact --env pluck
x add-filter --voice contact --type highpass --cutoff 2800 --resonance 1.1

# Master: keep the low end out of the way, a hair of room only.
x add-filter --bus master --type highpass --cutoff 150 --resonance 0.7
x add-reverb --bus master --size 0.15 --mix 0.05

x render
