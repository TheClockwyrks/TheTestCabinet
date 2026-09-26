#!/usr/bin/env bash
# Orrery — produce the game's AUDIO with the on-PATH audio tools
# (specs/assets.md → "The sound"). The palette is A BRASS INSTRUMENT SHOP UNDER
# A NIGHT SKY: seated brass, sprung latches, a servo taking up load, struck
# metal, and glass bells — one workshop, heard through six one-shot cues and a
# bed that sits under all of them.
#
# Production lanes, chosen per cue as specs/assets.md allows:
#   * The four MACHINE cues — `place`, `erase`, `start`, `halt` — are built
#     with `sfx-sample` over the baked pack, because the thing they report is a
#     mechanism moving and the pack's own latches, ratchets, servos and struck
#     metal carry that better than an oscillator can. Each layers a synth voice
#     of its own on top, so the pack sample is the body and the tuning is ours.
#   * The two CELESTIAL cues — `constellation` and `complete` — are pure
#     `sfx-synth`, because what they report is light rather than metal: glass
#     bells over a warm swell, which wants oscillator control.
#   * The BED is sequenced with `music` over the baked instrument bank, which
#     is where the brass, the strings and the bells of the shop actually live.
#
# The sound bar specs/assets.md sets, and how each cue meets it:
#   * `place` and `erase` fire many times a minute, so both are under a quarter
#     of a second and neither has a tail. `erase` is told from `place` by ear:
#     `place` seats UP, bright and sprung; `erase` is a dull clank falling AWAY.
#   * `start` reads as a machine taking up motion: a ratchet, a servo, and a
#     tone climbing a fifth under them.
#   * `halt` and `complete` are the two loudest and longest sounds in the game,
#     and they are opposites — `halt` is struck iron collapsing a semitone, and
#     `complete` a bell arpeggio climbing an octave over a brass swell.
#   * `constellation` sits UNDER `complete`: the same bell timbre, two notes
#     rather than five, quieter and half as long.
#   * The bed is mixed well below every cue and moves slowly enough to stay
#     welcome across a long sitting on one challenge.
#
# Produces, under assets/audio/, exactly the files the contract names:
#   place.wav          a part is placed or moved   (sfx-sample)
#   erase.wav          a part is removed           (sfx-sample)
#   start.wav          a run starts                (sfx-sample)
#   halt.wav           a run faults                (sfx-sample)
#   constellation.wav  a set consumes              (sfx-synth)
#   complete.wav       the run completes           (sfx-synth)
#   music.wav (+ .mid) the bed, looping on every screen (music)
#
# Usage:  bash scripts/gen-audio.sh   (sfx-sample, sfx-synth and music must be
#         on PATH, or built under $CARGO_TARGET_DIR; the baked pack and bank are
#         found through TCAB_SAMPLE_PACK_DIR and TCAB_INSTRUMENT_BANK_DIR, and
#         default to the machine's own installed copies).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release/debug dirs.
TARGET="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"
for tool in sfx-sample sfx-synth music; do
  command -v "$tool" >/dev/null 2>&1 && continue
  for dir in "$TARGET/release" "$TARGET/debug"; do
    [ -x "$dir/$tool" ] && { export PATH="$dir:$PATH"; break; }
  done
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found on PATH or under $TARGET" >&2; exit 1; }
done

PACK_DIR="${TCAB_SAMPLE_PACK_DIR:-/opt/sample-packs/pack}"
BANK_DIR="${TCAB_INSTRUMENT_BANK_DIR:-/opt/instrument-banks/gm-lite}"
[ -d "$PACK_DIR" ] || { echo "sample pack not found at $PACK_DIR (set TCAB_SAMPLE_PACK_DIR)" >&2; exit 1; }
[ -d "$BANK_DIR" ] || { echo "instrument bank not found at $BANK_DIR (set TCAB_INSTRUMENT_BANK_DIR)" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUD="$ROOT/assets/audio"
mkdir -p "$AUD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
CFG="$TMP/cfg.json"

# --- sfx-sample helpers (a pack layer plus synth glue) -----------------------
# newsam <channels> <max_ms> <out.wav>
newsam() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 4127, "sample_pack": "pack", "sample_pack_dir": "%s", "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$PACK_DIR" "$TMP/sam.actions.json" "$TMP/sam.preview.png" "$3" > "$CFG"
  sfx-sample init --config "$CFG" >/dev/null
}
s() { sfx-sample "$@" --config "$CFG" >/dev/null; }

# --- sfx-synth helpers ------------------------------------------------------
# newsfx <channels> <max_ms> <out.wav>
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 4127, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- music helpers (the baked instrument bank) ------------------------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 4127, "instrument_bank": "gm-lite", "instrument_bank_dir": "%s", "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$BANK_DIR" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ================================== PLACE ====================================
# A part is placed or moved: a brass fitting SEATED. The pack's spring-loaded
# latch is the body, trimmed to its click alone, and a short triangle pings up
# a fifth over it so the cue reads as something locking home rather than as
# something falling. Mono, dry, under a fifth of a second — it fires on every
# drag in the editor.
newsam mono 200 "$AUD/place.wav"
s add-sample --name mech_clip_load --t 0 --gain -3 --pitch 3 --trim 0,120 --fade-in 2 --fade-out 30
s add-voice --name seat --wave triangle --freq 660 --gain -9 --start 4 --dur 110
s set-envelope --voice seat --env pluck
s set-pitch --voice seat --slide-to 990 --over 80
s add-voice --name tick --wave noise --gain -22 --start 0 --dur 26
s set-envelope --voice tick --env pluck
s add-filter --voice tick --type highpass --cutoff 5600 --resonance 1.0
s add-filter --bus master --type highpass --cutoff 220 --resonance 0.7
s render

# ================================== ERASE ====================================
# A part is removed: the same shop, the opposite gesture. The pack's dull clank
# pitched DOWN is the body, a triangle slides a fifth DOWN rather than up, and
# a lowpass takes the brightness off, so `erase` is heard as the undoing of
# `place` with the eyes shut. Slightly longer, clearly duller, clearly lower.
newsam mono 260 "$AUD/erase.wav"
s add-sample --name mech_clank --t 0 --gain -5 --pitch -4 --trim 0,180 --fade-out 60
s add-voice --name fall --wave triangle --freq 440 --gain -10 --start 0 --dur 150
s set-envelope --voice fall --env pluck
s set-pitch --voice fall --slide-to 294 --over 130
s add-voice --name scrape --wave noise --gain -26 --start 10 --dur 90
s set-envelope --voice scrape --env pluck
s add-filter --voice scrape --type bandpass --cutoff 1300 --resonance 1.4
s add-filter --bus master --type lowpass --cutoff 3200 --resonance 0.8
s render

# ================================== START ====================================
# A run starts: the machine TAKES UP MOTION. A sprung ratchet lets go, a servo
# spins up under it, and a triangle-and-saw pair climbs a fifth (A3 to E4) as
# the drive engages. Stereo, so the servo sits a little left of the ratchet and
# the shop has width.
newsam stereo 900 "$AUD/start.wav"
s add-sample --name mech_ratchet --t 0 --gain -6 --pitch 2 --trim 0,320 --fade-out 80
s add-sample --name servo_motor --t 90 --gain -12 --pitch -2 --trim 0,620 --fade-in 60 --fade-out 220
s add-voice --name drive --wave triangle --freq 220 --gain -8 --start 60 --dur 620 --pan -0.1
s set-envelope --voice drive --attack 90 --decay 220 --sustain 0.55 --release 260
s set-pitch --voice drive --slide-to 330 --over 520
s add-voice --name engage --wave saw --gain -19 --freq 440 --start 120 --dur 520 --pan 0.15
s set-envelope --voice engage --env swell
s set-pitch --voice engage --slide-to 660 --over 460
s add-filter --voice engage --type lowpass --cutoff 2400 --resonance 1.2
s add-voice --name bell --wave sine --freq 880 --gain -16 --start 520 --dur 320 --pan 0.1
s set-envelope --voice bell --env pluck
s add-reverb --bus master --size 0.3 --mix 0.14
s add-compressor --bus master --threshold -14 --ratio 3
s render

# =================================== HALT ====================================
# A run faults: struck iron, and the drive dying under it. The pack's ringing
# clang is the strike, ring-modulated so it reads as damaged rather than
# musical; a saw collapses two octaves; and a sub thud lands underneath. It is
# the LOWEST cue in the game and, with `complete`, the longest — and where
# `complete` climbs, every voice in `halt` falls.
newsam stereo 1400 "$AUD/halt.wav"
s add-sample --name clang_metal --t 0 --gain -4 --pitch -5 --trim 0,900 --fade-out 380
s add-sample --name impact_metal_hollow --t 30 --gain -9 --pitch -7 --trim 0,900 --fade-out 420
s add-voice --name collapse --wave saw --freq 330 --gain -8 --start 0 --dur 900 --pan -0.12
s set-envelope --voice collapse --env punch
s set-pitch --voice collapse --slide-to 82 --over 820
s add-voice --name sour --wave square --freq 233 --gain -17 --start 40 --dur 700 --pan 0.14
s set-envelope --voice sour --env punch
s add-ringmod --voice sour --freq 47
s add-voice --name thud --wave sine --freq 110 --gain -5 --start 0 --dur 620
s set-envelope --voice thud --env punch
s set-pitch --voice thud --slide-to 46 --over 560
s add-distortion --bus master --drive 1.25
s add-filter --bus master --type lowpass --cutoff 4200 --resonance 0.9
s add-reverb --bus master --size 0.5 --mix 0.2
s render

# ============================== CONSTELLATION ================================
# A set consumes one or more constellations: a small, clean two-bell chime —
# E5 up to A5, glass rather than metal, with a faint shimmer over it. It is the
# same bell voice `complete` uses, deliberately: `constellation` is one step of
# what `complete` finishes, so it sits UNDER it in weight, in length, and in
# how far it climbs.
newsfx stereo 700 "$AUD/constellation.wav"
x add-voice --name bell1 --wave sine --freq 659 --gain -9 --start 0 --dur 380 --pan -0.12
x set-envelope --voice bell1 --env pluck
x add-fm --voice bell1 --modulator 3.01 --index 1.5
x add-voice --name bell2 --wave sine --freq 880 --gain -11 --start 140 --dur 420 --pan 0.12
x set-envelope --voice bell2 --env pluck
x add-fm --voice bell2 --modulator 3.01 --index 1.3
x add-voice --name air --wave triangle --freq 1760 --gain -24 --start 150 --dur 300
x set-envelope --voice air --env pluck
x add-voice --name warm --wave triangle --freq 220 --gain -20 --start 0 --dur 320
x set-envelope --voice warm --env pluck
x add-reverb --bus master --size 0.42 --mix 0.24
x render

# ================================= COMPLETE ==================================
# The run completes: the reward, and the brightest thing in the game. The same
# glass bells as `constellation`, but a full A-minor-to-A arpeggio climbing an
# octave (A4 C5 E5 A5 and a C6 over the top), over a brass swell that opens
# underneath and a long shimmer tail. Nothing about it falls, which is what
# keeps it from ever being heard as `halt`.
newsfx stereo 2000 "$AUD/complete.wav"
# One bell per line: start (ms), frequency (Hz), gain (dB), pan.
while read -r start freq gain pan; do
  x add-voice --name "b$start" --wave sine --freq "$freq" --gain "$gain" \
    --start "$start" --dur 900 --pan "$pan"
  x set-envelope --voice "b$start" --env pluck
  x add-fm --voice "b$start" --modulator 3.01 --index 1.4
done <<'BELLS'
0 440 -8 -0.2
150 523 -8 -0.1
300 659 -9 0.05
450 880 -9 0.15
620 1047 -11 0.0
BELLS
x add-voice --name swell --wave triangle --freq 110 --gain -10 --start 0 --dur 1300
x set-envelope --voice swell --env swell
x add-voice --name fifth --wave triangle --freq 165 --gain -14 --start 120 --dur 1200 --pan -0.1
x set-envelope --voice fifth --env swell
x add-voice --name brass --wave saw --freq 220 --gain -20 --start 200 --dur 1100 --pan 0.1
x set-envelope --voice brass --env swell
x add-filter --voice brass --type lowpass --cutoff 1900 --resonance 1.1
x add-voice --name shimmer --wave triangle --freq 2093 --gain -26 --start 700 --dur 900
x set-envelope --voice shimmer --env swell
x add-reverb --bus master --size 0.6 --mix 0.3
x add-compressor --bus master --threshold -12 --ratio 3
x render

# =================================== THE BED =================================
# Loops from the first frame on every screen, so it has to bear a long sitting
# on one challenge: it is slow, sparse, and mixed well under the cues, and it
# never resolves — an orrery turning, not a tune with an ending.
#
# 60 BPM, 4/4, EIGHT BARS = 32 beats = EXACTLY 32000 ms, and the drone and the
# sub are held to beat 32, so the rendered file is exactly one turn of the
# grid: the loop boundary IS the file boundary. The seam is then authored twice
# over — the two voices that reach the boundary end on a `swell`, which is at
# silence when it closes, and the two bell tracks that would otherwise ring
# past it carry no reverb of their own — so the file's last sample sits where
# its first one does and the end runs into the start with no click, no gap, and
# no jump in level. Thirty-two seconds clears MUSIC_MIN_SECONDS (30) with two
# to spare.
#
# The harmony is four bars of A minor and four of F, in open fifths with no
# thirds, which is what keeps it from ever sounding like it has arrived.
newmusic 32000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 60
m set-time-signature --num 4 --den 4
m define-track --name drone --instrument cello
m define-track --name pad   --instrument string_ensemble
m define-track --name bells --instrument vibraphone
m define-track --name motif --instrument music_box
m define-track --name sub   --instrument sine
m set-track-fx --track drone --gain -8  --reverb 0.35 --env swell --pan -0.12
m set-track-fx --track pad   --gain -12 --reverb 0.45 --env swell --pan 0.08
m set-track-fx --track bells --gain -13 --reverb 0.0  --env pluck --pan 0.2
m set-track-fx --track motif --gain -16 --reverb 0.0  --env pluck --pan -0.2
m set-track-fx --track sub   --gain -10 --reverb 0.15 --env swell --pan 0.0

# Drone — the shop's own low bowed note: two bars per chord, A then F.
m add-note --track drone --pitch A2 --t 0  --dur 7.5 --velocity 54
m add-note --track drone --pitch E3 --t 8  --dur 7.5 --velocity 46
m add-note --track drone --pitch F2 --t 16 --dur 7.5 --velocity 54
m add-note --track drone --pitch C3 --t 24 --dur 8   --velocity 46

# Pad — open fifths above the drone, entering half a bar late so the two
# breathe against each other rather than in step.
m add-note --track pad --pitch A3 --t 2  --dur 5.5 --velocity 40
m add-note --track pad --pitch E4 --t 2  --dur 5.5 --velocity 32
m add-note --track pad --pitch E4 --t 10 --dur 5.5 --velocity 38
m add-note --track pad --pitch B4 --t 10 --dur 5.5 --velocity 30
m add-note --track pad --pitch F3 --t 18 --dur 5.5 --velocity 40
m add-note --track pad --pitch C4 --t 18 --dur 5.5 --velocity 32
m add-note --track pad --pitch C4 --t 26 --dur 4   --velocity 36
m add-note --track pad --pitch G4 --t 26 --dur 4   --velocity 28

# Sub — one long breath per half, the floor the whole bed rests on.
m add-note --track sub --pitch A1 --t 0  --dur 15  --velocity 60
m add-note --track sub --pitch F1 --t 16 --dur 16  --velocity 58

# Bells — the orrery's escapement: a slow descending figure that never lands on
# the same beat twice, so eight bars do not sound like two.
m add-note --track bells --pitch A5 --t 1.5  --dur 1.5 --velocity 52
m add-note --track bells --pitch E5 --t 4    --dur 1.5 --velocity 46
m add-note --track bells --pitch C5 --t 6.5  --dur 2   --velocity 44
m add-note --track bells --pitch B4 --t 11   --dur 1.5 --velocity 48
m add-note --track bells --pitch E5 --t 13.5 --dur 1.5 --velocity 42
m add-note --track bells --pitch A5 --t 17   --dur 1.5 --velocity 50
m add-note --track bells --pitch F5 --t 20   --dur 2   --velocity 44
m add-note --track bells --pitch C5 --t 23.5 --dur 1.5 --velocity 46
m add-note --track bells --pitch G5 --t 27   --dur 1.5 --velocity 42
m add-note --track bells --pitch E5 --t 29   --dur 1   --velocity 38

# Motif — a music box a long way back in the mix, one phrase every other bar.
m add-note --track motif --pitch E6 --t 3    --dur 0.75 --velocity 34
m add-note --track motif --pitch C6 --t 3.75 --dur 0.75 --velocity 30
m add-note --track motif --pitch A5 --t 12   --dur 0.75 --velocity 32
m add-note --track motif --pitch B5 --t 12.75 --dur 0.75 --velocity 28
m add-note --track motif --pitch F6 --t 19   --dur 0.75 --velocity 32
m add-note --track motif --pitch C6 --t 19.75 --dur 0.75 --velocity 28
m add-note --track motif --pitch G5 --t 28   --dur 0.75 --velocity 30
m render

echo "produced orrery audio under $AUD:"
ls -la "$AUD"
