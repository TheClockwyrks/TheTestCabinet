#!/usr/bin/env bash
# Kessler — produce the game's AUDIO with the on-PATH audio tools
# (specs/assets.md → "The sound"). The palette is COLD, GLASSY, and SPACEY:
# hard vacuum, glass, and sunlight on dead metal — pure tones, glassy chimes,
# ring-mod metal, and filtered noise, so the thirteen cues and two beds sound
# like one game (specs/assets.md "The sound bar").
#
# Production lanes: every cue is PURE SYNTH via `sfx-synth` (the contract allows
# `sfx-synth` or `sfx-sample` per cue; the cold/glassy palette wants the tight
# oscillator control, and no baked sample pack is required). The two beds are
# sequenced with `music` on SYNTH-WAVEFORM tracks only
# (`define-track --instrument sine|triangle|saw|square`) — specs/assets.md
# allows the beds to sequence "the baked instrument bank, synth waveforms, or
# both", and the synth-waveform lane keeps the beds as cold and glassy as the
# cues. Each bed's note grid fills its `max_duration_ms` EXACTLY (bars x beats
# at the chosen BPM), so the rendered file ends on the loop boundary and the
# end runs into the start with no click, gap, or level jump.
#
# Produces, under assets/audio/, exactly the files the contract names:
#   paddle-bounce.wav     the deflector face catches a ball (glassy pop)
#   field-bounce.wav      the containment field throws a ball back (deep hum-thud)
#   target-hit.wav        a hit that does not destroy (dead-metal clank)
#   target-break.wav      a destruction (clank + shatter + debris; reads on a busy field)
#   shield-reflect.wav    the shield ring consumes its reflection (energy zap)
#   pod-catch.wav         catching widen/multiball/shield/pierce (bright two-note UP)
#   pod-catch-narrow.wav  catching narrow (sour buzzy two-note DOWN — bad news by ear)
#   pod-burn.wav          a pod burns up at the planet (fizz falling away)
#   ball-lost.wav         a ball burns up (whoosh down into a low thud)
#   wave-clear.wav        the clearing event (cold ascending glass arpeggio)
#   game-over.wav         the session ends — the HEAVIEST sound in the game:
#                         clearly longer and lower than every other cue
#   menu-move.wav         menu navigation (tiny glass tick)
#   menu-select.wav       menu confirm (short two-tone affirm)
#   music-title.wav (+ .mid)  the title/howto bed — 16 s drifting cold pad loop
#   music-play.wav  (+ .mid)  the playing/waveclear/paused bed — 20 s pulsing loop
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth + music must be on PATH, or
#         built under $CARGO_TARGET_DIR).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release/debug dirs.
TARGET="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"
for tool in sfx-synth music; do
  command -v "$tool" >/dev/null 2>&1 && continue
  for dir in "$TARGET/release" "$TARGET/debug"; do
    [ -x "$dir/$tool" ] && { export PATH="$dir:$PATH"; break; }
  done
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found on PATH or under $TARGET" >&2; exit 1; }
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUD="$ROOT/assets/audio"
mkdir -p "$AUD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
CFG="$TMP/cfg.json"

# --- sfx-synth helpers -------------------------------------------------------
# newsfx <channels> <max_ms> <out.wav> : seed a fresh synth run (empty op log).
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 1337, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- music helpers (synth-waveform tracks only; no instrument bank) ----------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 1337, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ============================== PADDLE BOUNCE ================================
# The deflector face catches a ball — the most frequent cue in the game, so it
# stays short, dry, and glassy: a bright triangle pop snapping UP a fifth, with
# a tiny glass tick on top. Mono, tight, no tail to smear a fast rally.
newsfx mono 180 "$AUD/paddle-bounce.wav"
x add-voice --name pop --wave triangle --freq 620 --gain -6 --start 0 --dur 120
x set-envelope --voice pop --env pluck
x set-pitch --voice pop --slide-to 930 --over 100
x add-voice --name tick --wave noise --gain -16 --start 0 --dur 35
x set-envelope --voice tick --env pluck
x add-filter --voice tick --type highpass --cutoff 5200 --resonance 1.0
x render

# ============================== FIELD BOUNCE =================================
# The containment field throws a ball back — the field is energy, not metal:
# a deep sine thud with a soft electric hum-shimmer over it. Lower and rounder
# than the paddle pop, so the two reflections are told apart with eyes shut.
newsfx stereo 400 "$AUD/field-bounce.wav"
x add-voice --name thud --wave sine --freq 150 --gain -5 --start 0 --dur 260
x set-envelope --voice thud --env punch
x set-pitch --voice thud --slide-to 78 --over 240
x add-voice --name hum --wave sine --freq 440 --gain -14 --start 0 --dur 300 --pan -0.1
x set-envelope --voice hum --env pluck
x add-ringmod --voice hum --freq 36
x add-voice --name shimmer --wave noise --gain -18 --start 0 --dur 220 --pan 0.15
x set-envelope --voice shimmer --env pluck
x add-filter --voice shimmer --type bandpass --cutoff 3400 --resonance 1.8
x add-reverb --bus master --size 0.3 --mix 0.14
x render

# =============================== TARGET HIT ==================================
# A ball hits a derelict but does NOT destroy it: a dull dead-metal clank —
# FM for the inharmonic body, ringmod for the junk rattle, fast decay. It fires
# constantly on a busy field, so it is mid-weight and short.
newsfx mono 260 "$AUD/target-hit.wav"
x add-voice --name clank --wave square --freq 340 --gain -7 --start 0 --dur 180
x set-envelope --voice clank --env pluck
x add-fm --voice clank --modulator 2.7 --index 3.5
x add-voice --name body --wave triangle --freq 170 --gain -10 --start 0 --dur 140
x set-envelope --voice body --env pluck
x add-ringmod --voice body --freq 53
x add-filter --bus master --type lowpass --cutoff 5200 --resonance 0.8
x add-reverb --bus master --size 0.22 --mix 0.08
x render

# ============================== TARGET BREAK =================================
# A derelict is DESTROYED — clearly distinct from target-hit on a busy field
# (specs/assets.md "The sound bar"): the same metal family but bigger, brighter,
# and longer, with a glass SHATTER over the clank and debris hiss trailing off.
newsfx stereo 800 "$AUD/target-break.wav"
x add-voice --name clank --wave square --freq 300 --gain -6 --start 0 --dur 260
x set-envelope --voice clank --env punch
x add-fm --voice clank --modulator 2.7 --index 5
x add-voice --name shatter --wave noise --gain -8 --start 0 --dur 240 --pan 0.12
x set-envelope --voice shatter --env pluck
x add-filter --voice shatter --type highpass --cutoff 2600 --resonance 1.4
x add-voice --name ring1 --wave sine --freq 1244 --gain -13 --start 30 --dur 320 --pan -0.15
x set-envelope --voice ring1 --env pluck
x add-voice --name ring2 --wave sine --freq 1866 --gain -16 --start 60 --dur 300 --pan 0.2
x set-envelope --voice ring2 --env pluck
x add-voice --name debris --wave noise --gain -14 --start 120 --dur 480
x set-envelope --voice debris --attack 10 --decay 200 --sustain 0.3 --release 240
x add-filter --voice debris --type bandpass --cutoff 1800 --resonance 1.2
x add-voice --name drop --wave saw --freq 220 --gain -12 --start 0 --dur 300
x set-envelope --voice drop --env punch
x set-pitch --voice drop --slide-to 70 --over 280
x add-distortion --bus master --drive 1.3
x add-reverb --bus master --size 0.4 --mix 0.18
x render

# ============================= SHIELD REFLECT ================================
# The shield ring consumes its one reflection: an ENERGY zap, not metal — a
# fast saw sweep diving down with ringmod clangor and a cold glass shimmer
# flying up and away. Reads as a discharge: the shield spent itself.
newsfx stereo 500 "$AUD/shield-reflect.wav"
x add-voice --name zap --wave saw --freq 980 --gain -7 --start 0 --dur 220
x set-envelope --voice zap --env pluck
x set-pitch --voice zap --slide-to 180 --over 200
x add-ringmod --voice zap --freq 90
x add-voice --name upglass --wave sine --freq 1046 --gain -13 --start 40 --dur 300 --pan 0.18
x set-envelope --voice upglass --env pluck
x set-pitch --voice upglass --slide-to 2093 --over 260
x add-voice --name crackle --wave noise --gain -15 --start 0 --dur 160 --pan -0.12
x set-envelope --voice crackle --env pluck
x add-filter --voice crackle --type bandpass --cutoff 4200 --resonance 2.0
x add-reverb --bus master --size 0.35 --mix 0.16
x render

# ================================ POD CATCH ==================================
# Catching widen / multiball / shield / pierce — good news: a bright, glassy
# two-note figure stepping UP (E5 -> A5), clean sine/triangle, small sparkle.
newsfx stereo 420 "$AUD/pod-catch.wav"
x add-voice --name n1 --wave sine --freq 659 --gain -7 --start 0 --dur 140 --pan -0.08
x set-envelope --voice n1 --env pluck
x add-voice --name n2 --wave triangle --freq 880 --gain -6 --start 120 --dur 240 --pan 0.1
x set-envelope --voice n2 --env pluck
x add-voice --name sparkle --wave sine --freq 2637 --gain -17 --start 150 --dur 200
x set-envelope --voice sparkle --env pluck
x add-reverb --bus master --size 0.3 --mix 0.14
x render

# ============================= POD CATCH (NARROW) ============================
# Catching the NARROW pod — bad news, told from pod-catch BY EAR ALONE
# (specs/assets.md "The sound bar"): the mirror image of the good catch — a
# buzzy, detuned square figure stepping DOWN a tritone (A4 -> Eb4), with a sour
# wobble. Same family, opposite direction, unmistakably a worse deal.
newsfx stereo 500 "$AUD/pod-catch-narrow.wav"
x add-voice --name n1 --wave square --freq 440 --gain -9 --start 0 --dur 150 --pan -0.08
x set-envelope --voice n1 --env pluck
x add-voice --name n1d --wave square --freq 447 --gain -14 --start 0 --dur 150
x set-envelope --voice n1d --env pluck
x add-voice --name n2 --wave square --freq 311 --gain -8 --start 130 --dur 300 --pan 0.1
x set-envelope --voice n2 --env pluck
x add-vibrato --voice n2 --rate 9 --depth 0.5
x add-voice --name n2d --wave square --freq 316 --gain -13 --start 130 --dur 300
x set-envelope --voice n2d --env pluck
x add-filter --bus master --type lowpass --cutoff 4600 --resonance 0.9
x add-reverb --bus master --size 0.25 --mix 0.1
x render

# ================================ POD BURN ===================================
# A pod reaches the planet unclaimed: a small fizz falling away — filtered
# noise sweeping down with a sine dropping after it. Quieter and lighter than
# ball-lost: lost salvage, not a lost ball.
newsfx mono 550 "$AUD/pod-burn.wav"
x add-voice --name fizz --wave noise --gain -9 --start 0 --dur 420
x set-envelope --voice fizz --attack 15 --decay 180 --sustain 0.4 --release 200
x add-filter --voice fizz --type bandpass --cutoff 3200 --sweep-to 700 --over 420 --resonance 1.5
x add-voice --name fall --wave sine --freq 520 --gain -11 --start 40 --dur 380
x set-envelope --voice fall --env pluck
x set-pitch --voice fall --slide-to 120 --over 360
x add-reverb --bus master --size 0.3 --mix 0.12
x render

# ================================ BALL LOST ==================================
# A ball burns up at the planet: a real loss — a hot whoosh diving down into a
# low thud, heavier and darker than pod-burn but still clearly lighter than
# game-over.
newsfx stereo 900 "$AUD/ball-lost.wav"
x add-voice --name whoosh --wave noise --gain -7 --start 0 --dur 520
x set-envelope --voice whoosh --attack 20 --decay 260 --sustain 0.35 --release 220
x add-filter --voice whoosh --type lowpass --cutoff 3800 --sweep-to 500 --over 520 --resonance 1.1
x add-voice --name dive --wave saw --freq 330 --gain -10 --start 0 --dur 480 --pan -0.08
x set-envelope --voice dive --env pluck
x set-pitch --voice dive --slide-to 65 --over 460
x add-voice --name thud --wave sine --freq 120 --gain -5 --start 420 --dur 320
x set-envelope --voice thud --env punch
x set-pitch --voice thud --slide-to 48 --over 300
x add-filter --bus master --type lowpass --cutoff 4200 --resonance 0.8
x add-reverb --bus master --size 0.4 --mix 0.16
x render

# ================================ WAVE CLEAR =================================
# The clearing event — the field is swept: a cold, glassy ascending arpeggio
# (A minor climbed to a bright octave) with a shimmer over the top. Triumphant
# but icy — glass in sunlight, not brass.
newsfx stereo 1500 "$AUD/wave-clear.wav"
x add-voice --name a1 --wave sine --freq 440 --gain -8 --start 0   --dur 300 --pan -0.15
x set-envelope --voice a1 --env pluck
x add-voice --name a2 --wave sine --freq 523 --gain -8 --start 120 --dur 320 --pan -0.05
x set-envelope --voice a2 --env pluck
x add-voice --name a3 --wave triangle --freq 659 --gain -7 --start 240 --dur 380 --pan 0.05
x set-envelope --voice a3 --env pluck
x add-voice --name a4 --wave triangle --freq 880 --gain -6 --start 380 --dur 540 --pan 0.15
x set-envelope --voice a4 --env pluck
x add-voice --name shimmer --wave sine --freq 2637 --gain -16 --start 420 --dur 600 --pan 0.1
x set-envelope --voice shimmer --env pluck
x add-voice --name air --wave sine --freq 1760 --gain -15 --start 560 --dur 520 --pan -0.1
x set-envelope --voice air --env pluck
x add-delay --bus master --time 140 --feedback 0.25 --mix 0.2
x add-reverb --bus master --size 0.5 --mix 0.22
x render

# ================================ GAME OVER ==================================
# The session ends — the HEAVIEST sound in the game, clearly longer and lower
# than every other cue (specs/assets.md "The sound bar"), and it rings out over
# silence (no bed on the game-over screen). A deep saw column sagging down two
# octaves, a sub sine under it, a slow cold noise swell, and one last dark
# glass toll — the debris field wins.
newsfx stereo 3400 "$AUD/game-over.wav"
x add-voice --name column --wave saw --freq 110 --gain -6 --start 0 --dur 2400 --pan 0.0
x set-envelope --voice column --attack 60 --decay 600 --sustain 0.55 --release 900
x set-pitch --voice column --slide-to 36 --over 2300
x add-voice --name sub --wave sine --freq 55 --gain -5 --start 0 --dur 2600
x set-envelope --voice sub --attack 80 --decay 0 --sustain 1 --release 800
x set-pitch --voice sub --slide-to 28 --over 2500
x add-voice --name swell --wave noise --gain -16 --start 300 --dur 1800 --pan 0.1
x set-envelope --voice swell --env swell
x add-filter --voice swell --type lowpass --cutoff 1400 --resonance 0.9
x add-voice --name toll --wave sine --freq 415 --gain -13 --start 1200 --dur 1400 --pan -0.12
x set-envelope --voice toll --env pluck
x add-ringmod --voice toll --freq 3
x add-filter --bus master --type lowpass --cutoff 2800 --resonance 0.7
x add-reverb --bus master --size 0.65 --mix 0.26
x render

# ================================ MENU MOVE ==================================
# Menu navigation — short and light so working a menu never drowns a bed
# (specs/assets.md "The sound bar"): a tiny glass tick, nothing more.
newsfx mono 100 "$AUD/menu-move.wav"
x add-voice --name tick --wave triangle --freq 1320 --gain -10 --start 0 --dur 60
x set-envelope --voice tick --env pluck
x add-voice --name click --wave noise --gain -18 --start 0 --dur 25
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 6000 --resonance 1.0
x render

# =============================== MENU SELECT =================================
# Menu confirm — one degree heavier than menu-move: a clean two-tone affirm
# (E5 -> B5), still short and light.
newsfx mono 260 "$AUD/menu-select.wav"
x add-voice --name t1 --wave sine --freq 659 --gain -8 --start 0 --dur 90
x set-envelope --voice t1 --env pluck
x add-voice --name t2 --wave sine --freq 988 --gain -7 --start 80 --dur 160
x set-envelope --voice t2 --env pluck
x add-reverb --bus master --size 0.2 --mix 0.08
x render

# ================================ TITLE BED ==================================
# The title/howto bed: 16 s of cold drift in A minor — open fifths only (no
# thirds: vacuum, not warmth). A sine pad holds low fifths, a triangle sub
# breathes under it, and a sparse square "glass bell" motif falls across the
# top with long reverb — dead metal turning in sunlight. 60 BPM, 4/4, 4 bars =
# 16 beats = EXACTLY 16000 ms, so the loop seam lands on the downbeat.
newmusic 16000 "$AUD/music-title.wav" "$AUD/music-title.mid"
m set-tempo --bpm 60
m set-time-signature --num 4 --den 4
m define-track --name pad  --instrument sine
m define-track --name sub  --instrument triangle
m define-track --name bell --instrument square
m define-track --name air  --instrument saw
m set-track-fx --track pad  --gain -10 --reverb 0.55 --env swell --pan 0.0
m set-track-fx --track sub  --gain -8  --reverb 0.2  --env gate --pan 0.0
m set-track-fx --track bell --gain -17 --reverb 0.6  --env pluck --pan 0.2
m set-track-fx --track air  --gain -24 --reverb 0.7  --env swell --pan -0.2

# Pad — open fifths, one chord per bar: Am5 · Fmaj5 · Cmaj5 · Em5 (roots+5ths).
m add-note --track pad --pitch A2 --t 0  --dur 4 --velocity 52
m add-note --track pad --pitch E3 --t 0  --dur 4 --velocity 44
m add-note --track pad --pitch F2 --t 4  --dur 4 --velocity 52
m add-note --track pad --pitch C3 --t 4  --dur 4 --velocity 44
m add-note --track pad --pitch C3 --t 8  --dur 4 --velocity 50
m add-note --track pad --pitch G3 --t 8  --dur 4 --velocity 42
m add-note --track pad --pitch E2 --t 12 --dur 4 --velocity 52
m add-note --track pad --pitch B2 --t 12 --dur 4 --velocity 44

# Sub — the roots an octave down, whole notes, breathing with the pad.
m add-note --track sub --pitch A1 --t 0  --dur 4 --velocity 64
m add-note --track sub --pitch F1 --t 4  --dur 4 --velocity 62
m add-note --track sub --pitch C2 --t 8  --dur 4 --velocity 60
m add-note --track sub --pitch E1 --t 12 --dur 4 --velocity 64

# Bell — a sparse falling glass motif, never on the same beat twice.
m add-note --track bell --pitch E5 --t 1.5  --dur 1   --velocity 58
m add-note --track bell --pitch C5 --t 3    --dur 1.5 --velocity 50
m add-note --track bell --pitch A4 --t 6    --dur 1.5 --velocity 54
m add-note --track bell --pitch G4 --t 9.5  --dur 1   --velocity 50
m add-note --track bell --pitch E5 --t 11   --dur 1.5 --velocity 46
m add-note --track bell --pitch B4 --t 14   --dur 1.5 --velocity 52

# Air — a barely-there high fifth, one long exhale per half, far back in the mix.
m add-note --track air --pitch E4 --t 0 --dur 8 --velocity 30
m add-note --track air --pitch G4 --t 8 --dur 8 --velocity 28
m render

# ================================= PLAY BED ==================================
# The playing/waveclear/paused bed: 20 s with a pulse — the demolition shift is
# on. A triangle bass walks a cold eighth-note pattern under sine-fifth pads
# (Am · F · C · G, still no thirds), a square arp glints off the top, and a low
# sine kick marks the bar. Busier than the title bed but mixed to sit UNDER the
# cues. 96 BPM, 4/4, 8 bars = 32 beats = EXACTLY 20000 ms for a seamless loop.
newmusic 20000 "$AUD/music-play.wav" "$AUD/music-play.mid"
m set-tempo --bpm 96
m set-time-signature --num 4 --den 4
m define-track --name bass --instrument triangle
m define-track --name pad  --instrument sine
m define-track --name arp  --instrument square
m define-track --name kick --instrument sine
m set-track-fx --track bass --gain -8  --reverb 0.15 --env punch --pan 0.0
m set-track-fx --track pad  --gain -13 --reverb 0.5  --env swell --pan 0.0
m set-track-fx --track arp  --gain -19 --reverb 0.45 --env pluck --pan 0.18
m set-track-fx --track kick --gain -9  --reverb 0.2  --env punch --pan 0.0

# Bass — root eighth-note pulse, two bars per chord: A · A · F · F · C · C · G · G.
bass_bar() { # <bar> <root> <fifth>
  local t=$(( $1 * 4 ))
  m add-note --track bass --pitch "$2" --t "$t"        --dur 0.45 --velocity 84
  m add-note --track bass --pitch "$2" --t "$t.5"      --dur 0.45 --velocity 62
  m add-note --track bass --pitch "$2" --t "$((t+1))"  --dur 0.45 --velocity 74
  m add-note --track bass --pitch "$3" --t "$((t+1)).5" --dur 0.45 --velocity 60
  m add-note --track bass --pitch "$2" --t "$((t+2))"  --dur 0.45 --velocity 80
  m add-note --track bass --pitch "$2" --t "$((t+2)).5" --dur 0.45 --velocity 60
  m add-note --track bass --pitch "$3" --t "$((t+3))"  --dur 0.45 --velocity 72
  m add-note --track bass --pitch "$2" --t "$((t+3)).5" --dur 0.45 --velocity 58
}
bass_bar 0 A1 E2
bass_bar 1 A1 E2
bass_bar 2 F1 C2
bass_bar 3 F1 C2
bass_bar 4 C2 G2
bass_bar 5 C2 G2
bass_bar 6 G1 D2
bass_bar 7 G1 D2

# Pad — open fifths, two bars per chord, entering on each chord change.
m add-note --track pad --pitch A3 --t 0  --dur 8 --velocity 42
m add-note --track pad --pitch E4 --t 0  --dur 8 --velocity 34
m add-note --track pad --pitch F3 --t 8  --dur 8 --velocity 42
m add-note --track pad --pitch C4 --t 8  --dur 8 --velocity 34
m add-note --track pad --pitch C4 --t 16 --dur 8 --velocity 40
m add-note --track pad --pitch G4 --t 16 --dur 8 --velocity 32
m add-note --track pad --pitch G3 --t 24 --dur 8 --velocity 42
m add-note --track pad --pitch D4 --t 24 --dur 8 --velocity 34

# Arp — cold square glints, a sparse off-beat figure once per two bars.
m add-note --track arp --pitch E5 --t 3.5  --dur 0.5 --velocity 48
m add-note --track arp --pitch A5 --t 4    --dur 0.5 --velocity 44
m add-note --track arp --pitch C5 --t 11.5 --dur 0.5 --velocity 48
m add-note --track arp --pitch F5 --t 12   --dur 0.5 --velocity 44
m add-note --track arp --pitch G5 --t 19.5 --dur 0.5 --velocity 46
m add-note --track arp --pitch E5 --t 20   --dur 0.5 --velocity 42
m add-note --track arp --pitch D5 --t 27.5 --dur 0.5 --velocity 48
m add-note --track arp --pitch B4 --t 28   --dur 0.5 --velocity 44

# Kick — a low sine hit on the downbeat of every bar: the shift-clock ticking.
for bar in 0 1 2 3 4 5 6 7; do
  m add-note --track kick --pitch A0 --t $((bar * 4)) --dur 0.3 --velocity 92
done
m render

echo "produced kessler audio under $AUD:"
ls -la "$AUD"
