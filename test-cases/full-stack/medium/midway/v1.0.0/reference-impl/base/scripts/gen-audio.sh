#!/usr/bin/env bash
# Midway — produce the park's audio with the on-PATH audio tools (specs/assets.md §Audio,
# ASSETS.md §4).
#
# Environment constraint (ASSETS.md): the baked `sfx-sample` sample pack and the `music`
# instrument bank are EMPTY in this image, so — exactly as the valence reference did —
# EVERY sound effect is authored with `sfx-synth` (oscillator/noise voices + envelopes /
# filters / FX) and the music bed is authored with `music` using SYNTH-WAVEFORM tracks
# (`--instrument sine|square|saw|triangle`, never a bank-instrument name). `sfx-sample`
# is not used. `music` still emits both the played `.wav` and the portable `.mid`.
#
# Produces, under assets/audio/:
#   coin.wav   — bright two-blip purchase/coin cue           (sfx-synth)
#   ding.wav   — bell-like ride-start ding                   (sfx-synth)
#   alarm.wav  — harsh two-tone low-cash / ride-broken buzzer(sfx-synth)
#   crowd.wav  — soft loopable crowd/park hum bed            (sfx-synth)
#   music.wav  — cheerful bouncy carnival loop               (music, synth waveforms)
#   music.mid  — portable .mid companion of the bed          (music)
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth/music must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir.
if ! command -v sfx-synth >/dev/null 2>&1 || ! command -v music >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-synth" ] && [ -x "$REL/music" ] || {
    echo "sfx-synth/music not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/audio"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# sfxcfg <wav> <max_ms> [channels] [seed] : write a seeded sfx-synth config into $CFG.
CFG="$TMP/sfx.json"
sfxcfg() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": %s, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "${3:-stereo}" "$2" "${4:-777001}" "$TMP/sfx.log.json" "$TMP/sfx.prev.png" "$1" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# ============================ coin.wav — bright two-blip purchase =============
# Two quick ascending square blips (a "cha-ching"), each a fast pluck, with a touch of
# master reverb so it rings in the park rather than clicks.
sfxcfg "$OUT/coin.wav" 420
x add-voice   --name blip1 --wave square --freq 784  --gain -3 --start 0   --dur 90   # G5
x set-envelope --voice blip1 --attack 1 --decay 70 --sustain 0.0 --release 30
x add-voice   --name blip2 --wave square --freq 1175 --gain -3 --start 95  --dur 140  # D6
x set-envelope --voice blip2 --attack 1 --decay 110 --sustain 0.0 --release 40
x add-voice   --name shine --wave triangle --freq 2349 --gain -12 --start 95 --dur 120 # D7 sparkle
x set-envelope --voice shine --env pluck
x add-filter  --bus master --type highpass --cutoff 300
x add-reverb  --bus master --mix 0.18 --size 0.4
x render

# ============================ ding.wav — bell-like ride start =================
# A struck bell: an FM-shaped sine partial stack, slow bell decay, generous reverb tail.
sfxcfg "$OUT/ding.wav" 1300
x add-voice   --name bell --wave sine --freq 880 --gain -2 --start 0 --dur 900   # A5
x add-fm      --voice bell --modulator 2.76 --index 5
x set-envelope --voice bell --attack 1 --decay 900 --sustain 0.0 --release 260
x add-voice   --name part --wave sine --freq 1760 --gain -12 --start 0 --dur 500  # A6 shimmer
x set-envelope --voice part --env pluck
x add-voice   --name low  --wave sine --freq 440 --gain -9 --start 0 --dur 700    # A4 body
x set-envelope --voice low --env pluck
x add-reverb  --bus master --mix 0.32 --size 0.7
x render

# ============================ alarm.wav — harsh two-tone buzzer ===============
# Two alternating buzzy square tones (a warning klaxon), distorted and band-limited so it
# grabs attention for low-cash / broken-ride. Two cycles so the two-tone pattern reads.
sfxcfg "$OUT/alarm.wav" 1200
x add-voice   --name hi1 --wave square --freq 440 --gain -4 --start 0   --dur 200
x set-envelope --voice hi1 --env gate
x add-voice   --name lo1 --wave square --freq 330 --gain -4 --start 220 --dur 200
x set-envelope --voice lo1 --env gate
x add-voice   --name hi2 --wave square --freq 440 --gain -4 --start 460 --dur 200
x set-envelope --voice hi2 --env gate
x add-voice   --name lo2 --wave square --freq 330 --gain -4 --start 680 --dur 220
x set-envelope --voice lo2 --env gate
x add-distortion --bus master --drive 6
x add-filter  --bus master --type bandpass --cutoff 700 --resonance 1.5
x render

# ============================ crowd.wav — soft loopable hum ===================
# A gentle park hum for looping under play: filtered noise (a wash of distant chatter) +
# a low steady tone, both held flat with a swell in/out so the loop seam is smooth. Mono
# for a centered ambient bed.
sfxcfg "$OUT/crowd.wav" 4000 mono 424242
x add-voice   --name wash --wave noise --gain -13 --start 0 --dur 4000
x set-envelope --voice wash --attack 700 --decay 0 --sustain 1.0 --release 700
x add-filter  --voice wash --type lowpass --cutoff 700 --resonance 0.7
x add-voice   --name hum  --wave sine --freq 110 --gain -16 --start 0 --dur 4000
x set-envelope --voice hum --attack 700 --decay 0 --sustain 1.0 --release 700
x add-voice   --name air  --wave triangle --freq 220 --gain -22 --start 0 --dur 4000
x set-envelope --voice air --attack 900 --decay 0 --sustain 1.0 --release 900
x add-filter  --bus master --type lowpass --cutoff 1400
x render

# ============================ music.wav / music.mid — carnival bed ============
# A bright, bouncy fairground loop (ASSETS.md): a `square` lead, a `triangle` oom-pah
# bass, a `sine` sub reinforcement, and a `saw` counter-melody arpeggio — all SYNTH
# WAVEFORM tracks (the bank is empty). 8 bars in C major, ~132 bpm, loops under the park.
MCFG="$TMP/music.json"
printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": 20000, "seed": 990011, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
  "$TMP/music.log.json" "$TMP/music.prev.png" "$OUT/music.wav" "$OUT/music.mid" > "$MCFG"
m() { music "$@" --config "$MCFG" >/dev/null; }

m init
m set-tempo --bpm 132
m set-time-signature --num 4 --den 4

m define-track --name lead    --instrument square
m define-track --name counter --instrument saw
m define-track --name bass    --instrument triangle
m define-track --name sub     --instrument sine

m set-track-fx --track lead    --gain -3  --pan 0.15 --reverb 0.18 --env pluck
m set-track-fx --track counter --gain -11 --pan -0.35 --reverb 0.15 --env pluck
m set-track-fx --track bass    --gain -5  --pan 0.0 --env pluck
m set-track-fx --track sub     --gain -12 --pan 0.0 --env pluck

# Per-bar chords (8 bars): C G Am F C G F G.  Bass root per bar, plus its fifth.
roots=(C2 G2 A2 F2 C2 G2 F2 G2)
fifths=(G2 D3 E3 C3 G2 D3 C3 D3)
# Oom-pah triangle bass + sine sub double the root on the downbeats.
for bar in 0 1 2 3 4 5 6 7; do
  b=$((bar*4))
  m add-note --track bass --pitch "${roots[$bar]}"  --t $((b+0)) --dur 1 --velocity 105
  m add-note --track bass --pitch "${fifths[$bar]}" --t $((b+1)) --dur 1 --velocity 80
  m add-note --track bass --pitch "${roots[$bar]}"  --t $((b+2)) --dur 1 --velocity 100
  m add-note --track bass --pitch "${fifths[$bar]}" --t $((b+3)) --dur 1 --velocity 80
  m add-note --track sub  --pitch "${roots[$bar]}"  --t $((b+0)) --dur 2 --velocity 90
  m add-note --track sub  --pitch "${roots[$bar]}"  --t $((b+2)) --dur 2 --velocity 80
done

# Square lead melody — a catchy chord-tone line, one bar of quarter notes each.
lead=(\
 "E4 G4 C5 G4" \
 "D4 G4 B4 G4" \
 "E4 A4 C5 A4" \
 "F4 A4 C5 A4" \
 "G4 E4 C5 E4" \
 "B4 D5 G4 B4" \
 "A4 F4 C5 A4" \
 "D5 B4 G4 D4")
for bar in 0 1 2 3 4 5 6 7; do
  b=$((bar*4)); i=0
  for p in ${lead[$bar]}; do
    m add-note --track lead --pitch "$p" --t $((b+i)) --dur 1 --velocity 108
    i=$((i+1))
  done
done

# Saw counter-melody — busy eighth-note arpeggios of each chord (softer, panned left).
arp=(\
 "C4 E4 G4 E4 C4 E4 G4 E4" \
 "G3 B3 D4 B3 G3 B3 D4 B3" \
 "A3 C4 E4 C4 A3 C4 E4 C4" \
 "F3 A3 C4 A3 F3 A3 C4 A3" \
 "C4 E4 G4 E4 C4 E4 G4 E4" \
 "G3 B3 D4 B3 G3 B3 D4 B3" \
 "F3 A3 C4 A3 F3 A3 C4 A3" \
 "G3 B3 D4 B3 D4 B3 G3 B3")
for bar in 0 1 2 3 4 5 6 7; do
  b=$((bar*4)); i=0
  for p in ${arp[$bar]}; do
    # eighth notes: t advances by 0.5 beat
    t=$(awk "BEGIN{printf \"%.1f\", $b + $i*0.5}")
    m add-note --track counter --pitch "$p" --t "$t" --dur 0.5 --velocity 74
    i=$((i+1))
  done
done

m render

echo "produced Midway audio under $OUT:"
ls -la "$OUT"
