#!/usr/bin/env bash
# Wick — produce the game's sound with the on-PATH audio tools (specs/assets.md
# "The sound", specs/ui.md "Audio"). The palette is WARM and CANDLELIT: soft
# sines and triangles, FM bells like small brass, wooden knocks, and breathy
# noise puffs, so the fourteen cues and the bed sound like one night.
#
# Production lanes: every cue is pure synth through `sfx-synth` (the contract
# allows `sfx-synth` or `sfx-sample` per cue; the baked sample pack on this
# machine is empty, and the warm palette wants the oscillator control anyway).
# The bed is sequenced with `music` on synth-waveform tracks
# (`define-track --instrument sine|triangle|saw|square`), which the contract
# allows beside the instrument bank.
#
# Loops. `hum` is built to be PERIODIC in its file length: every voice is a
# fixed-frequency oscillator with a flat envelope, no vibrato and no noise, and
# every frequency completes a whole number of cycles in the loop, so the last
# sample runs into the first. The bed's last notes end exactly on the loop
# boundary under a `gate` envelope, whose short fall lands the end sample at
# silence beside the silent first sample, and the reverb-heavy tracks stop
# early enough that their tails have died at the seam. `src/assets.test.ts`
# reads both files back and asserts the seam under 1% of full scale.
#
# Produces, under assets/audio/, exactly the files the contract names:
#   hit.wav           an enemy takes damage (a light wooden tick)
#   kill.wav          an enemy dies (a puff and a low pop, above hit)
#   gem.wav           a gem is collected (a tiny glass chime)
#   hurt.wav          the lamplighter takes damage (a harsh buzzing scrape)
#   level-up.wav      a level-up overlay opens (a rising four-note bell figure)
#   choose.wav        an offer is accepted (a two-tone affirm)
#   chest.wav         a chest opens (a wooden knock, a creak, a chime)
#   evolve.wav        a weapon evolves (a long rising shimmer into bells)
#   pickup.wav        bread or a draft is collected (a soft round blip)
#   fallen.wav        the light goes out (a heavy descending column, dark)
#   dawn.wav          dawn (a bright rising swell into bells, weighty)
#   menu-move.wav     a menu highlight moves (a tiny tick)
#   menu-confirm.wav  a menu item is confirmed (a short two-tone)
#   hum.wav           the Halo / Corona loop (a warm throbbing drone, 3 s)
#   music.wav (+ music.mid)  the bed (36 s, 12 bars at 80 BPM)
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth + music on the PATH, or built
#         under $CARGO_TARGET_DIR).
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
# The tools write their scratch (the op log, the preview) beside the config, so
# every path is absolute and the work happens in the scratch directory.
cd "$TMP"
CFG="$TMP/cfg.json"

# --- sfx-synth helpers -------------------------------------------------------
# newsfx <channels> <max_ms> <out.wav> : seed a fresh synth run (empty op log).
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 1717, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }
# tail <ms> : the render ends where the last voice ends, which would cut a
# room or a delay off mid-ring, so a cue with a tail carries one inaudible
# voice (-96 dB) held to the length the tail needs.
tail() { x add-voice --name tail --wave sine --freq 30 --gain -96 --start 0 --dur "$1"; }

# --- music helpers (synth-waveform tracks; no instrument bank) --------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 1717, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# =================================== HIT =====================================
# An enemy takes damage. The most frequent cue late in the night, so it is
# short, light, and dry: a wooden triangle tick dipping a fourth, a breath of
# high noise on top, and no tail.
newsfx mono 100 "$AUD/hit.wav"
x add-voice --name tick --wave triangle --freq 740 --gain -9 --start 0 --dur 70
x set-envelope --voice tick --env pluck
x set-pitch --voice tick --slide-to 520 --over 60
x add-voice --name breath --wave noise --gain -19 --start 0 --dur 25
x set-envelope --voice breath --env pluck
x add-filter --voice breath --type highpass --cutoff 3200 --resonance 1.0
x render

# =================================== KILL ====================================
# An enemy dies: the same family as hit but one degree heavier, a soft puff
# of noise over a low pop that falls away. Sits above hit by weight and
# length, and stays under a fifth of a second.
newsfx mono 220 "$AUD/kill.wav"
x add-voice --name pop --wave saw --freq 420 --gain -9 --start 0 --dur 140
x set-envelope --voice pop --env pluck
x set-pitch --voice pop --slide-to 140 --over 120
x add-voice --name body --wave sine --freq 180 --gain -8 --start 0 --dur 80
x set-envelope --voice body --attack 1 --decay 60 --sustain 0.3 --release 60
x set-pitch --voice body --slide-to 90 --over 110
x add-voice --name puff --wave noise --gain -13 --start 0 --dur 70
x set-envelope --voice puff --env pluck
x add-filter --voice puff --type bandpass --cutoff 1800 --resonance 1.2
x add-filter --bus master --type lowpass --cutoff 6000 --resonance 0.8
tail 220
x render

# =================================== GEM =====================================
# A gem is collected, many times a second late on: a tiny glass chime rising a
# fourth, with a sparkle, and nothing below it to build up in a crowd.
newsfx mono 120 "$AUD/gem.wav"
x add-voice --name chime --wave sine --freq 1568 --gain -10 --start 0 --dur 85
x set-envelope --voice chime --env pluck
x set-pitch --voice chime --slide-to 2093 --over 60
x add-voice --name sparkle --wave sine --freq 3136 --gain -19 --start 10 --dur 45
x set-envelope --voice sparkle --env pluck
x render

# =================================== HURT ====================================
# The lamplighter takes damage: unmistakable in a crowd of the others, since
# nothing else in the set buzzes. A ring-modulated square scraping down an
# octave through distortion, with a mid noise slap under it.
newsfx mono 340 "$AUD/hurt.wav"
x add-voice --name scrape --wave square --freq 196 --gain -7 --start 0 --dur 200
x set-envelope --voice scrape --attack 1 --decay 120 --sustain 0.45 --release 120
x set-pitch --voice scrape --slide-to 98 --over 240
x add-ringmod --voice scrape --freq 47
x add-distortion --voice scrape --drive 1.8
x add-voice --name slap --wave noise --gain -11 --start 0 --dur 90
x set-envelope --voice slap --env pluck
x add-filter --voice slap --type bandpass --cutoff 900 --resonance 1.4
x add-filter --bus master --type lowpass --cutoff 4800 --resonance 0.9
tail 340
x render

# ================================= LEVEL-UP ==================================
# The lamp burns brighter: a rising four-note bell figure (D5 F5 A5 D6) on
# soft FM bells, with a short delay and a warm room, the brightest of the
# short cues.
newsfx stereo 1200 "$AUD/level-up.wav"
x add-voice --name b1 --wave sine --freq 587 --gain -9 --start 0 --dur 260 --pan -0.15
x set-envelope --voice b1 --env pluck
x add-fm --voice b1 --modulator 3 --index 1.2
x add-voice --name b2 --wave sine --freq 698 --gain -9 --start 110 --dur 280 --pan -0.05
x set-envelope --voice b2 --env pluck
x add-fm --voice b2 --modulator 3 --index 1.2
x add-voice --name b3 --wave sine --freq 880 --gain -8 --start 220 --dur 320 --pan 0.05
x set-envelope --voice b3 --env pluck
x add-fm --voice b3 --modulator 3 --index 1.2
x add-voice --name b4 --wave sine --freq 1175 --gain -7 --start 340 --dur 520 --pan 0.15
x set-envelope --voice b4 --env pluck
x add-fm --voice b4 --modulator 3 --index 1.0
x add-voice --name glow --wave triangle --freq 294 --gain -16 --start 300 --dur 560
x set-envelope --voice glow --env swell
x add-delay --bus master --time 150 --feedback 0.25 --mix 0.18
x add-reverb --bus master --size 0.4 --mix 0.2
tail 1200
x render

# ================================== CHOOSE ===================================
# An offer is accepted: a clean two-tone affirm (G5 then D6), one degree
# fuller than the menu confirm and a fifth apart from it.
newsfx mono 380 "$AUD/choose.wav"
x add-voice --name t1 --wave triangle --freq 784 --gain -8 --start 0 --dur 110
x set-envelope --voice t1 --env pluck
x add-voice --name t2 --wave triangle --freq 1175 --gain -7 --start 90 --dur 180
x set-envelope --voice t2 --env pluck
x add-voice --name under --wave sine --freq 392 --gain -14 --start 90 --dur 160
x set-envelope --voice under --env pluck
x add-reverb --bus master --size 0.25 --mix 0.1
tail 380
x render

# =================================== CHEST ===================================
# A chest opens: a wooden knock, a creaking lid (a slow saw sag with grit),
# then a bright brass chime as the lid lands open.
newsfx stereo 1350 "$AUD/chest.wav"
x add-voice --name knock --wave triangle --freq 220 --gain -7 --start 0 --dur 90
x set-envelope --voice knock --env punch
x set-pitch --voice knock --slide-to 140 --over 80
x add-voice --name thock --wave noise --gain -14 --start 0 --dur 40
x set-envelope --voice thock --env pluck
x add-filter --voice thock --type lowpass --cutoff 900 --resonance 1.2
x add-voice --name creak --wave saw --freq 130 --gain -14 --start 80 --dur 320 --pan -0.15
x set-envelope --voice creak --attack 30 --decay 120 --sustain 0.6 --release 140
x set-pitch --voice creak --slide-to 92 --over 300
x add-bitcrush --voice creak --bits 6 --rate 9000
x add-filter --voice creak --type bandpass --cutoff 700 --resonance 1.6
x add-voice --name chime --wave sine --freq 1046 --gain -9 --start 420 --dur 480 --pan 0.15
x set-envelope --voice chime --env pluck
x add-fm --voice chime --modulator 3.5 --index 1.6
x add-voice --name chime2 --wave sine --freq 1568 --gain -14 --start 470 --dur 420 --pan 0.25
x set-envelope --voice chime2 --env pluck
x add-fm --voice chime2 --modulator 3.5 --index 1.2
x add-reverb --bus master --size 0.35 --mix 0.16
tail 1350
x render

# ================================== EVOLVE ===================================
# A weapon evolves: the biggest of the short cues, a long shimmer rising two
# octaves into a spread of bells (D6 A6 D7), with a delay and a large room.
newsfx stereo 2500 "$AUD/evolve.wav"
x add-voice --name rise --wave sine --freq 220 --gain -10 --start 0 --dur 900
x set-envelope --voice rise --attack 60 --decay 200 --sustain 0.8 --release 300
x set-pitch --voice rise --slide-to 1760 --over 880
x add-voice --name rise2 --wave saw --freq 440 --gain -18 --start 0 --dur 900 --pan -0.2
x set-envelope --voice rise2 --attack 80 --decay 200 --sustain 0.7 --release 300
x set-pitch --voice rise2 --slide-to 880 --over 880
x add-filter --voice rise2 --type lowpass --cutoff 1200 --sweep-to 5000 --over 900 --resonance 1.4
x add-voice --name shimmer --wave noise --gain -20 --start 200 --dur 700 --pan 0.2
x set-envelope --voice shimmer --env swell
x add-filter --voice shimmer --type highpass --cutoff 5000 --resonance 1.0
x add-voice --name b1 --wave sine --freq 1175 --gain -8 --start 800 --dur 700 --pan -0.2
x set-envelope --voice b1 --env pluck
x add-fm --voice b1 --modulator 3.5 --index 1.4
x add-voice --name b2 --wave sine --freq 1760 --gain -9 --start 950 --dur 650 --pan 0.1
x set-envelope --voice b2 --env pluck
x add-fm --voice b2 --modulator 3.5 --index 1.2
x add-voice --name b3 --wave sine --freq 2349 --gain -11 --start 1100 --dur 560 --pan 0.25
x set-envelope --voice b3 --env pluck
x add-fm --voice b3 --modulator 3.5 --index 1.0
x add-voice --name warm --wave triangle --freq 294 --gain -13 --start 800 --dur 800
x set-envelope --voice warm --env swell
x add-delay --bus master --time 190 --feedback 0.3 --mix 0.2
x add-reverb --bus master --size 0.55 --mix 0.24
tail 2500
x render

# ================================== PICKUP ===================================
# Bread or a draft is collected: a soft, round blip, lower and warmer than the
# gem chime so the two are never confused, a triangle stepping up a third
# over a sine under it.
newsfx mono 260 "$AUD/pickup.wav"
x add-voice --name blip --wave triangle --freq 523 --gain -8 --start 0 --dur 170
x set-envelope --voice blip --env pluck
x set-pitch --voice blip --slide-to 659 --over 90
x add-voice --name under --wave sine --freq 392 --gain -12 --start 0 --dur 140
x set-envelope --voice under --env pluck
x add-filter --bus master --type lowpass --cutoff 3600 --resonance 0.8
x render

# ================================== FALLEN ===================================
# The light went out: the heaviest, darkest sound in the game. A saw column
# sagging two octaves over a sub, a slow noise swell, and one dark toll,
# under a low-pass and a long room. Clearly longer and lower than every cue.
newsfx stereo 3800 "$AUD/fallen.wav"
x add-voice --name column --wave saw --freq 130 --gain -7 --start 0 --dur 2200
x set-envelope --voice column --attack 40 --decay 500 --sustain 0.55 --release 700
x set-pitch --voice column --slide-to 33 --over 2100
x add-voice --name sub --wave sine --freq 65 --gain -5 --start 0 --dur 2300
x set-envelope --voice sub --attack 60 --decay 0 --sustain 1 --release 600
x set-pitch --voice sub --slide-to 27 --over 2200
x add-voice --name gust --wave noise --gain -17 --start 200 --dur 1600 --pan 0.1
x set-envelope --voice gust --env swell
x add-filter --voice gust --type lowpass --cutoff 900 --resonance 0.9
x add-voice --name toll --wave sine --freq 220 --gain -13 --start 900 --dur 1300 --pan -0.12
x set-envelope --voice toll --env pluck
x add-fm --voice toll --modulator 1.4 --index 1.5
x add-filter --bus master --type lowpass --cutoff 2200 --resonance 0.7
x add-reverb --bus master --size 0.65 --mix 0.26
tail 3800
x render

# =================================== DAWN ====================================
# Dawn: the other ending, as weighty as fallen and told from it by ear at
# once, since it rises and is bright where fallen sinks and is dark. An F
# major swell (F3 A3 C4 F4) growing under a sine climbing an octave, morning
# air as high noise, and three bells (C6 F6 A6) landing on top, in a large
# room with a slow delay.
newsfx stereo 4400 "$AUD/dawn.wav"
x add-voice --name p1 --wave triangle --freq 175 --gain -9 --start 0 --dur 2600
x set-envelope --voice p1 --attack 500 --decay 600 --sustain 0.8 --release 900
x add-voice --name p2 --wave sine --freq 220 --gain -11 --start 0 --dur 2600 --pan -0.15
x set-envelope --voice p2 --attack 600 --decay 600 --sustain 0.8 --release 900
x add-voice --name p3 --wave sine --freq 262 --gain -12 --start 0 --dur 2600 --pan 0.15
x set-envelope --voice p3 --attack 700 --decay 600 --sustain 0.8 --release 900
x add-voice --name p4 --wave triangle --freq 349 --gain -14 --start 200 --dur 2400
x set-envelope --voice p4 --attack 800 --decay 600 --sustain 0.8 --release 900
x add-voice --name climb --wave sine --freq 262 --gain -12 --start 0 --dur 1500
x set-envelope --voice climb --attack 200 --decay 400 --sustain 0.7 --release 500
x set-pitch --voice climb --slide-to 523 --over 1400
x add-voice --name air --wave noise --gain -22 --start 300 --dur 2200 --pan 0.2
x set-envelope --voice air --env swell
x add-filter --voice air --type highpass --cutoff 3000 --resonance 1.0
x add-voice --name b1 --wave sine --freq 1046 --gain -9 --start 900 --dur 900 --pan -0.2
x set-envelope --voice b1 --env pluck
x add-fm --voice b1 --modulator 3.5 --index 1.3
x add-voice --name b2 --wave sine --freq 1397 --gain -9 --start 1400 --dur 900 --pan 0.1
x set-envelope --voice b2 --env pluck
x add-fm --voice b2 --modulator 3.5 --index 1.2
x add-voice --name b3 --wave sine --freq 1760 --gain -8 --start 1900 --dur 1200 --pan 0.25
x set-envelope --voice b3 --env pluck
x add-fm --voice b3 --modulator 3.5 --index 1.0
x add-delay --bus master --time 250 --feedback 0.3 --mix 0.18
x add-reverb --bus master --size 0.7 --mix 0.28
tail 4400
x render

# ================================= MENU MOVE =================================
# A menu highlight moves: a tiny wooden tick, nothing more, so working a menu
# never crowds the bed.
newsfx mono 100 "$AUD/menu-move.wav"
x add-voice --name tick --wave triangle --freq 1046 --gain -12 --start 0 --dur 70
x set-envelope --voice tick --env pluck
x add-voice --name click --wave noise --gain -20 --start 0 --dur 20
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 6000 --resonance 1.0
x render

# =============================== MENU CONFIRM ================================
# A menu item is confirmed: one degree heavier than the move, a short
# two-tone (E5 then B5), still short and light.
newsfx mono 340 "$AUD/menu-confirm.wav"
x add-voice --name t1 --wave sine --freq 659 --gain -9 --start 0 --dur 90
x set-envelope --voice t1 --env pluck
x add-voice --name t2 --wave sine --freq 988 --gain -8 --start 75 --dur 160
x set-envelope --voice t2 --env pluck
x add-reverb --bus master --size 0.2 --mix 0.08
tail 340
x render

# =================================== HUM =====================================
# The Halo / Corona loop, 3 s: a warm throbbing drone that sits under the
# bed. Periodic by construction, so it loops with no seam: every voice holds
# a fixed frequency under a flat envelope and completes a whole number of
# cycles in 3000 ms (55 x 3 = 165, 110 x 3 = 330, 110.333 x 3 = 331, 165 x 3
# = 495, 220 x 3 = 660). The 1/3 Hz gap between the two 110 Hz voices beats
# once per loop, which is the throb. The seam's only residue is one sample of
# each sine's slope at its zero crossing, so the file is kept quiet (the game
# sets the loop's level) to hold that residue well under 1% of full scale.
newsfx stereo 3000 "$AUD/hum.wav"
x add-voice --name sub --wave sine --freq 55 --gain -17 --start 0 --dur 3000
x set-envelope --voice sub --attack 0 --decay 0 --sustain 1 --release 0
x add-voice --name root --wave sine --freq 110 --gain -19 --start 0 --dur 3000 --pan -0.2
x set-envelope --voice root --attack 0 --decay 0 --sustain 1 --release 0
x add-voice --name beat --wave sine --freq 110.333333 --gain -21 --start 0 --dur 3000 --pan 0.2
x set-envelope --voice beat --attack 0 --decay 0 --sustain 1 --release 0
x add-voice --name fifth --wave triangle --freq 165 --gain -30 --start 0 --dur 3000
x set-envelope --voice fifth --attack 0 --decay 0 --sustain 1 --release 0
x add-voice --name glow --wave sine --freq 220 --gain -28 --start 0 --dur 3000
x set-envelope --voice glow --attack 0 --decay 0 --sustain 1 --release 0
x add-fm --voice glow --modulator 2 --index 0.8
x render

# =================================== MUSIC ===================================
# The bed: 36 s, 12 bars of 4/4 at 80 BPM (a beat is 750 ms, 48 beats fill
# 36000 ms exactly), a slow lullaby in D minor that stays welcome for ten
# minutes: a sine drone on the roots, a triangle pad of open chord tones
# swelling in, a soft low pulse on each bar, a sparse bell melody, and a
# quiet square arpeggio under it for motion. Two bars per chord: Dm, Bb, F,
# C, Gm, A, and back to Dm at the seam.
#
# The seam: the drone and the pulse end exactly on beat 48 under `gate`
# envelopes, whose short fall lands the last sample at silence beside the
# silent first sample; the bells and the arpeggio, which carry the reverb,
# end at least a beat before it so their tails have died.
newmusic 36000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 80
m set-time-signature --num 4 --den 4
m define-track --name drone --instrument sine
m define-track --name pad   --instrument triangle
m define-track --name pulse --instrument sine
m define-track --name bell  --instrument sine
m define-track --name arp   --instrument square
m set-track-fx --track drone --gain -9  --reverb 0.1  --env gate  --pan 0.0
m set-track-fx --track pad   --gain -17 --reverb 0.35 --env swell --pan 0.0
m set-track-fx --track pulse --gain -10 --reverb 0.1  --env gate  --pan 0.0
m set-track-fx --track bell  --gain -16 --reverb 0.5  --env pluck --pan 0.2
m set-track-fx --track arp   --gain -24 --reverb 0.3  --env pluck --pan -0.2

# Drone: the root of each chord, eight beats each, filling the file exactly.
m add-note --track drone --pitch D2  --t 0  --dur 8 --velocity 70
m add-note --track drone --pitch Bb1 --t 8  --dur 8 --velocity 68
m add-note --track drone --pitch F2  --t 16 --dur 8 --velocity 66
m add-note --track drone --pitch C2  --t 24 --dur 8 --velocity 68
m add-note --track drone --pitch G1  --t 32 --dur 8 --velocity 70
m add-note --track drone --pitch A1  --t 40 --dur 8 --velocity 70

# Pad: the third and fifth of each chord, swelling in over the drone.
m add-note --track pad --pitch F3 --t 0  --dur 8 --velocity 40
m add-note --track pad --pitch A3 --t 0  --dur 8 --velocity 34
m add-note --track pad --pitch D3 --t 8  --dur 8 --velocity 40
m add-note --track pad --pitch F3 --t 8  --dur 8 --velocity 34
m add-note --track pad --pitch A3 --t 16 --dur 8 --velocity 38
m add-note --track pad --pitch C4 --t 16 --dur 8 --velocity 32
m add-note --track pad --pitch E3 --t 24 --dur 8 --velocity 40
m add-note --track pad --pitch G3 --t 24 --dur 8 --velocity 34
m add-note --track pad --pitch Bb3 --t 32 --dur 8 --velocity 38
m add-note --track pad --pitch D4 --t 32 --dur 8 --velocity 32
m add-note --track pad --pitch C#3 --t 40 --dur 7 --velocity 40
m add-note --track pad --pitch E3  --t 40 --dur 7 --velocity 34

# Pulse: a soft low thud on the first beat of every bar, the night's slow
# heartbeat, the last one ending on the seam.
pulse() { m add-note --track pulse --pitch "$2" --t "$1" --dur 0.5 --velocity 78; }
pulse 0  D1;  pulse 4  D1
pulse 8  Bb0; pulse 12 Bb0
pulse 16 F1;  pulse 20 F1
pulse 24 C1;  pulse 28 C1
pulse 32 G1;  pulse 36 G1
pulse 40 A1;  pulse 44 A1
m add-note --track pulse --pitch A1 --t 47.5 --dur 0.5 --velocity 60

# Bell: a sparse melody, one phrase per two bars, never on the downbeat of
# the file and ending a beat and a half before the seam.
bell() { m add-note --track bell --pitch "$2" --t "$1" --dur "$3" --velocity "$4"; }
bell 1    A4 1.5 56;  bell 3    F4 1   50;  bell 5.5  D5 2   58
bell 9    F4 1.5 54;  bell 11   D4 1   48;  bell 13.5 F4 2   52
bell 17   C5 1.5 56;  bell 19   A4 1   50;  bell 21.5 F4 2   54
bell 25   E4 1.5 52;  bell 27   G4 1   48;  bell 29.5 C5 2   56
bell 33   D5 1.5 56;  bell 35   Bb4 1  50;  bell 37.5 G4 2   52
bell 41   A4 1.5 54;  bell 43   C#5 1  50;  bell 44.5 E5 2   50

# Arp: a quiet square figure on the off-beats of every bar, root, fifth,
# octave, fifth, ending a beat before the seam.
arp() { # <bar start beat> <root> <fifth> <octave>
  m add-note --track arp --pitch "$2" --t "$1.5" --dur 0.4 --velocity 44
  m add-note --track arp --pitch "$3" --t "$(( $1 + 1 )).5" --dur 0.4 --velocity 40
  m add-note --track arp --pitch "$4" --t "$(( $1 + 2 )).5" --dur 0.4 --velocity 42
  m add-note --track arp --pitch "$3" --t "$(( $1 + 3 )).5" --dur 0.4 --velocity 38
}
arp 0  D3 A3 D4;  arp 4  D3 A3 D4
arp 8  Bb2 F3 Bb3; arp 12 Bb2 F3 Bb3
arp 16 F3 C4 F4;  arp 20 F3 C4 F4
arp 24 C3 G3 C4;  arp 28 C3 G3 C4
arp 32 G2 D3 G3;  arp 36 G2 D3 G3
arp 40 A2 E3 A3
m add-note --track arp --pitch A2 --t 44.5 --dur 0.4 --velocity 44
m add-note --track arp --pitch E3 --t 45.5 --dur 0.4 --velocity 40
m add-note --track arp --pitch A3 --t 46.5 --dur 0.4 --velocity 42
m render

echo "produced wick audio under $AUD:"
ls -la "$AUD"
