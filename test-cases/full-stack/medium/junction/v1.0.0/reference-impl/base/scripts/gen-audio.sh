#!/usr/bin/env bash
# Junction — produce the city's AUDIO with the on-PATH audio tools (specs/assets.md §Audio,
# ASSETS.md §4). Everything here is PURE SYNTH: in this run image the baked `sfx-sample` pack
# and the `music` instrument bank are EMPTY, so every SFX is authored with `sfx-synth`
# (oscillator/noise voices) and the music bed uses `music` synth-waveform tracks only
# (`define-track --instrument sine|triangle|saw|square` — never a bank instrument name).
#
# Produces, under assets/audio/:
#   build.wav  chime.wav  alert.wav  hum.wav            (sfx-synth)
#   music.wav (+ music.mid)                             (music)
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

# ================================= BUILD ======================================
# Short, dry stamp/thunk played when the player lays a road, tile, or building. A
# triangle KNOCK gliding down for the wooden "stamp", a low sine THUMP body for the
# set-in-place weight, and a tiny highpassed CLICK transient for the contact. Almost
# no reverb — this is a crisp, dry placement cue.
newsfx mono 320 "$AUD/build.wav"
x add-voice --name knock --wave triangle --freq 240 --gain -3  --start 0 --dur 150
x set-envelope --voice knock --env pluck
x set-pitch --voice knock --slide-to 160 --over 130
x add-voice --name thump --wave sine     --freq 120 --gain -5  --start 0 --dur 170
x set-envelope --voice thump --env punch
x set-pitch --voice thump --slide-to 80 --over 150
x add-voice --name click --wave noise     --gain -12 --start 0 --dur 24
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 3200 --resonance 1.0
x add-reverb --bus master --size 0.22 --mix 0.07
x render

# ================================= CHIME ======================================
# Bright, brief notification — a milestone or a completed development. A rising
# three-note sine/triangle arpeggio (a warm major triad: C6 -> E6 -> G6) with a
# glassy pluck attack, sweetened by a feedback delay so it sparkles and rings out.
newsfx stereo 900 "$AUD/chime.wav"
x add-voice --name n1 --wave sine     --freq 1046 --gain -6 --start 0   --dur 220 --pan -0.15
x set-envelope --voice n1 --env pluck
x add-voice --name n2 --wave sine     --freq 1318 --gain -6 --start 90  --dur 240 --pan 0.05
x set-envelope --voice n2 --env pluck
x add-voice --name n3 --wave triangle --freq 1568 --gain -5 --start 180 --dur 380 --pan 0.2
x set-envelope --voice n3 --env pluck
x add-voice --name shimmer --wave sine --freq 2093 --gain -14 --start 180 --dur 360 --pan 0.0
x set-envelope --voice shimmer --env pluck
x add-delay --bus master --time 165 --feedback 0.32 --mix 0.28
x add-reverb --bus master --size 0.5 --mix 0.22
x render

# ================================= ALERT ======================================
# Tense, rasping trouble cue — budget/utility warning (losing money, near the debt
# limit, network over-drawn). A gritty square+saw two-tone that sags DOWNWARD (the
# "uh-oh" fall), driven through soft-clip distortion with a slow vibrato buzz, then a
# lower repeat for insistence. Reads urgent without being a full klaxon.
newsfx stereo 950 "$AUD/alert.wav"
alert_buzz() { # <start> <base> <to> <pan>
  local s="$1" b="$2" t="$3" p="$4"
  x add-voice --name "sq_$s" --wave square --freq "$b" --gain -6  --start "$s" --dur 320 --pan "$p"
  x set-envelope --voice "sq_$s" --env gate
  x set-pitch --voice "sq_$s" --slide-to "$t" --over 300
  x add-vibrato --voice "sq_$s" --rate 11 --depth 0.5
  x add-voice --name "sw_$s" --wave saw --freq "$b" --gain -13 --start "$s" --dur 320 --pan "$p"
  x set-envelope --voice "sw_$s" --env gate
  x set-pitch --voice "sw_$s" --slide-to "$t" --over 300
}
alert_buzz 0   440 330 -0.2
alert_buzz 420 330 247  0.2
x add-distortion --bus master --drive 1.6
x add-reverb --bus master --size 0.3 --mix 0.12
x render

# ================================== HUM =======================================
# Soft, loopable ambient CITY HUM bed, looped quietly under the map. A low sine
# power-grid drone with a very slow vibrato, a quieter octave triangle for warmth,
# and two beds of filtered NOISE — a lowpassed traffic wash that slowly drifts and a
# gentle bandpassed air layer, panned apart. Long attack/release fades keep the loop
# seam inaudible.
newsfx stereo 4000 "$AUD/hum.wav"
x add-voice --name grid  --wave sine     --freq 60  --gain -12 --start 0 --dur 4000
x set-envelope --voice grid --attack 600 --decay 0 --sustain 1 --release 600
x add-vibrato --voice grid --rate 0.25 --depth 0.1
x add-voice --name warm  --wave triangle --freq 120 --gain -21 --start 0 --dur 4000
x set-envelope --voice warm --attack 800 --decay 0 --sustain 1 --release 800
x add-voice --name traffic --wave noise   --gain -16 --start 0 --dur 4000 --pan 0.3
x set-envelope --voice traffic --attack 700 --decay 0 --sustain 1 --release 700
x add-filter --voice traffic --type lowpass --cutoff 420 --sweep-to 720 --over 2000 --resonance 1.3
x add-voice --name air   --wave noise     --gain -23 --start 0 --dur 4000 --pan -0.3
x set-envelope --voice air --attack 700 --decay 0 --sustain 1 --release 700
x add-filter --voice air --type bandpass --cutoff 650 --resonance 2.0
x add-reverb --bus master --size 0.7 --mix 0.28
x render

# ================================== MUSIC =====================================
# Calm, warm, low-key ambient CITY bed on SYNTH-WAVEFORM tracks only — the unobtrusive
# kind a builder plays for hours. A slow, bright C-major / F-major progression:
# C -> Am -> F -> G, a sine PAD holding the chords, a triangle BASS walking the roots,
# and a sparse saw MOTIF tracing a gentle melody over the top. `music` emits both
# music.wav (the played asset) and music.mid (portable companion score).
newmusic 24000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 66
m set-time-signature --num 4 --den 4
m define-track --name pad   --instrument sine
m define-track --name bass  --instrument triangle
m define-track --name motif --instrument saw
m set-track-fx --track pad   --gain -8  --reverb 0.5  --env swell --pan 0.0
m set-track-fx --track bass  --gain -5  --reverb 0.2  --env swell --pan 0.0
m set-track-fx --track motif --gain -9  --reverb 0.5  --env pluck --pan 0.2

# Bass — walking roots: C2 .. A2 .. F2 .. G2 (two bars each, 6 beats/chord).
m add-note --track bass --pitch C2 --t 0  --dur 6 --velocity 84
m add-note --track bass --pitch A2 --t 6  --dur 6 --velocity 80
m add-note --track bass --pitch F2 --t 12 --dur 6 --velocity 84
m add-note --track bass --pitch G2 --t 18 --dur 6 --velocity 82

# Pad — warm triads over the same progression: C  Am  F  G.
m add-note --track pad --pitch C4 --t 0  --dur 6 --velocity 60
m add-note --track pad --pitch E4 --t 0  --dur 6 --velocity 56
m add-note --track pad --pitch G4 --t 0  --dur 6 --velocity 54
m add-note --track pad --pitch A3 --t 6  --dur 6 --velocity 60
m add-note --track pad --pitch C4 --t 6  --dur 6 --velocity 56
m add-note --track pad --pitch E4 --t 6  --dur 6 --velocity 54
m add-note --track pad --pitch F3 --t 12 --dur 6 --velocity 62
m add-note --track pad --pitch A3 --t 12 --dur 6 --velocity 58
m add-note --track pad --pitch C4 --t 12 --dur 6 --velocity 56
m add-note --track pad --pitch G3 --t 18 --dur 6 --velocity 62
m add-note --track pad --pitch B3 --t 18 --dur 6 --velocity 58
m add-note --track pad --pitch D4 --t 18 --dur 6 --velocity 56

# Motif — a sparse, gentle saw line drifting over the chords.
m add-note --track motif --pitch G4 --t 1  --dur 2 --velocity 66
m add-note --track motif --pitch E4 --t 4  --dur 2 --velocity 62
m add-note --track motif --pitch C5 --t 7  --dur 2 --velocity 70
m add-note --track motif --pitch A4 --t 10 --dur 1 --velocity 66
m add-note --track motif --pitch C5 --t 12 --dur 2 --velocity 68
m add-note --track motif --pitch F4 --t 15 --dur 1 --velocity 64
m add-note --track motif --pitch A4 --t 17 --dur 2 --velocity 70
m add-note --track motif --pitch G4 --t 20 --dur 1 --velocity 68
m add-note --track motif --pitch D5 --t 22 --dur 2 --velocity 72
m render

echo "produced junction audio under $AUD:"
ls -la "$AUD"
