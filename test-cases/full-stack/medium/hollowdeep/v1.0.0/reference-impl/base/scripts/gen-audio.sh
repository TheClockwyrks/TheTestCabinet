#!/usr/bin/env bash
# Hollowdeep — produce the colony's AUDIO with the on-PATH audio tools (specs/assets.md §Audio,
# ASSETS.md §Audio). Everything here is PURE SYNTH: in this run image the baked `sfx-sample`
# pack and the `music` instrument bank are EMPTY, so every SFX is authored with `sfx-synth`
# (oscillator/noise voices) and the music bed uses `music` synth-waveform tracks only
# (`define-track --instrument sine|triangle|saw|square` — never a bank instrument name).
#
# Produces, under assets/audio/:
#   dig.wav  build.wav  alarm.wav  machine.wav        (sfx-synth)
#   music.wav (+ music.mid)                           (music)
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

# ================================== DIG =======================================
# Pick/impact cue on a mined tile: a short bright noise BURST (the pick striking
# grit) highpass-filtered down, plus a low triangle THUNK that drops in pitch for
# the tile giving way, and a lowpassed CHUFF of dislodged dirt. Fast decay.
# Plays once each time a tile is mined.
newsfx mono 360 "$AUD/dig.wav"
x add-voice --name burst --wave noise    --gain -4  --start 0 --dur 55
x set-envelope --voice burst --env pluck
x add-filter --voice burst --type highpass --cutoff 2200 --sweep-to 900 --over 55 --resonance 1.1
x add-voice --name thunk --wave triangle --freq 165 --gain -3  --start 0 --dur 150
x set-envelope --voice thunk --env pluck
x set-pitch --voice thunk --slide-to 80 --over 130
x add-voice --name chuff --wave noise    --gain -11 --start 10 --dur 110
x set-envelope --voice chuff --env pluck
x add-filter --voice chuff --type lowpass --cutoff 1000 --resonance 0.9
x add-distortion --bus master --drive 1.2
x render

# ================================= BUILD ======================================
# Build/place cue on a completed build: a two-tone metal CLUNK — a square knock
# gliding down over a triangle body — topped by a tiny highpassed CLICK transient
# of the piece snapping into place. Reads as "set in place". Plays on a build done.
newsfx mono 460 "$AUD/build.wav"
x add-voice --name click --wave noise    --gain -12 --start 0 --dur 24
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 3400 --resonance 1.0
x add-voice --name clunk --wave square   --freq 300 --gain -6  --start 0 --dur 150
x set-envelope --voice clunk --env pluck
x set-pitch --voice clunk --slide-to 190 --over 130
x add-voice --name body  --wave triangle --freq 150 --gain -4  --start 0 --dur 200
x set-envelope --voice body --env pluck
x set-pitch --voice body --slide-to 120 --over 170
x add-reverb --bus master --size 0.3 --mix 0.12
x render

# ================================= ALARM ======================================
# Low-oxygen / starving alarm: an urgent repeating warble (~1 s) — a saw+square
# two-tone klaxon pulsed in gated bursts with a fast vibrato, over a low saw sub
# that swells. Deliberately uneasy. Plays when oxygen goes critical or the colony
# is starving.
newsfx stereo 1100 "$AUD/alarm.wav"
alarm_pulse() { # <start> <pan>
  local s="$1" p="$2"
  x add-voice --name "sq_$s" --wave square --freq 620 --gain -6  --start "$s" --dur 200 --pan "$p"
  x set-envelope --voice "sq_$s" --env gate
  x add-vibrato --voice "sq_$s" --rate 11 --depth 0.5
  x add-voice --name "sw_$s" --wave saw    --freq 470 --gain -11 --start "$s" --dur 200 --pan "$p"
  x set-envelope --voice "sw_$s" --env gate
  x add-vibrato --voice "sw_$s" --rate 11 --depth 0.5
}
alarm_pulse 0    -0.25
alarm_pulse 280   0.25
alarm_pulse 560  -0.25
alarm_pulse 840   0.25
x add-voice --name sub --wave saw --freq 155 --gain -12 --start 0 --dur 1080
x set-envelope --voice sub --env swell
x add-vibrato --voice sub --rate 6 --depth 0.3
x add-filter --voice sub --type lowpass --cutoff 900 --resonance 1.3
x add-distortion --bus master --drive 1.3
x add-reverb --bus master --size 0.4 --mix 0.16
x render

# ================================ MACHINE =====================================
# Soft machine hum LOOP: a low sine drone with a slow LFO (vibrato) plus a quiet
# octave triangle, and a faint bandpassed noise of moving air. The LFO makes an
# integer number of cycles over the clip (1.5 Hz × 4 s = 6) and the fades are kept
# short so the loop seam is soft/seamless. Looped under a running machine.
newsfx stereo 4000 "$AUD/machine.wav"
x add-voice --name hum   --wave sine     --freq 60  --gain -12 --start 0 --dur 4000
x set-envelope --voice hum --attack 200 --decay 0 --sustain 1 --release 200
x add-vibrato --voice hum --rate 1.5 --depth 0.14
x add-voice --name hum2  --wave triangle --freq 120 --gain -19 --start 0 --dur 4000
x set-envelope --voice hum2 --attack 250 --decay 0 --sustain 1 --release 250
x add-vibrato --voice hum2 --rate 3.0 --depth 0.08
x add-voice --name air   --wave noise    --gain -24 --start 0 --dur 4000 --pan 0.2
x set-envelope --voice air --attack 300 --decay 0 --sustain 1 --release 300
x add-filter --voice air --type bandpass --cutoff 520 --resonance 2.4
x add-filter --bus master --type lowpass --cutoff 1600 --resonance 0.7
x render

# ================================== MUSIC =====================================
# Ambient underground BED on SYNTH-WAVEFORM tracks only. A slow, low, atmospheric
# D-minor loop for the deep colony: a triangle SUB-BASS drone holds the deep roots
# (D1..Bb0..C1..A0), a sine PAD lays soft minor chords above it, and a sparse saw
# MOTIF traces a lonely descending line — the whole thing quiet and cavernous.
# `music` emits both music.wav (the played asset) and music.mid (portable score).
newmusic 24000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 60
m set-time-signature --num 4 --den 4
m define-track --name sub  --instrument triangle
m define-track --name pad  --instrument sine
m define-track --name motif --instrument saw
m set-track-fx --track sub   --gain -5  --reverb 0.25 --env swell
m set-track-fx --track pad   --gain -10 --reverb 0.5  --env swell --pan 0.0
m set-track-fx --track motif --gain -9  --reverb 0.6  --env pluck --pan 0.2

# Sub-bass drone (deep roots): D1 .. Bb0 .. C1 .. A0, six beats each (one per bar).
m add-note --track sub --pitch D1  --t 0  --dur 6 --velocity 92
m add-note --track sub --pitch Bb0 --t 6  --dur 6 --velocity 88
m add-note --track sub --pitch C1  --t 12 --dur 6 --velocity 90
m add-note --track sub --pitch A0  --t 18 --dur 6 --velocity 94

# Sine pad — soft minor chords above the drone: Dm, Bb, C, Am.
m add-note --track pad --pitch D3 --t 0  --dur 6 --velocity 58
m add-note --track pad --pitch F3 --t 0  --dur 6 --velocity 54
m add-note --track pad --pitch A3 --t 0  --dur 6 --velocity 52
m add-note --track pad --pitch Bb2 --t 6 --dur 6 --velocity 60
m add-note --track pad --pitch D3 --t 6  --dur 6 --velocity 54
m add-note --track pad --pitch F3 --t 6  --dur 6 --velocity 52
m add-note --track pad --pitch C3 --t 12 --dur 6 --velocity 58
m add-note --track pad --pitch E3 --t 12 --dur 6 --velocity 54
m add-note --track pad --pitch G3 --t 12 --dur 6 --velocity 52
m add-note --track pad --pitch A2 --t 18 --dur 6 --velocity 60
m add-note --track pad --pitch C3 --t 18 --dur 6 --velocity 54
m add-note --track pad --pitch E3 --t 18 --dur 6 --velocity 52

# Sparse saw motif — a lonely descending line drifting over the drone.
m add-note --track motif --pitch A4 --t 2  --dur 2 --velocity 66
m add-note --track motif --pitch F4 --t 5  --dur 1 --velocity 62
m add-note --track motif --pitch D4 --t 8  --dur 2 --velocity 68
m add-note --track motif --pitch Bb3 --t 12 --dur 2 --velocity 64
m add-note --track motif --pitch C4 --t 15 --dur 1 --velocity 66
m add-note --track motif --pitch A3 --t 17 --dur 2 --velocity 62
m add-note --track motif --pitch E4 --t 20 --dur 1 --velocity 70
m add-note --track motif --pitch D4 --t 22 --dur 2 --velocity 66
m render

echo "produced hollowdeep audio under $AUD:"
ls -la "$AUD"
