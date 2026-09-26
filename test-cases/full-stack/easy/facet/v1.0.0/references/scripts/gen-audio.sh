#!/usr/bin/env bash
# Facet — produce every sound the game plays, with the on-PATH audio tools
# (specs/assets.md → "Audio").
#
# Produces, under assets/audio/ (19 .wav + 2 .mid):
#   sfx-synth   select swap refuse land flaw cut levelup gameover     (8 cues)
#   sfx-synth   chain-1 … chain-8, the MAX_MULTIPLIER-rung ladder     (8 tones)
#   sfx-sample  shatter, the glass body layered under the clear cue   (1)
#   music       title (+ .mid) and play (+ .mid)                      (2 pieces)
#
# The `clear` cue is the chain ladder and the shatter body played together: step
# N of a chain sounds chain-min(N, 8) over shatter, so a long chain climbs the
# ladder and holds on the top rung while the glass keeps its weight.
#
# The palettes come from the packs this case declares in `[audio] packs`, not from
# anything synthesized here:
#   sfx-sample  reads the `combat-core` pack, whose glass and impact material
#               (debris_glass, clang_metal, impact_metal_dry, snap_transient) is
#               what the shatter body is built from. It carries no tuned
#               material, so every pitched cue above is synthesized instead.
#   music       reads the `gm-lite` bank, and every track below names one of its
#               real struck instruments — music_box, glockenspiel, vibraphone,
#               marimba, grand_piano — for the bright, glassy character the
#               board wants. `music` renders a plain synth voice for any name the
#               bank does not carry, which is silence-adjacent rather than an
#               error, so these names are checked against the bank.
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth, sfx-sample and music must be on
#         PATH, or built under $CARGO_TARGET_DIR/{debug,release}). In a run
#         container the declared packs are staged where the tools read them. On a
#         host, fetch an audio store with scripts/fetch-audio-store.sh and point
#         TCAB_AUDIO_DIR at it.
set -euo pipefail

# The store's default location, used only when TCAB_AUDIO_DIR names none — a run
# container is staged with its packs and never takes this branch.
STORE="${TCAB_AUDIO_STORE:-${HOME:-}/.cache/tcab/audio-store}"
if [ -z "${TCAB_AUDIO_DIR:-}" ] && [ -d "$STORE/packs" ]; then
  export TCAB_AUDIO_DIR="$STORE"
fi

# Resolve the tools: prefer PATH, else the devcontainer's cargo target volume.
for tool in sfx-synth sfx-sample music; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    for d in "${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"/{release,debug}; do
      [ -x "$d/$tool" ] && export PATH="$d:$PATH" && break
    done
    command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found on PATH" >&2; exit 1; }
  fi
done

HERE="$(cd "$(dirname "$0")" && pwd)"
AUD="${1:-$HERE/../assets}/audio"
mkdir -p "$AUD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"
SEED=90210

SAMPLE_PACK='combat-core@0.1.0'
INSTRUMENT_BANK='gm-lite@0.1.0'

# --- sfx-synth ----------------------------------------------------------------
# newsfx <channels> <max_ms> <out.wav>
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": %s, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$SEED" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- sfx-sample ---------------------------------------------------------------
newsmp() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": %s, "sample_pack": "%s", "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$SEED" "$SAMPLE_PACK" "$TMP/smp.actions.json" "$TMP/smp.preview.png" "$3" > "$CFG"
  sfx-sample init --config "$CFG" >/dev/null
}
q() { sfx-sample "$@" --config "$CFG" >/dev/null; }

# --- music --------------------------------------------------------------------
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": %s, "instrument_bank": "%s", "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$SEED" "$INSTRUMENT_BANK" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }
# n <track> <pitch> <t-beats> <dur-beats> [velocity]
n() { m add-note --track "$1" --pitch "$2" --t "$3" --dur "$4" --velocity "${5:-100}"; }

# ================================= SELECT =====================================
# A cell is selected: light and mechanical. A tiny highpassed tick — the tweezers
# touching the stone — with one clean blip lifting behind it.
newsfx mono 130 "$AUD/select.wav"
x add-voice --name tick --wave noise --gain -12 --start 0 --dur 16
x set-envelope --voice tick --env pluck
x add-filter --voice tick --type highpass --cutoff 3800 --resonance 1.1
x add-voice --name blip --wave sine --freq 1180 --gain -8 --start 0 --dur 80
x set-envelope --voice blip --env pluck
x set-pitch --voice blip --slide-to 1480 --over 60
x add-voice --name air --wave triangle --freq 2360 --gain -18 --start 0 --dur 60
x set-envelope --voice air --env pluck
x render

# ================================== SWAP ======================================
# A swap is accepted: the same mechanical family as `select`, but two-part — the
# stones trading places, each seating with its own small knock.
newsfx mono 230 "$AUD/swap.wav"
for pair in "0 660 880 -10 -5" "96 880 990 -12 -7"; do
  read -r st f0 f1 kg sg <<<"$pair"
  x add-voice --name "k$st" --wave noise --gain "$kg" --start "$st" --dur 15
  x set-envelope --voice "k$st" --env pluck
  x add-filter --voice "k$st" --type highpass --cutoff 3000 --resonance 1.0
  x add-voice --name "s$st" --wave triangle --freq "$f0" --gain "$sg" --start "$st" --dur 100
  x set-envelope --voice "s$st" --env pluck
  x set-pitch --voice "s$st" --slide-to "$f1" --over 85
done
x add-reverb --bus master --size 0.22 --mix 0.10
x render

# ================================= REFUSE =====================================
# A swap is refused: a flat dead stop. Low, lowpassed, no tail and no pitch move
# to speak of — the board saying no and nothing more.
newsfx mono 200 "$AUD/refuse.wav"
x add-voice --name thud --wave square --freq 152 --gain -8 --start 0 --dur 95
x set-envelope --voice thud --env punch
x set-pitch --voice thud --slide-to 124 --over 70
x add-filter --voice thud --type lowpass --cutoff 700 --resonance 1.0
x add-voice --name dead --wave noise --gain -17 --start 0 --dur 42
x set-envelope --voice dead --env pluck
x add-filter --voice dead --type lowpass --cutoff 420 --resonance 0.8
x add-bitcrush --bus master --bits 7 --rate 11000
x render

# ================================== LAND ======================================
# A chain step's gems land after a long fall: a low settling knock. A column of
# stone arriving at the bottom of the board, so it is heavier and duller than
# `swap`'s little seating knock and carries no pitched blip at all — weight, not
# a note. It plays only when the step's longest fall was more than
# LAND_MIN_ROWS (2) rows, so it marks a real collapse rather than a nudge.
newsfx mono 260 "$AUD/land.wav"
x add-voice --name thump --wave sine --freq 116 --gain -6 --start 0 --dur 140
x set-envelope --voice thump --env punch
x set-pitch --voice thump --slide-to 74 --over 120
x add-voice --name grit --wave noise --gain -14 --start 0 --dur 55
x set-envelope --voice grit --env pluck
x add-filter --voice grit --type lowpass --cutoff 1500 --sweep-to 520 --over 55 --resonance 0.9
x add-voice --name settle --wave triangle --freq 232 --gain -16 --start 22 --dur 120
x set-envelope --voice settle --env pluck
x set-pitch --voice settle --slide-to 168 --over 100
x add-reverb --bus master --size 0.18 --mix 0.08
x render

# ================================== FLAW ======================================
# A gem reaches MAX_STRAIN: a dry crack. A hard noise transient swept down, a
# snapping square under it, and a short dull body — stone giving, not breaking.
newsfx mono 300 "$AUD/flaw.wav"
x add-voice --name crack --wave noise --gain -6 --start 0 --dur 34
x set-envelope --voice crack --env pluck
x add-filter --voice crack --type highpass --cutoff 2600 --sweep-to 1100 --over 34 --resonance 1.3
x add-voice --name snap --wave square --freq 900 --gain -12 --start 0 --dur 55
x set-envelope --voice snap --env pluck
x set-pitch --voice snap --slide-to 210 --over 45
x add-voice --name body --wave triangle --freq 320 --gain -13 --start 4 --dur 150
x set-envelope --voice body --env pluck
x set-pitch --voice body --slide-to 195 --over 130
x add-filter --voice body --type lowpass --cutoff 1800 --resonance 0.9
x add-distortion --bus master --drive 1.15
x render

# =================================== CUT ======================================
# A cut gem is created: bright and metallic. Two FM bells an octave apart over a
# struck transient, with enough room on them to ring — the one cue on the board
# that is allowed to sparkle.
newsfx stereo 800 "$AUD/cut.wav"
x add-voice --name strike --wave noise --gain -8 --start 0 --dur 18
x set-envelope --voice strike --env pluck
x add-filter --voice strike --type highpass --cutoff 5200 --resonance 1.2
x add-voice --name bell --wave sine --freq 1318 --gain -4 --start 0 --dur 620
x set-envelope --voice bell --env pluck
x add-fm --voice bell --modulator 2.4 --index 5.5
x add-voice --name bell2 --wave sine --freq 1976 --gain -10 --start 22 --dur 480 --pan 0.28
x set-envelope --voice bell2 --env pluck
x add-fm --voice bell2 --modulator 3.1 --index 3.8
x add-voice --name shimmer --wave triangle --freq 2637 --gain -16 --start 40 --dur 320 --pan -0.3
x set-envelope --voice shimmer --env pluck
x add-reverb --bus master --size 0.55 --mix 0.30
x render

# ================================= LEVEL UP ===================================
# A level is completed: it rises. Four struck tones climbing an A-minor triad to
# the octave, over a saw swell whose filter opens as they go.
newsfx stereo 1400 "$AUD/levelup.wav"
i=0
for step in "0 440 0.0" "120 554 0.15" "240 659 -0.15" "360 880 0.0"; do
  read -r st f pan <<<"$step"
  i=$((i + 1))
  x add-voice --name "t$i" --wave triangle --freq "$f" --gain -5 --start "$st" --dur 520 --pan "$pan"
  x set-envelope --voice "t$i" --env pluck
  x add-fm --voice "t$i" --modulator 2 --index 2.2
  x add-voice --name "h$i" --wave sine --freq "$((f * 2))" --gain -15 --start "$st" --dur 300 --pan "$pan"
  x set-envelope --voice "h$i" --env pluck
done
x add-voice --name swell --wave saw --freq 220 --gain -14 --start 0 --dur 820
x set-envelope --voice swell --env swell
x set-pitch --voice swell --slide-to 880 --over 760
x add-filter --voice swell --type lowpass --cutoff 700 --sweep-to 5200 --over 760 --resonance 1.4
x add-reverb --bus master --size 0.5 --mix 0.28
x render

# ================================= GAME OVER ==================================
# The round ends: it falls. The same four tones walked back down and slowed, over
# a sinking drone, with the master filter closing over the whole thing.
newsfx stereo 2200 "$AUD/gameover.wav"
i=0
for step in "0 440 0.0" "230 349 -0.15" "460 294 0.15" "690 220 0.0"; do
  read -r st f pan <<<"$step"
  i=$((i + 1))
  x add-voice --name "t$i" --wave triangle --freq "$f" --gain -5 --start "$st" --dur 760 --pan "$pan"
  x set-envelope --voice "t$i" --env pluck
  x add-fm --voice "t$i" --modulator 2 --index 1.6
  x add-voice --name "u$i" --wave sine --freq "$f" --gain -12 --start "$st" --dur 900 --pan "$pan"
  x set-envelope --voice "u$i" --env pluck
done
x add-voice --name drone --wave sine --freq 110 --gain -10 --start 0 --dur 1700
x set-envelope --voice drone --env swell
x set-pitch --voice drone --slide-to 82 --over 1500
x add-voice --name air --wave noise --gain -26 --start 400 --dur 1200
x set-envelope --voice air --env swell
x add-filter --voice air --type bandpass --cutoff 900 --sweep-to 300 --over 1200 --resonance 2.0
x add-filter --bus master --type lowpass --cutoff 6000 --sweep-to 900 --over 1900 --resonance 0.8
x add-reverb --bus master --size 0.62 --mix 0.34
x render

# ================================ CHAIN LADDER ================================
# MAX_MULTIPLIER (8) rungs of ONE timbre, ascending in pitch in order: chain step
# 1 sounds the lowest and each further step the next one up, so a long chain
# climbs the ladder and holds on the highest rung once the multiplier has capped.
# The timbre is deliberately the same struck-glass voice at every rung — a hard
# transient, an FM bell body, and a quiet octave — so the ladder reads as pitch
# alone.
LADDER=(523.25 587.33 659.25 783.99 880.00 1046.50 1174.66 1318.51)
rung=0
for f in "${LADDER[@]}"; do
  rung=$((rung + 1))
  newsfx mono 620 "$AUD/chain-$rung.wav"
  x add-voice --name strike --wave noise --gain -13 --start 0 --dur 13
  x set-envelope --voice strike --env pluck
  x add-filter --voice strike --type highpass --cutoff 4600 --resonance 1.2
  x add-voice --name body --wave sine --freq "$f" --gain -4 --start 0 --dur 440
  x set-envelope --voice body --env pluck
  x add-fm --voice body --modulator 2 --index 1.1
  x add-voice --name oct --wave triangle --freq "$(awk -v f="$f" 'BEGIN { printf "%.2f\n", f * 2 }')" \
    --gain -24 --start 0 --dur 240
  x set-envelope --voice oct --env pluck
  x add-reverb --bus master --size 0.34 --mix 0.17
  x render
  echo "  audio/chain-$rung.wav"
done

# ================================== SHATTER ===================================
# The broad glass-and-debris body layered UNDER the chain ladder's tone, so the
# `clear` cue lands with weight. Everything here is sampled from the declared pack:
# a snap for the break itself, a dry metal hit for the strike, the glass pane
# going as the body, and one deep detuned clang holding the bottom.
newsmp mono 950 "$AUD/shatter.wav"
q add-sample --name snap_transient --t 0 --gain -3
q add-sample --name impact_metal_dry --t 0 --gain -9 --pitch -3
q add-sample --name debris_glass --t 6 --gain -2 --trim 0,760 --fade-out 260
q add-sample --name clang_metal --t 0 --gain -17 --pitch -7 --trim 0,420 --fade-out 220
q add-sample --name debris_rubble --t 40 --gain -22 --trim 0,520 --fade-out 240
q add-filter --bus master --type highpass --cutoff 180 --resonance 0.7
q add-compressor --bus master --threshold -14 --ratio 3
q add-reverb --bus master --size 0.3 --mix 0.14
q render
echo "  audio/shatter.wav"

# ================================ TITLE THEME =================================
# The title's hook: a music-box melody over a vibraphone bed, a marimba walking
# the roots, and glockenspiel accents on the turn of each bar. Eight bars in A
# minor at 108, ending on the dominant so the loop pulls back round to the top.
newmusic 20000 "$AUD/title.wav" "$AUD/title.mid"
m set-tempo --bpm 108
m set-time-signature --num 4 --den 4
m define-track --name lead --instrument music_box
m define-track --name bells --instrument glockenspiel
m define-track --name pad --instrument vibraphone
m define-track --name bass --instrument marimba
m set-track-fx --track lead  --gain 10 --pan 0.08 --reverb 0.30 --env pluck
m set-track-fx --track bells --gain 4 --pan -0.30 --reverb 0.45 --env pluck
m set-track-fx --track pad   --gain 10 --pan 0.20 --reverb 0.50 --env swell
m set-track-fx --track bass  --gain 6 --pan -0.10 --reverb 0.18 --env pluck

# the hook — bar by bar over Am F C G | Am F Dm E
for phrase in \
  "0.0 A4 0.5" "0.5 C5 0.5" "1.0 E5 1.0" "2.0 D5 0.5" "2.5 C5 0.5" "3.0 B4 1.0" \
  "4.0 C5 0.5" "4.5 A4 0.5" "5.0 F4 1.0" "6.0 G4 0.5" "6.5 A4 0.5" "7.0 C5 1.0" \
  "8.0 E5 0.5" "8.5 G5 0.5" "9.0 E5 1.0" "10.0 C5 0.5" "10.5 D5 0.5" "11.0 E5 1.0" \
  "12.0 D5 0.5" "12.5 B4 0.5" "13.0 G4 1.0" "14.0 A4 0.5" "14.5 B4 0.5" "15.0 D5 1.0" \
  "16.0 A4 0.5" "16.5 C5 0.5" "17.0 E5 1.0" "18.0 A5 1.0" "19.0 G5 1.0" \
  "20.0 F5 0.5" "20.5 E5 0.5" "21.0 C5 1.0" "22.0 A4 1.0" "23.0 C5 1.0" \
  "24.0 D5 0.5" "24.5 F5 0.5" "25.0 A5 1.0" "26.0 G5 0.5" "26.5 F5 0.5" "27.0 E5 1.0" \
  "28.0 B4 0.5" "28.5 G#4 0.5" "29.0 B4 1.0" "30.0 E5 2.0"; do
  read -r t p d <<<"$phrase"; n lead "$p" "$t" "$d" 104
done

# glockenspiel accents, one per bar, on the turn
i=0
for acc in E6 C6 G6 D6 E6 C6 A6 B6; do
  n bells "$acc" "$((i * 4 + 2))" 1 62; i=$((i + 1))
done
n bells E7 30 2 48

# vibraphone bed and marimba roots, one chord per bar
i=0
for bar in "A3 C4 E4 A2 E3" "F3 A3 C4 F2 C3" "C4 E4 G4 C3 G3" "G3 B3 D4 G2 D3" \
           "A3 C4 E4 A2 E3" "F3 A3 C4 F2 C3" "D3 F3 A3 D3 A3" "E3 G#3 B3 E2 B2"; do
  read -r c1 c2 c3 r5 f5 <<<"$bar"
  t=$((i * 4))
  n pad "$c1" "$t" 4 58; n pad "$c2" "$t" 4 52; n pad "$c3" "$t" 4 50
  n bass "$r5" "$t" 1.5 88
  n bass "$f5" "$((t + 2))" 1 70
  n bass "$r5" "$((t + 3))" 1 76
  i=$((i + 1))
done
m render >/dev/null
echo "  audio/title.wav + title.mid"

# ================================= PLAY BED ===================================
# What sits under a round: the same room, half the tempo and a fraction of the
# activity. A vibraphone holds whole-bar chords, a marimba keeps a slow two-note
# pulse, a piano marks the bar line, and the music box says one short phrase every
# other bar — enough to be there, never enough to pull attention off the board.
newmusic 28000 "$AUD/play.wav" "$AUD/play.mid"
m set-tempo --bpm 76
m set-time-signature --num 4 --den 4
m define-track --name pad --instrument vibraphone
m define-track --name pulse --instrument marimba
m define-track --name motif --instrument music_box
m define-track --name mark --instrument grand_piano
m define-track --name sparkle --instrument glockenspiel
m set-track-fx --track pad     --gain 12 --pan 0.16 --reverb 0.55 --env swell
m set-track-fx --track pulse   --gain 6 --pan -0.22 --reverb 0.28 --env pluck
m set-track-fx --track motif   --gain 10  --pan 0.10 --reverb 0.45 --env pluck
m set-track-fx --track mark    --gain 1 --pan -0.10 --reverb 0.40 --env pluck
m set-track-fx --track sparkle --gain -1 --pan 0.34 --reverb 0.60 --env pluck

# Am | Am | F | G | Am | Dm | F | E
i=0
for bar in "A3 C4 E4 A2 E3" "A3 C4 E4 A2 E3" "F3 A3 C4 F2 C3" "G3 B3 D4 G2 D3" \
           "A3 C4 E4 A2 E3" "D3 F3 A3 D3 A3" "F3 A3 C4 F2 C3" "E3 G#3 B3 E2 B2"; do
  read -r c1 c2 c3 root fifth <<<"$bar"
  t=$((i * 4))
  n pad "$c1" "$t" 4 46; n pad "$c2" "$t" 4 40; n pad "$c3" "$t" 4 38
  n pulse "$root" "$t" 1 58; n pulse "$fifth" "$((t + 2))" 1 46
  n mark "$root" "$t" 2 40
  i=$((i + 1))
done
for phrase in "2.0 E5 1.0" "3.0 C5 1.0" "10.0 A4 1.0" "11.0 C5 1.0" \
              "18.0 E5 1.0" "19.0 G5 1.0" "26.0 F5 1.0" "27.0 E5 1.5"; do
  read -r t p d <<<"$phrase"; n motif "$p" "$t" "$d" 72
done
for acc in "6.0 E6" "14.0 D6" "22.0 A5" "30.0 B5"; do
  read -r t p <<<"$acc"; n sparkle "$p" "$t" 2 44
done
m render >/dev/null
echo "  audio/play.wav + play.mid"

echo "gen-audio.sh: done -> $AUD"
