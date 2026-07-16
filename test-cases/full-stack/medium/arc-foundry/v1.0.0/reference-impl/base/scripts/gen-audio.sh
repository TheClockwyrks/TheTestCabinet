#!/usr/bin/env bash
# Arc Foundry — produce the yard's AUDIO with the on-PATH audio tools (specs/assets.md §Audio).
#
# Everything here is PURE SYNTH: in this run image the baked `sfx-sample` pack is EMPTY
# (`sfx-sample list-samples` → "no samples") and the `music` instrument bank has no bank
# instruments, so every SFX is authored with `sfx-synth` (oscillator/noise voices) and the
# reactor bed uses `music` synth-waveform tracks only (`define-track --instrument
# sine|square|saw|triangle` — never a bank instrument name). The palette of the sound is
# ELECTRO-INDUSTRIAL: cold, electric, metallic, tense — arcs, presses, and a driving reactor
# drone (specs/overview.md "electro-industrial").
#
# Produces, under assets/audio/, exactly the cues the game loads (src/assets.ts CUE_SOURCE):
#   stamp.wav   — press/stamp clunk           (scrap-press stamps a component; specs/build.md)
#   zap.wav     — sharp zap                    (Capacitor / Emitter single bolt; specs/towers.md)
#   chain.wav   — crackling chain              (Coil chain-lightning; specs/towers.md)
#   discharge.wav — heavy discharge boom       (Arc-Node / Discharge Rig; specs/towers.md)
#   combine.wav — rising combine chime         (quality ladder climbs; specs/build.md)
#   kill.wav    — ground-out pop               (a unit is destroyed; specs/enemies.md)
#   leak.wav    — leak alarm                   (a unit grounds out, Grid Integrity drops; flow.md)
#   settle.wav  — rock-settle thunk            (unkept rocks harden into blockers; specs/build.md)
#   slow.wav    — icy hum                      (a Choke / slow combo slows a unit; specs/towers.md)
#   burn.wav    — overcurrent sizzle           (a Rectifier / burn combo's DoT ticks; specs/towers.md)
#   music.wav (+ music.mid) — the tense electro-industrial reactor bed, looped under the board
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
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 1337, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- music helpers ------------------------------------------------------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 1337, "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ================================= STAMP ======================================
# The scrap-press SLAMMING a component into being: a hydraulic industrial stamp. A low
# sine THUMP body (the press bottoming out), a metallic FM/ringmod CLANG (steel-on-steel
# of the die), and a highpassed noise CONTACT crack — all fast and dry, a touch of
# bitcrush for the grimy machine grit. Reads heavy and mechanical, not soft.
newsfx mono 360 "$AUD/stamp.wav"
x add-voice --name thump --wave sine --freq 150 --gain -3 --start 0 --dur 200
x set-envelope --voice thump --env punch
x set-pitch --voice thump --slide-to 62 --over 170
x add-voice --name clang --wave square --freq 320 --gain -9 --start 6 --dur 150
x set-envelope --voice clang --env pluck
x add-fm --voice clang --carrier 1 --modulator 2.7 --index 6
x set-pitch --voice clang --slide-to 190 --over 140
x add-voice --name contact --wave noise --gain -8 --start 0 --dur 40
x set-envelope --voice contact --env pluck
x add-filter --voice contact --type highpass --cutoff 2600 --resonance 1.1
x add-bitcrush --bus master --bits 10 --rate 18000
x add-reverb --bus master --size 0.24 --mix 0.08
x render

# ================================== ZAP =======================================
# The sharp single-bolt ELECTRIC ZAP of a Capacitor / Emitter: a bright, snapping spark
# that fires fast and often. A saw core swept STEEPLY downward (the bolt's crack), a
# ringmod for the inharmonic electric buzz, and a highpassed noise SIZZLE transient.
# Bitcrushed a little so it reads digital-electric, not tonal.
newsfx stereo 220 "$AUD/zap.wav"
x add-voice --name bolt --wave saw --freq 1600 --gain -6 --start 0 --dur 120 --pan 0.0
x set-envelope --voice bolt --env pluck
x set-pitch --voice bolt --slide-to 420 --over 110
x add-ringmod --voice bolt --freq 90
x add-voice --name sizzle --wave noise --gain -10 --start 0 --dur 70
x set-envelope --voice sizzle --env pluck
x add-filter --voice sizzle --type highpass --cutoff 3400 --resonance 1.4
x add-bitcrush --bus master --bits 9 --rate 21000
x add-reverb --bus master --size 0.28 --mix 0.1
x render

# ================================= CHAIN ======================================
# The Coil's CHAIN-LIGHTNING crackle: forked electricity LEAPING between units, dimming
# per jump. A bandpassed noise CRACKLE fed through a feedback delay so it retriggers as a
# string of receding taps (the "chain" of leaps), a ringmodded saw giving the arcs their
# electric pitch, sweeping down as the chain runs out of charge. Restless and sputtering.
newsfx stereo 620 "$AUD/chain.wav"
x add-voice --name arc --wave saw --freq 900 --gain -7 --start 0 --dur 260 --pan -0.1
x set-envelope --voice arc --attack 2 --decay 120 --sustain 0.3 --release 160
x set-pitch --voice arc --slide-to 340 --over 420
x add-ringmod --voice arc --freq 140
x add-voice --name crackle --wave noise --gain -6 --start 0 --dur 300 --pan 0.1
x set-envelope --voice crackle --attack 2 --decay 90 --sustain 0.35 --release 200
x add-filter --voice crackle --type bandpass --cutoff 1900 --sweep-to 900 --over 400 --resonance 2.6
x add-delay --bus master --time 74 --feedback 0.52 --mix 0.42
x add-distortion --bus master --drive 1.5
x add-reverb --bus master --size 0.4 --mix 0.16
x render

# =============================== DISCHARGE ====================================
# The Arc-Node / Discharge Rig DISCHARGE BOOM — the fat, violent bank-dump the Rig throws
# (specs/towers.md: fatter and more violent than a Capacitor bolt). A deep sine SUB with a
# punch body, a distorted saw CORE swept down for the crack, and a big noise BLAST. Longer
# tail and heavier reverb so it lands with weight — the heaviest cue in the yard.
newsfx stereo 780 "$AUD/discharge.wav"
x add-voice --name sub --wave sine --freq 110 --gain -2 --start 0 --dur 380
x set-envelope --voice sub --env punch
x set-pitch --voice sub --slide-to 45 --over 320
x add-voice --name core --wave saw --freq 520 --gain -6 --start 0 --dur 280 --pan 0.0
x set-envelope --voice core --env punch
x set-pitch --voice core --slide-to 150 --over 240
x add-ringmod --voice core --freq 70
x add-voice --name blast --wave noise --gain -5 --start 0 --dur 200
x set-envelope --voice blast --env pluck
x add-filter --voice blast --type lowpass --cutoff 3600 --sweep-to 900 --over 240 --resonance 1.4
x add-distortion --bus master --drive 2.0
x add-reverb --bus master --size 0.55 --mix 0.22
x render

# ================================= COMBINE ====================================
# The COMBINE CHIME — two components converging up the quality ladder into a higher tier
# (specs/build.md). A brilliant RISING sweep and a bright triad that climbs and rings out:
# the payoff read. Sine/triangle voices arpeggiating UP (the ladder climbing) plus a saw
# glissando that whooshes up into them, sweetened by a feedback delay + reverb so it
# sparkles. Electric and triumphant, not a soft bell.
newsfx stereo 1100 "$AUD/combine.wav"
x add-voice --name swoop --wave saw --freq 300 --gain -12 --start 0 --dur 260
x set-envelope --voice swoop --env swell
x set-pitch --voice swoop --slide-to 1200 --over 240
x add-voice --name c1 --wave sine --freq 784 --gain -6 --start 120 --dur 300 --pan -0.15
x set-envelope --voice c1 --env pluck
x add-voice --name c2 --wave sine --freq 1046 --gain -6 --start 200 --dur 320 --pan 0.05
x set-envelope --voice c2 --env pluck
x add-voice --name c3 --wave triangle --freq 1568 --gain -5 --start 290 --dur 460 --pan 0.2
x set-envelope --voice c3 --env pluck
x add-voice --name shimmer --wave sine --freq 2093 --gain -14 --start 300 --dur 420
x set-envelope --voice shimmer --env pluck
x add-delay --bus master --time 150 --feedback 0.34 --mix 0.28
x add-reverb --bus master --size 0.55 --mix 0.24
x render

# =================================== KILL =====================================
# The ground-out POP when a unit is destroyed (specs/enemies.md): a small, sharp electrical
# pop and fizzle. A fast square BLIP dropping in pitch (the charge collapsing) and a short
# highpassed noise SPIT. Quick and cheap — it fires many times a wave, so it stays small
# and dry.
newsfx mono 200 "$AUD/kill.wav"
x add-voice --name blip --wave square --freq 620 --gain -7 --start 0 --dur 90
x set-envelope --voice blip --env pluck
x set-pitch --voice blip --slide-to 160 --over 85
x add-ringmod --voice blip --freq 120
x add-voice --name spit --wave noise --gain -9 --start 0 --dur 60
x set-envelope --voice spit --env pluck
x add-filter --voice spit --type highpass --cutoff 2400 --resonance 1.2
x add-bitcrush --bus master --bits 8 --rate 16000
x add-reverb --bus master --size 0.22 --mix 0.08
x render

# =================================== LEAK =====================================
# The LEAK ALARM — a unit reached the Collector and grounded out; Grid Integrity DROPS
# (specs/flow.md). This is the "you took damage" read: a tense, rasping two-tone klaxon
# SURGE that sags downward, driven through distortion with a buzzing vibrato, then a lower
# repeat for insistence. The most alarming cue — deliberately urgent.
newsfx stereo 1000 "$AUD/leak.wav"
leak_surge() { # <start> <base> <to> <pan>
  local s="$1" b="$2" t="$3" p="$4"
  x add-voice --name "sq_$s" --wave square --freq "$b" --gain -5 --start "$s" --dur 360 --pan "$p"
  x set-envelope --voice "sq_$s" --env gate
  x set-pitch --voice "sq_$s" --slide-to "$t" --over 330
  x add-vibrato --voice "sq_$s" --rate 12 --depth 0.6
  x add-voice --name "sw_$s" --wave saw --freq "$b" --gain -12 --start "$s" --dur 360 --pan "$p"
  x set-envelope --voice "sw_$s" --env gate
  x set-pitch --voice "sw_$s" --slide-to "$t" --over 330
}
leak_surge 0   523 392 -0.2
leak_surge 460 392 294  0.2
x add-voice --name sub --wave sine --freq 70 --gain -8 --start 0 --dur 900
x set-envelope --voice sub --attack 40 --decay 0 --sustain 1 --release 300
x add-distortion --bus master --drive 1.7
x add-reverb --bus master --size 0.34 --mix 0.14
x render

# ================================== SETTLE ====================================
# The ROCK-SETTLE THUNK — unkept rocks hardening into blockers (specs/build.md): it must read as
# DEAD, no glow, no ring. A dull, damped low sine THUD with a short lowpassed noise scrape,
# heavily lowpassed so there is no bright electric character left — the sound of something
# going inert. Short and lifeless by design.
newsfx mono 300 "$AUD/settle.wav"
x add-voice --name thud --wave sine --freq 120 --gain -4 --start 0 --dur 200
x set-envelope --voice thud --env punch
x set-pitch --voice thud --slide-to 58 --over 180
x add-voice --name scrape --wave noise --gain -13 --start 0 --dur 120
x set-envelope --voice scrape --env pluck
x add-filter --voice scrape --type lowpass --cutoff 700 --resonance 1.0
x add-filter --bus master --type lowpass --cutoff 900 --resonance 0.7
x add-reverb --bus master --size 0.3 --mix 0.1
x render

# =================================== SLOW =====================================
# The ICY HUM when a Choke (or a slow combo) lands its drag on a unit (specs/towers.md): a
# cold EM shimmer, not a zap. A pair of high triangle/sine tones swelling in and sagging
# gently downward (the "slowed" glide), sweetened with a ring-mod for the inharmonic EM
# shimmer and a slow vibrato so it glistens, plus an airy highpassed frost transient. A
# highpassed master keeps it thin and glassy. Choke blue #66d9e8 in sound: cold, shimmering.
newsfx stereo 820 "$AUD/slow.wav"
x add-voice --name hum1 --wave triangle --freq 1046 --gain -8 --start 0 --dur 520 --pan -0.15
x set-envelope --voice hum1 --env swell
x set-pitch --voice hum1 --slide-to 860 --over 480
x add-vibrato --voice hum1 --rate 7 --depth 0.4
x add-ringmod --voice hum1 --freq 220
x add-voice --name hum2 --wave sine --freq 1568 --gain -11 --start 30 --dur 500 --pan 0.15
x set-envelope --voice hum2 --env swell
x set-pitch --voice hum2 --slide-to 1320 --over 460
x add-vibrato --voice hum2 --rate 6 --depth 0.35
x add-voice --name shimmer --wave sine --freq 2093 --gain -16 --start 40 --dur 440
x set-envelope --voice shimmer --env swell
x add-voice --name frost --wave noise --gain -14 --start 0 --dur 180
x set-envelope --voice frost --env pluck
x add-filter --voice frost --type highpass --cutoff 4200 --resonance 1.6
x add-filter --bus master --type highpass --cutoff 520 --resonance 0.7
x add-reverb --bus master --size 0.5 --mix 0.22
x render

# =================================== BURN =====================================
# The overcurrent SIZZLE while a Rectifier (or burn combo) DoT keeps ticking (specs/towers.md):
# a crackling electric fry, not a one-shot pop. A sustained bandpassed noise SIZZLE whose
# filter sweeps down as it burns, a highpassed CRACKLE fed through a short feedback delay so
# it retriggers as a string of ticks (the DoT keeping on), and a low ring-modded saw EMBER
# buzz underneath. Soft-clip distortion gives it the frying grit. Rectifier orange #ff6b3d.
newsfx stereo 720 "$AUD/burn.wav"
x add-voice --name sizzle --wave noise --gain -6 --start 0 --dur 560 --pan -0.1
x set-envelope --voice sizzle --attack 8 --decay 200 --sustain 0.4 --release 260
x add-filter --voice sizzle --type bandpass --cutoff 3200 --sweep-to 1800 --over 500 --resonance 2.4
x add-voice --name crackle --wave noise --gain -9 --start 30 --dur 520 --pan 0.1
x set-envelope --voice crackle --attack 4 --decay 120 --sustain 0.3 --release 200
x add-filter --voice crackle --type highpass --cutoff 2600 --resonance 1.3
x add-voice --name ember --wave saw --freq 220 --gain -14 --start 0 --dur 500
x set-envelope --voice ember --env swell
x set-pitch --voice ember --slide-to 150 --over 460
x add-ringmod --voice ember --freq 55
x add-delay --bus master --time 60 --feedback 0.4 --mix 0.3
x add-distortion --bus master --drive 1.6
x add-filter --bus master --type lowpass --cutoff 5200 --resonance 0.8
x add-reverb --bus master --size 0.3 --mix 0.12
x render

# ================================== MUSIC =====================================
# The tense, driving INDUSTRIAL-ELECTRO REACTOR BED — a low, atmospheric loop under the
# board (specs/assets.md "Music"). SYNTH-WAVEFORM tracks only (the bank is empty). In A
# MINOR, dark and relentless: a low sine DRONE holding the harmonic floor, a saw BASS
# pumping steady driving eighth-notes (the reactor's pulse), a square PULSE arpeggio
# ticking like machinery, and a sparse saw LEAD tracing a cold, tense motif over the top.
# `music` emits both music.wav (the looped asset) and music.mid (portable companion score).
# 128 BPM, 16 beats (four bars) — a clean, seamless loop.  Chords: Am · F · G · Em.
newmusic 30000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 128
m set-time-signature --num 4 --den 4
m define-track --name drone --instrument sine
m define-track --name bass  --instrument saw
m define-track --name pulse --instrument square
m define-track --name lead  --instrument saw
m set-track-fx --track drone --gain -9  --reverb 0.5  --env swell --pan 0.0
m set-track-fx --track bass  --gain -4  --reverb 0.12 --env punch --pan 0.0
m set-track-fx --track pulse --gain -14 --reverb 0.35 --env pluck --pan 0.25
m set-track-fx --track lead  --gain -11 --reverb 0.45 --env pluck --pan -0.2

# Drone — a held sub floor tracking the chord roots (one whole note per bar): A F G E.
m add-note --track drone --pitch A1 --t 0  --dur 4 --velocity 70
m add-note --track drone --pitch F1 --t 4  --dur 4 --velocity 70
m add-note --track drone --pitch G1 --t 8  --dur 4 --velocity 70
m add-note --track drone --pitch E1 --t 12 --dur 4 --velocity 70
# a quiet fifth pad above the drone for a colder, wider harmonic bed
m add-note --track drone --pitch E2 --t 0  --dur 4 --velocity 46
m add-note --track drone --pitch C2 --t 4  --dur 4 --velocity 46
m add-note --track drone --pitch D2 --t 8  --dur 4 --velocity 46
m add-note --track drone --pitch B1 --t 12 --dur 4 --velocity 46

# Bass — driving straight eighth-notes on the root, the reactor's relentless pump.
bass_bar() { # <t0> <root>
  local t="$1" p="$2" i
  for i in 0 1 2 3 4 5 6 7; do
    m add-note --track bass --pitch "$p" --t "$(awk "BEGIN{print $t + $i*0.5}")" --dur 0.45 --velocity $(( i % 2 == 0 ? 100 : 78 ))
  done
}
bass_bar 0  A2
bass_bar 4  F2
bass_bar 8  G2
bass_bar 12 E2

# Pulse — a ticking machine arpeggio, sixteenth-ish stabs climbing the chord tones.
pulse_bar() { # <t0> <n1> <n2> <n3> <n4>
  local t="$1"
  m add-note --track pulse --pitch "$2" --t "$(awk "BEGIN{print $t+0}")"   --dur 0.4 --velocity 84
  m add-note --track pulse --pitch "$3" --t "$(awk "BEGIN{print $t+1}")"   --dur 0.4 --velocity 72
  m add-note --track pulse --pitch "$4" --t "$(awk "BEGIN{print $t+2}")"   --dur 0.4 --velocity 84
  m add-note --track pulse --pitch "$5" --t "$(awk "BEGIN{print $t+3}")"   --dur 0.4 --velocity 72
}
pulse_bar 0  A4 C5 E5 C5
pulse_bar 4  A4 C5 F5 C5
pulse_bar 8  B4 D5 G5 D5
pulse_bar 12 B4 E5 G5 E5

# Lead — a sparse, cold motif floating over the loop; tense, minor, unresolved.
m add-note --track lead --pitch E5 --t 2   --dur 1.5 --velocity 82
m add-note --track lead --pitch A5 --t 5   --dur 1   --velocity 88
m add-note --track lead --pitch G5 --t 6.5 --dur 1.5 --velocity 78
m add-note --track lead --pitch F5 --t 9   --dur 1   --velocity 84
m add-note --track lead --pitch D5 --t 10.5 --dur 1  --velocity 76
m add-note --track lead --pitch E5 --t 13  --dur 2.5 --velocity 86
m render

echo "produced arc-foundry audio under $AUD:"
ls -la "$AUD"
