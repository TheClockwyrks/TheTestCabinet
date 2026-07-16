#!/usr/bin/env bash
# Coil — produce the game's AUDIO with the on-PATH audio tools (specs/assets.md §Audio,
# specs/flow.md §Audio). Everything here is PURE SYNTH: in this run image the baked
# `sfx-sample` pack and the `music` instrument bank are EMPTY, so every SFX is authored
# with `sfx-synth` (oscillator/noise voices) and the music bed uses `music`
# synth-waveform tracks only (`define-track --instrument sine|triangle|saw|square` —
# never a bank instrument name).
#
# Produces, under assets/audio/:
#   eat.wav  combo.wav  death.wav        (sfx-synth)
#   music.wav (+ music.mid)              (music)
#
# Cues (specs/flow.md): eat = short bright blip on a pellet eaten; combo = a
# brighter/higher blip when the combo multiplier M rises; death = a distinct
# descending tone on a fatal collision; music = a low-key looping background bed.
#
# Usage:  bash scripts/gen-audio.sh    (sfx-synth/music must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir.
for tool in sfx-synth music; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
    [ -x "$REL/$tool" ] || { echo "$tool not found on PATH or in $REL" >&2; exit 1; }
    export PATH="$REL:$PATH"
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUD="$ROOT/assets/audio"
mkdir -p "$AUD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- sfx-synth helpers --------------------------------------------------------
# newsfx <channels> <max_ms> <out.wav> : seed a fresh synth run (empty op log).
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 4242, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- music helpers ------------------------------------------------------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 4242, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# =================================== EAT ======================================
# Pellet-eaten blip: a short, bright, friendly "bip" — a triangle body that ticks
# UP in pitch (a quick satisfying pop) with a crisp bright transient on top. Fast
# pluck decay so it stays out of the way; plays once per pellet.
newsfx mono 180 "$AUD/eat.wav"
x add-voice --name body --wave triangle --freq 660 --gain -4 --start 0 --dur 130
x set-envelope --voice body --env pluck
x set-pitch --voice body --slide-to 990 --over 70
x add-voice --name tick --wave square --freq 1320 --gain -14 --start 0 --dur 40
x set-envelope --voice tick --env pluck
x add-voice --name spark --wave noise --gain -20 --start 0 --dur 22
x set-envelope --voice spark --env pluck
x add-filter --voice spark --type highpass --cutoff 4200 --resonance 1.0
x render

# ================================== COMBO =====================================
# Combo-up cue (M rises): the same family as EAT but clearly BRIGHTER and HIGHER —
# a rising two-tone chirp (saw lead an octave up over the eat blip, gliding up)
# with a shiny square sparkle. Reads as "level up". Plays when the multiplier rises.
newsfx mono 220 "$AUD/combo.wav"
x add-voice --name lead --wave saw --freq 1046 --gain -6 --start 0 --dur 160
x set-envelope --voice lead --env pluck
x set-pitch --voice lead --slide-to 1568 --over 120
x add-voice --name harm --wave triangle --freq 1318 --gain -8 --start 40 --dur 150
x set-envelope --voice harm --env pluck
x set-pitch --voice harm --slide-to 1976 --over 110
x add-voice --name sparkle --wave square --freq 2637 --gain -16 --start 0 --dur 50
x set-envelope --voice sparkle --env pluck
x add-reverb --bus master --size 0.25 --mix 0.12
x render

# ================================== DEATH =====================================
# Snake-dies sound: a distinct DESCENDING tone — a saw lead sliding down from high
# to low over the whole clip, doubled by a square that drops with it, tailed by a
# low triangle THUD, with a touch of grit. Unmistakably "you died", falling all the
# way down. Plays once on a fatal collision.
newsfx mono 700 "$AUD/death.wav"
x add-voice --name fall --wave saw --freq 880 --gain -5 --start 0 --dur 560
x set-envelope --voice fall --env linear
x set-pitch --voice fall --slide-to 110 --over 540
x add-voice --name sub --wave square --freq 440 --gain -9 --start 0 --dur 560
x set-envelope --voice sub --env linear
x set-pitch --voice sub --slide-to 70 --over 540
x add-voice --name thud --wave triangle --freq 90 --gain -4 --start 470 --dur 220
x set-envelope --voice thud --env pluck
x set-pitch --voice thud --slide-to 55 --over 200
x add-distortion --bus master --drive 1.2
x add-reverb --bus master --size 0.3 --mix 0.14
x render

# ================================== MUSIC =====================================
# Low-key background BED on SYNTH-WAVEFORM tracks only. A calm, unobtrusive A-minor
# loop that sits under the neon grid: a triangle SUB-BASS holds the low root, a sine
# PAD lays soft chords, and a sparse square PLUCK traces a gentle pentatonic figure.
# 2 bars at 96 BPM = 8 beats = exactly 5000 ms, so max_duration_ms == the loop length
# and note durations fill it exactly — the seam stays clean for looping. `music`
# emits both music.wav (the played asset) and music.mid (portable score).
newmusic 5000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 96
m set-time-signature --num 4 --den 4
m define-track --name sub   --instrument triangle
m define-track --name pad   --instrument sine
m define-track --name pluck --instrument square
m set-track-fx --track sub   --gain -6  --reverb 0.18 --env swell
m set-track-fx --track pad   --gain -13 --reverb 0.45 --env swell --pan 0.0
m set-track-fx --track pluck --gain -16 --reverb 0.4  --env pluck --pan 0.15

# Sub-bass: A1 for the first bar, F1 for the second (Am -> F), four beats each.
m add-note --track sub --pitch A1 --t 0 --dur 4 --velocity 80
m add-note --track sub --pitch F1 --t 4 --dur 4 --velocity 78

# Sine pad — soft chords above the drone: Am (A2 C3 E3), then F (F2 A2 C3).
m add-note --track pad --pitch A2 --t 0 --dur 4 --velocity 46
m add-note --track pad --pitch C3 --t 0 --dur 4 --velocity 42
m add-note --track pad --pitch E3 --t 0 --dur 4 --velocity 40
m add-note --track pad --pitch F2 --t 4 --dur 4 --velocity 46
m add-note --track pad --pitch A2 --t 4 --dur 4 --velocity 42
m add-note --track pad --pitch C3 --t 4 --dur 4 --velocity 40

# Sparse square pluck — a gentle A-minor-pentatonic figure, ending before the seam.
m add-note --track pluck --pitch A3 --t 0 --dur 1 --velocity 54
m add-note --track pluck --pitch C4 --t 1 --dur 1 --velocity 50
m add-note --track pluck --pitch E4 --t 2 --dur 1 --velocity 52
m add-note --track pluck --pitch D4 --t 3 --dur 1 --velocity 48
m add-note --track pluck --pitch C4 --t 4 --dur 1 --velocity 52
m add-note --track pluck --pitch A3 --t 5 --dur 1 --velocity 50
m add-note --track pluck --pitch E4 --t 6 --dur 1 --velocity 48
m add-note --track pluck --pitch C4 --t 7 --dur 1 --velocity 46
m render

echo "produced coil audio under $AUD:"
ls -la "$AUD"
