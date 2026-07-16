#!/usr/bin/env bash
# Holdfast — produce the colony's AUDIO with the on-PATH audio tools (specs/assets.md §Audio,
# ASSETS.md §4). Everything here is PURE SYNTH: in this run image the baked `sfx-sample` pack
# and the `music` instrument bank are EMPTY, so every SFX is authored with `sfx-synth`
# (oscillator/noise voices) and the music bed uses `music` synth-waveform tracks only
# (`define-track --instrument sine|triangle|saw|square` — never a bank instrument name).
#
# Produces, under assets/audio/:
#   gunshot.wav  hit.wav  build.wav  alarm.wav  ambient.wav       (sfx-synth)
#   music.wav (+ music.mid)                                       (music)
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
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 7331, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- music helpers ------------------------------------------------------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 7331, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ================================ GUNSHOT =====================================
# Sharp percussive shot: a low sine BOOM that snaps down in pitch, a bright noise
# CRACK transient, a square mechanical SNAP, and a decaying filtered TAIL. Master
# soft-clip + short room. Plays on every shot fired.
newsfx mono 500 "$AUD/gunshot.wav"
x add-voice --name boom  --wave sine   --freq 150 --gain -2  --start 0  --dur 240
x set-envelope --voice boom --env punch
x set-pitch --voice boom --slide-to 45 --over 200
x add-voice --name crack --wave noise  --gain -4  --start 0  --dur 60
x set-envelope --voice crack --env pluck
x add-filter --voice crack --type highpass --cutoff 1800 --resonance 1.2
x add-voice --name snap  --wave square --freq 320 --gain -11 --start 0  --dur 40
x set-envelope --voice snap --env pluck
x add-voice --name tail  --wave noise  --gain -13 --start 25 --dur 190
x set-envelope --voice tail --env linear
x add-filter --voice tail --type lowpass --cutoff 2400 --sweep-to 550 --over 190
x add-distortion --bus master --drive 1.5
x add-reverb --bus master --size 0.35 --mix 0.14
x render

# ================================== HIT =======================================
# Short blunt impact: a pitched-down sine THUD + a soft triangle body + a lowpassed
# noise chuff of dirt/debris. Plays when a shot lands.
newsfx mono 400 "$AUD/hit.wav"
x add-voice --name thud --wave sine     --freq 130 --gain -3  --start 0 --dur 150
x set-envelope --voice thud --env pluck
x set-pitch --voice thud --slide-to 65 --over 130
x add-voice --name body --wave triangle --freq 95  --gain -8  --start 0 --dur 130
x set-envelope --voice body --env pluck
x add-voice --name dirt --wave noise     --gain -10 --start 0 --dur 100
x set-envelope --voice dirt --env pluck
x add-filter --voice dirt --type lowpass --cutoff 1100 --resonance 0.9
x add-distortion --bus master --drive 1.2
x render

# ================================= BUILD ======================================
# Woody place/complete clunk: a triangle KNOCK gliding down + a sine WOOD body + a
# tiny highpassed CLICK, then a second lower knock for a "set in place" double-tap.
newsfx mono 520 "$AUD/build.wav"
x add-voice --name knock  --wave triangle --freq 220 --gain -3  --start 0   --dur 160
x set-envelope --voice knock --env pluck
x set-pitch --voice knock --slide-to 150 --over 140
x add-voice --name wood   --wave sine     --freq 135 --gain -6  --start 0   --dur 190
x set-envelope --voice wood --env pluck
x add-voice --name click  --wave noise    --gain -12 --start 0   --dur 28
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 3200 --resonance 1.0
x add-voice --name knock2 --wave triangle --freq 175 --gain -7  --start 150 --dur 150
x set-envelope --voice knock2 --env pluck
x set-pitch --voice knock2 --slide-to 130 --over 130
x add-reverb --bus master --size 0.3 --mix 0.12
x render

# ================================= ALARM ======================================
# Rising two-tone raid alarm: two square+saw blasts that sweep upward, then a longer
# swelling climb with vibrato. Reads as an urgent, escalating klaxon. Plays when a
# raid is announced.
newsfx stereo 1400 "$AUD/alarm.wav"
alarm_blast() { # <start> <pan>
  local s="$1" p="$2"
  x add-voice --name "sq_$s" --wave square --freq 440 --gain -6  --start "$s" --dur 300 --pan "$p"
  x set-envelope --voice "sq_$s" --env gate
  x set-pitch --voice "sq_$s" --slide-to 660 --over 280
  x add-voice --name "sw_$s" --wave saw    --freq 220 --gain -12 --start "$s" --dur 300 --pan "$p"
  x set-envelope --voice "sw_$s" --env gate
  x set-pitch --voice "sw_$s" --slide-to 330 --over 280
}
alarm_blast 0   -0.3
alarm_blast 350  0.3
x add-voice --name climb --wave square --freq 520 --gain -5 --start 720 --dur 560
x set-envelope --voice climb --env swell
x set-pitch --voice climb --slide-to 900 --over 500
x add-vibrato --voice climb --rate 9 --depth 0.4
x add-voice --name climbsub --wave saw --freq 260 --gain -13 --start 720 --dur 560
x set-envelope --voice climbsub --env swell
x set-pitch --voice climbsub --slide-to 450 --over 500
x add-distortion --bus master --drive 1.3
x add-reverb --bus master --size 0.45 --mix 0.2
x render

# ================================ AMBIENT =====================================
# Soft looping frontier bed: a low sine turret HUM with a slow vibrato, a quieter
# octave triangle, and two beds of lowpass/bandpass filtered WIND that drift. Long
# attack + release fades keep the loop seam soft. Looped under the colony.
newsfx stereo 4000 "$AUD/ambient.wav"
x add-voice --name hum   --wave sine     --freq 55  --gain -11 --start 0 --dur 4000
x set-envelope --voice hum --attack 500 --decay 0 --sustain 1 --release 500
x add-vibrato --voice hum --rate 0.3 --depth 0.12
x add-voice --name hum2  --wave triangle --freq 110 --gain -20 --start 0 --dur 4000
x set-envelope --voice hum2 --attack 700 --decay 0 --sustain 1 --release 700
x add-voice --name wind  --wave noise     --gain -15 --start 0 --dur 4000 --pan 0.35
x set-envelope --voice wind --attack 600 --decay 0 --sustain 1 --release 600
x add-filter --voice wind --type lowpass --cutoff 480 --sweep-to 900 --over 2000 --resonance 1.4
x add-voice --name wind2 --wave noise     --gain -21 --start 0 --dur 4000 --pan -0.35
x set-envelope --voice wind2 --attack 600 --decay 0 --sustain 1 --release 600
x add-filter --voice wind2 --type bandpass --cutoff 700 --resonance 2.2
x add-reverb --bus master --size 0.7 --mix 0.3
x render

# ================================== MUSIC =====================================
# Ambient / tension music bed on SYNTH-WAVEFORM tracks only. A slow A-minor frontier
# atmosphere: a triangle bass drone + a sine pad hold the calm first half; at the
# midpoint a square tension ostinato enters and the harmony darkens (F -> E), while a
# sparse saw lead traces a lonely line throughout. `music` emits both music.wav (the
# played asset) and music.mid (portable companion score).
newmusic 22000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 72
m set-time-signature --num 4 --den 4
m define-track --name bass    --instrument triangle
m define-track --name pad     --instrument sine
m define-track --name lead    --instrument saw
m define-track --name tension --instrument square
m set-track-fx --track bass    --gain -4  --reverb 0.2 --env swell
m set-track-fx --track pad     --gain -9  --reverb 0.45 --env swell --pan 0.0
m set-track-fx --track lead    --gain -7  --reverb 0.5  --env pluck --pan 0.25
m set-track-fx --track tension --gain -11 --reverb 0.3  --env gate  --pan -0.25

# Bass drone (low roots): A2 .. A2 .. F2 .. E2
m add-note --track bass --pitch A2 --t 0  --dur 6 --velocity 90
m add-note --track bass --pitch A2 --t 6  --dur 6 --velocity 86
m add-note --track bass --pitch F2 --t 12 --dur 6 --velocity 92
m add-note --track bass --pitch E2 --t 18 --dur 6 --velocity 96

# Pad chords — calm A-minor, then a darker F -> E(minor) for the tension half.
m add-note --track pad --pitch A3 --t 0  --dur 6 --velocity 64
m add-note --track pad --pitch C4 --t 0  --dur 6 --velocity 60
m add-note --track pad --pitch E4 --t 0  --dur 6 --velocity 58
m add-note --track pad --pitch A3 --t 6  --dur 6 --velocity 64
m add-note --track pad --pitch C4 --t 6  --dur 6 --velocity 60
m add-note --track pad --pitch E4 --t 6  --dur 6 --velocity 58
m add-note --track pad --pitch F3 --t 12 --dur 6 --velocity 70
m add-note --track pad --pitch A3 --t 12 --dur 6 --velocity 66
m add-note --track pad --pitch C4 --t 12 --dur 6 --velocity 62
m add-note --track pad --pitch E3 --t 18 --dur 6 --velocity 74
m add-note --track pad --pitch G3 --t 18 --dur 6 --velocity 70
m add-note --track pad --pitch B3 --t 18 --dur 6 --velocity 66

# Sparse saw lead — a lonely frontier line.
m add-note --track lead --pitch E4 --t 2  --dur 2 --velocity 70
m add-note --track lead --pitch A4 --t 5  --dur 1 --velocity 66
m add-note --track lead --pitch C5 --t 9  --dur 2 --velocity 72
m add-note --track lead --pitch F4 --t 13 --dur 1 --velocity 74
m add-note --track lead --pitch A4 --t 15 --dur 1 --velocity 78
m add-note --track lead --pitch G4 --t 17 --dur 2 --velocity 80
m add-note --track lead --pitch B4 --t 20 --dur 1 --velocity 84
m add-note --track lead --pitch A4 --t 22 --dur 2 --velocity 82

# Tension ostinato — enters at the midpoint (raid-lands feel), low pulsing square.
m add-note --track tension --pitch E3 --t 12 --dur 1 --velocity 66
m add-note --track tension --pitch E3 --t 14 --dur 1 --velocity 70
m add-note --track tension --pitch F3 --t 16 --dur 1 --velocity 74
m add-note --track tension --pitch E3 --t 18 --dur 1 --velocity 78
m add-note --track tension --pitch E3 --t 20 --dur 1 --velocity 82
m add-note --track tension --pitch F3 --t 22 --dur 1 --velocity 86
m render

echo "produced holdfast audio under $AUD:"
ls -la "$AUD"
