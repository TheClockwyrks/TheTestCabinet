#!/usr/bin/env bash
# Locomotivation — produce the rail-yard AUDIO with the on-PATH audio tools (specs/assets.md §Audio).
#
# The palette of the sound is a WORKING INDUSTRIAL RAIL YARD AT GOLDEN HOUR (specs/overview.md
# "working industrial rail yard at golden hour"; "warm, saturated, and legible"): gravel underfoot,
# rust-and-steel tracks, diesel engines, air horns, and a driving, motoric music bed with the pulse
# of a shift in full swing. The two life-or-death cues — the train HORN and the rising RUMBLE — are
# real TELEGRAPHING signals (specs/trains.md): the player must HEAR a train coming.
#
# Two production lanes, chosen per cue (specs/assets.md: sfx-synth and/or sfx-sample):
#   * sfx-synth  — PURE SYNTH (oscillator/noise voices): the tight, tonal/mechanical cues —
#     the gravel footstep, the delivery chime, the diesel air horn, the confirm, the low-clock
#     klaxon, and the steam whistle.
#   * sfx-sample — SAMPLED over the baked `combat-core@0.1.0` pack (diesel idle, metal clanks,
#     booms, glass/rubble debris): the weightier, richer one-shots and loops — the package pickup,
#     the lethal squish/crunch impact, and the approaching-train rumble loop (diesel idle bed).
#   * music      — the DRIVING industrial-yard bed, sequenced over the baked `gm-lite@0.1.0` bank.
#
# Produces, under assets/audio/, exactly the cues the game loads (ASSET-MANIFEST.md §6 Audio):
#   footstep.wav  — gravel-yard worker step        (the worker moves; specs/character.md)
#   pickup.wav    — heft of lifting a package        (a package is picked up; specs/cargo.md)
#   delivery.wav  — bright color-matched chime        (delivered to a matching zone; specs/cargo.md)
#   horn.wav      — diesel air-horn telegraph         (a train nears a crossing; specs/trains.md)
#   rumble.wav    — approaching-train rumble LOOP      (gain rises with proximity; specs/trains.md)
#   impact.wav    — lethal squish / cargo crunch       (worker killed / cargo smashed; specs/trains.md)
#   confirm.wav   — quota-complete / menu confirm      (quota met, menu confirm; specs/flow.md)
#   alarm.wav     — low-clock klaxon                    (shift clock under threshold; specs/flow.md)
#   whistle.wav   — last-train steam whistle            (the last train departs; specs/trains.md)
#   music.wav (+ music.mid) — the driving industrial yard bed, looped under play
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth/sfx-sample/music must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir (works both in this dev
# container and on the run image, where they ARE on PATH).
if ! command -v sfx-synth >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
for tool in sfx-synth sfx-sample music; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found on PATH or in cargo release dir" >&2; exit 1; }
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUD="$ROOT/assets/audio"
mkdir -p "$AUD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# The baked sample pack / instrument bank live at env-pointed dirs on the run image
# (TCAB_SAMPLE_PACK_DIR / TCAB_INSTRUMENT_BANK_DIR). In THIS dev container they are usually unset,
# so fall back to the repo's checked-in packs ONLY when the env is empty — on the run image the
# guarded assignment never fires.
REPO="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${TCAB_SAMPLE_PACK_DIR:-}" ] && [ -n "$REPO" ] && [ -d "$REPO/dist/sample-packs/combat-core-0.1.0" ]; then
  export TCAB_SAMPLE_PACK_DIR="$REPO/dist/sample-packs/combat-core-0.1.0"
fi
if [ -z "${TCAB_INSTRUMENT_BANK_DIR:-}" ] && [ -n "$REPO" ] && [ -d "$REPO/dist/sample-packs/gm-lite-0.1.0" ]; then
  export TCAB_INSTRUMENT_BANK_DIR="$REPO/dist/sample-packs/gm-lite-0.1.0"
fi

# --- sfx-synth helpers (pure synth) ------------------------------------------
newsfx() { # <channels> <max_ms> <out.wav>
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 4703, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- sfx-sample helpers (sampled over combat-core@0.1.0) ---------------------
newsmp() { # <channels> <max_ms> <out.wav>
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 4703, "sample_pack": "combat-core@0.1.0", "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/smp.actions.json" "$TMP/smp.preview.png" "$3" > "$CFG"
  sfx-sample init --config "$CFG" >/dev/null
}
s() { sfx-sample "$@" --config "$CFG" >/dev/null; }

# --- music helpers (sequenced over gm-lite@0.1.0) ----------------------------
newmusic() { # <max_ms> <out.wav> <out.mid>
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 4703, "instrument_bank": "gm-lite@0.1.0", "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ================================= FOOTSTEP ===================================
# The WORKER STEP on the gravel yard floor (specs/character.md): a short, dry, gritty crunch with a
# soft low thump under it — a boot pressing into ballast. Fires often, so it stays TIGHT and dry: a
# low sine THUD dropping in pitch (the weight landing) and a band-limited noise CRUNCH (the grit).
# Mono — the worker's own feet, dead-centre. No tail.
newsfx mono 150 "$AUD/footstep.wav"
x add-voice --name thud --wave sine --freq 96 --gain -6 --start 0 --dur 90
x set-envelope --voice thud --env punch
x set-pitch --voice thud --slide-to 52 --over 85
x add-voice --name crunch --wave noise --gain -9 --start 0 --dur 70
x set-envelope --voice crunch --env pluck
x add-filter --voice crunch --type bandpass --cutoff 1900 --resonance 1.3
x add-filter --bus master --type lowpass --cutoff 3200 --resonance 0.6
x render

# ================================== PICKUP ====================================
# LIFTING A PACKAGE (specs/cargo.md): the worker hefts freight off the pad — a dull mechanical grab
# plus a small upward "got it" register, weighted so a heavy load feels heavier. A mech_clank for
# the hands seizing the crate, and a triangle TICK sliding UP in pitch (the load registering).
# Mono, short, satisfying.
newsmp mono 300 "$AUD/pickup.wav"
s add-sample --name mech_clank --t 0 --gain -3
s add-voice --name lift --wave triangle --freq 420 --gain -7 --start 20 --dur 190
s set-envelope --voice lift --env pluck
s set-pitch --voice lift --slide-to 640 --over 170
s add-voice --name tap --wave noise --gain -14 --start 0 --dur 30
s set-envelope --voice tap --env pluck
s add-filter --voice tap --type highpass --cutoff 3800 --resonance 1.0
s add-reverb --bus master --size 0.2 --mix 0.08
s render

# ================================= DELIVERY ===================================
# The COLOR-MATCHED DELIVERY CHIME when a package lands on its matching zone (specs/cargo.md): a
# bright, warm, satisfying "correct!" — a major bell TRIAD arpeggiating UP with a high sparkle over
# it, sweetened by a delay + reverb so it rings out clean and positive. Glassy sine/triangle voices
# (few harmonics) climbing a C-major triad into the octave. Stereo, spacious.
newsfx stereo 900 "$AUD/delivery.wav"
x add-voice --name d1 --wave sine     --freq 523  --gain -6  --start 0   --dur 300 --pan -0.12
x set-envelope --voice d1 --env pluck
x add-voice --name d2 --wave sine     --freq 659  --gain -6  --start 70  --dur 320 --pan 0.04
x set-envelope --voice d2 --env pluck
x add-voice --name d3 --wave triangle --freq 784  --gain -5  --start 150 --dur 380 --pan 0.14
x set-envelope --voice d3 --env pluck
x add-voice --name d4 --wave sine     --freq 1046 --gain -8  --start 220 --dur 420 --pan -0.06
x set-envelope --voice d4 --env pluck
x add-voice --name spk --wave triangle --freq 1568 --gain -14 --start 250 --dur 420 --pan 0.12
x set-envelope --voice spk --env pluck
x add-delay  --bus master --time 150 --feedback 0.25 --mix 0.2
x add-reverb --bus master --size 0.5 --mix 0.22
x render

# =================================== HORN =====================================
# The DIESEL AIR-HORN TELEGRAPH as a train nears a crossing (specs/trains.md — "a player should
# HEAR a train coming"): a big, warm, unmistakable locomotive honk — a detuned saw CHORD CLUSTER
# (the classic multi-chime air horn, a minor-7 stack: A-C-E-G-A) that swells in like pressured air,
# holds, and releases. Vibrato for the reedy chime beating, gentle distortion for the horn's airy
# grit, lowpassed so it stays warm and round rather than harsh. Stereo, wide, LOUD.
newsfx stereo 1500 "$AUD/horn.wav"
horn_chime() { # <name> <freq> <pan>
  x add-voice --name "$1" --wave saw --freq "$2" --gain -10 --start 0 --dur 1300 --pan "$3"
  x set-envelope --voice "$1" --attack 60 --decay 120 --sustain 0.85 --release 300
  x add-vibrato --voice "$1" --rate 6 --depth 0.06
}
horn_chime hA 220 -0.25
horn_chime hC 262  0.15
horn_chime hE 330 -0.1
horn_chime hG 392  0.2
horn_chime hO 440  0.0
x add-voice --name hsub --wave sine --freq 110 --gain -10 --start 0 --dur 1300
x set-envelope --voice hsub --attack 40 --decay 0 --sustain 1 --release 260
x add-distortion --bus master --drive 1.35
x add-filter --bus master --type lowpass --cutoff 2600 --resonance 0.7
x add-reverb --bus master --size 0.4 --mix 0.16
x render

# ================================== RUMBLE ====================================
# The APPROACHING-TRAIN RUMBLE — a LOOP whose gain the game raises as a train nears (specs/trains.md,
# ASSET-MANIFEST loop cue). A heavy diesel bed that must LOOP SEAMLESSLY (all voices held perfectly
# flat, NO attack/release/end fades, so the clip's ends butt cleanly): the baked engine_diesel_idle
# (itself a seamless loop) for the mechanical churn, a low sine SUB floor for the mass on the rails,
# and a lowpassed noise BED for the grinding steel. Slow vibrato on the sub so it breathes. Stereo,
# faintly wide; heavily lowpassed so it reads as low, dangerous mass.
newsmp stereo 2000 "$AUD/rumble.wav"
s add-sample --name engine_diesel_idle --t 0 --gain -4 --trim 0,2000
s add-voice --name sub --wave sine --freq 46 --gain -5 --start 0 --dur 2000 --pan -0.08
s set-envelope --voice sub --attack 0 --decay 0 --sustain 1 --release 0
s add-vibrato --voice sub --rate 3.5 --depth 0.1
s add-voice --name bed --wave noise --gain -13 --start 0 --dur 2000 --pan 0.1
s set-envelope --voice bed --attack 0 --decay 0 --sustain 1 --release 0
s add-filter --voice bed --type lowpass --cutoff 420 --resonance 1.0
s add-filter --bus master --type lowpass --cutoff 1400 --resonance 0.6
s render

# ================================== IMPACT ====================================
# The LETHAL SQUISH / CARGO CRUNCH — the worker crushed under a train, or freight smashed on the
# rails (specs/trains.md, specs/cargo.md): the nastiest, heaviest hit in the game. A boom_low_kick
# BODY, a debris_glass SPLINTER (the crate bursting / the impact spray), a short debris_rubble
# scatter, a highpassed noise CRACK, and a low sine THUD that sags out under it. Distortion +
# short reverb so it lands with brutal weight. Stereo.
newsmp stereo 1000 "$AUD/impact.wav"
s add-sample --name boom_low_kick --t 0 --gain -2
s add-sample --name debris_glass  --t 20 --gain -6 --fade-out 350
s add-sample --name debris_rubble --t 30 --gain -11 --trim 0,600 --fade-out 300
s add-voice --name crack --wave noise --gain -6 --start 0 --dur 90
s set-envelope --voice crack --env pluck
s add-filter --voice crack --type highpass --cutoff 2800 --resonance 1.3
s add-voice --name thud --wave sine --freq 120 --gain -3 --start 0 --dur 260
s set-envelope --voice thud --env punch
s set-pitch --voice thud --slide-to 44 --over 240
s add-distortion --bus master --drive 1.7
s add-reverb --bus master --size 0.4 --mix 0.16
s render

# ================================== CONFIRM ===================================
# The QUOTA-COMPLETE / MENU-CONFIRM (specs/flow.md): a bright, decisive, POSITIVE affirmation —
# fuller and more triumphant than the per-package delivery chime. A power-chord CONFIRM (root +
# fifth + octave) struck together with a glassy sparkle climbing over it, on a rising major feel.
# Sine/triangle voices, a touch of delay + reverb. Stereo, clean, upbeat.
newsfx stereo 800 "$AUD/confirm.wav"
x add-voice --name p1 --wave triangle --freq 392  --gain -6  --start 0   --dur 480 --pan -0.1
x set-envelope --voice p1 --env pluck
x add-voice --name p2 --wave sine     --freq 587  --gain -6  --start 0   --dur 480 --pan 0.1
x set-envelope --voice p2 --env pluck
x add-voice --name p3 --wave triangle --freq 784  --gain -7  --start 90  --dur 520 --pan 0.0
x set-envelope --voice p3 --env pluck
x add-voice --name p4 --wave sine     --freq 1175 --gain -10 --start 180 --dur 480 --pan -0.08
x set-envelope --voice p4 --env pluck
x add-voice --name p5 --wave triangle --freq 1568 --gain -13 --start 250 --dur 460 --pan 0.12
x set-envelope --voice p5 --env pluck
x add-delay  --bus master --time 130 --feedback 0.22 --mix 0.16
x add-reverb --bus master --size 0.45 --mix 0.2
x render

# =================================== ALARM ====================================
# The LOW-CLOCK KLAXON when the shift clock drops under its threshold (specs/flow.md): a tense,
# insistent two-tone warble in the DANGER register — "you're running out of time" — without an
# ear-splitting scream. A detuned square PAIR pulses a high-then-low klaxon twice, buzzing vibrato
# and a little distortion for the cheap-yard-siren grit, over a steady sub. The game may loop it
# while the clock is low. Stereo.
newsfx stereo 950 "$AUD/alarm.wav"
klaxon_beep() { # <start> <freq> <pan>
  local st="$1" f="$2" p="$3"
  x add-voice --name "sq_$st" --wave square --freq "$f" --gain -8 --start "$st" --dur 180 --pan "$p"
  x set-envelope --voice "sq_$st" --env gate
  x add-vibrato --voice "sq_$st" --rate 13 --depth 0.35
  x add-voice --name "dt_$st" --wave square --freq "$(( f + 5 ))" --gain -13 --start "$st" --dur 180 --pan "$p"
  x set-envelope --voice "dt_$st" --env gate
}
klaxon_beep 0   784 -0.2
klaxon_beep 240 523  0.2
klaxon_beep 480 784 -0.2
klaxon_beep 720 523  0.2
x add-voice --name asub --wave sine --freq 88 --gain -13 --start 0 --dur 950
x set-envelope --voice asub --attack 20 --decay 0 --sustain 1 --release 200
x add-distortion --bus master --drive 1.25
x add-reverb --bus master --size 0.22 --mix 0.09
x render

# ================================== WHISTLE ===================================
# The LAST-TRAIN STEAM WHISTLE / DEPARTURE (specs/trains.md — the optional last train arriving/
# leaving): a bright, breathy steam-whistle chord that SWELLS in on a puff of steam, holds, and
# fades away down the line — warmer and higher than the diesel horn, romantic and final. A close
# minor-third-plus-fifth chime of sine/triangle voices with strong reedy vibrato, over a highpassed
# noise STEAM hiss that swells with it. Big reverb for the distance as it pulls out. Stereo, wide.
newsfx stereo 1700 "$AUD/whistle.wav"
whistle_tone() { # <name> <freq> <pan>
  x add-voice --name "$1" --wave triangle --freq "$2" --gain -9 --start 0 --dur 1450 --pan "$3"
  x set-envelope --voice "$1" --attack 120 --decay 200 --sustain 0.8 --release 500
  x add-vibrato --voice "$1" --rate 6.5 --depth 0.09
}
whistle_tone wA 523 -0.2
whistle_tone wC 622  0.05
whistle_tone wE 784  0.2
x add-voice --name wair --wave sine --freq 1046 --gain -15 --start 0 --dur 1300 --pan 0.0
x set-envelope --voice wair --env swell
x add-voice --name steam --wave noise --gain -13 --start 40 --dur 1200 --pan -0.1
x set-envelope --voice steam --env swell
x add-filter --voice steam --type highpass --cutoff 3200 --resonance 1.2
x add-filter --bus master --type lowpass --cutoff 5200 --resonance 0.6
x add-reverb --bus master --size 0.6 --mix 0.26
x render

# =================================== MUSIC ====================================
# The DRIVING INDUSTRIAL-YARD BED — a warm, motoric loop under play, the pulse of a shift in full
# swing (specs/assets.md "a driving industrial yard loop"; specs/overview.md "golden hour ...
# warm, saturated"). Sequenced over the baked `gm-lite@0.1.0` bank. In A MINOR over a driving
# i-VI-III-VII progression (Am · F · C · G), the yard's engine never letting up:
#   * bass   — bass_electric on DRIVING EIGHTHS (the motoric train pulse under everything).
#   * kick   — drum_kick four-on-the-floor, the shift's steady beat.
#   * snare  — drum_snare backbeat on 2 & 4.
#   * hat    — drum_hat_closed eighths, the forward drive.
#   * pad    — synth_pad holding each chord, warm golden-hour air.
#   * lead   — synth_lead, a hooky pentatonic riff that develops over two passes.
#   * brass  — french_horn stabs on the downbeats, warm industrial weight.
# `music` emits both music.wav (the looped asset) and music.mid (portable companion score).
# 126 BPM, 8 bars (32 beats) — a clean, seamless loop.
newmusic 16000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 126
m set-time-signature --num 4 --den 4
m define-track --name bass  --instrument bass_electric
m define-track --name kick  --instrument drum_kick
m define-track --name snare --instrument drum_snare
m define-track --name hat   --instrument drum_hat_closed
m define-track --name pad   --instrument synth_pad
m define-track --name lead  --instrument synth_lead
m define-track --name brass --instrument french_horn
m set-track-fx --track bass  --gain -5  --reverb 0.12 --env punch --pan 0.0
m set-track-fx --track kick  --gain -6  --reverb 0.1  --env punch --pan 0.0
m set-track-fx --track snare --gain -10 --reverb 0.18 --env punch --pan 0.0
m set-track-fx --track hat   --gain -17 --reverb 0.1  --env pluck --pan 0.1
m set-track-fx --track pad   --gain -14 --reverb 0.5  --env swell --pan 0.0
m set-track-fx --track lead  --gain -11 --reverb 0.32 --env pluck --pan -0.12
m set-track-fx --track brass --gain -14 --reverb 0.35 --env punch --pan 0.14

# --- Rhythm section: bass eighths, four-on-the-floor kick, backbeat snare, eighth hats. ---
# Chord roots per bar (bars start at t = 0,4,8,12,16,20,24,28):  Am · F · C · G  (x2).
ROOTS=(A1 F1 C2 G1 A1 F1 C2 G1)
bar=0
for root in "${ROOTS[@]}"; do
  base=$(( bar * 4 ))
  # Bass — eight driving eighth notes on the root (a hair of accent on the downbeat).
  for i in 0 1 2 3 4 5 6 7; do
    t=$(awk "BEGIN{print $base + $i*0.5}")
    vel=78; [ "$i" = 0 ] && vel=96
    m add-note --track bass --pitch "$root" --t "$t" --dur 0.45 --velocity "$vel"
  done
  # Kick — four on the floor.
  for b in 0 1 2 3; do
    m add-note --track kick --pitch C2 --t "$(( base + b ))" --dur 0.4 --velocity 100
  done
  # Snare — backbeat on beats 2 and 4.
  m add-note --track snare --pitch D3 --t "$(( base + 1 ))" --dur 0.3 --velocity 88
  m add-note --track snare --pitch D3 --t "$(( base + 3 ))" --dur 0.3 --velocity 88
  # Hats — eighth-note drive.
  for i in 0 1 2 3 4 5 6 7; do
    t=$(awk "BEGIN{print $base + $i*0.5}")
    vel=60; [ $(( i % 2 )) = 1 ] && vel=44
    m add-note --track hat --pitch F4 --t "$t" --dur 0.2 --velocity "$vel"
  done
  bar=$(( bar + 1 ))
done

# --- Pad — a held warm triad per bar tracking Am · F · C · G (x2). ---
pad_chord() { # <base_beat> <p1> <p2> <p3>
  m add-note --track pad --pitch "$2" --t "$1" --dur 4 --velocity 52
  m add-note --track pad --pitch "$3" --t "$1" --dur 4 --velocity 46
  m add-note --track pad --pitch "$4" --t "$1" --dur 4 --velocity 42
}
pad_chord 0  A3 C4 E4      # Am
pad_chord 4  F3 A3 C4      # F
pad_chord 8  C4 E4 G4      # C
pad_chord 12 G3 B3 D4      # G
pad_chord 16 A3 C4 E4      # Am
pad_chord 20 F3 A3 C4      # F
pad_chord 24 C4 E4 G4      # C
pad_chord 28 G3 B3 D4      # G

# --- Brass — warm french-horn stabs on the downbeat of each bar (the chord root, punchy). ---
m add-note --track brass --pitch A3 --t 0  --dur 0.8 --velocity 78
m add-note --track brass --pitch F3 --t 4  --dur 0.8 --velocity 74
m add-note --track brass --pitch C4 --t 8  --dur 0.8 --velocity 78
m add-note --track brass --pitch G3 --t 12 --dur 0.8 --velocity 74
m add-note --track brass --pitch A3 --t 16 --dur 1.5 --velocity 82   # 2nd pass: longer, fuller
m add-note --track brass --pitch F3 --t 20 --dur 1.5 --velocity 78
m add-note --track brass --pitch C4 --t 24 --dur 1.5 --velocity 82
m add-note --track brass --pitch G3 --t 28 --dur 1.5 --velocity 78

# --- Lead — a hooky A-minor-pentatonic riff. First pass sparse, second pass busier (develops). ---
# Pass 1 (bars 1-4): the main motif, laid-back.
m add-note --track lead --pitch A4 --t 0.0  --dur 0.5 --velocity 84
m add-note --track lead --pitch C5 --t 0.5  --dur 0.5 --velocity 80
m add-note --track lead --pitch E5 --t 1.0  --dur 1.0 --velocity 88
m add-note --track lead --pitch D5 --t 2.5  --dur 0.5 --velocity 78
m add-note --track lead --pitch C5 --t 3.0  --dur 1.0 --velocity 82
m add-note --track lead --pitch A4 --t 4.5  --dur 0.5 --velocity 80   # over F
m add-note --track lead --pitch C5 --t 5.0  --dur 1.0 --velocity 84
m add-note --track lead --pitch A4 --t 6.5  --dur 1.0 --velocity 78
m add-note --track lead --pitch G4 --t 8.0  --dur 0.5 --velocity 82   # over C
m add-note --track lead --pitch E4 --t 8.5  --dur 0.5 --velocity 80
m add-note --track lead --pitch G4 --t 9.0  --dur 1.0 --velocity 86
m add-note --track lead --pitch A4 --t 10.5 --dur 1.0 --velocity 82
m add-note --track lead --pitch G4 --t 12.0 --dur 0.5 --velocity 84   # over G
m add-note --track lead --pitch D5 --t 12.5 --dur 0.5 --velocity 82
m add-note --track lead --pitch E5 --t 13.0 --dur 1.5 --velocity 90
# Pass 2 (bars 5-8): the motif up an octave / busier, driving to the loop point.
m add-note --track lead --pitch A5 --t 16.0 --dur 0.5 --velocity 90
m add-note --track lead --pitch G5 --t 16.5 --dur 0.5 --velocity 84
m add-note --track lead --pitch E5 --t 17.0 --dur 0.5 --velocity 88
m add-note --track lead --pitch C5 --t 17.5 --dur 0.5 --velocity 82
m add-note --track lead --pitch E5 --t 18.0 --dur 1.0 --velocity 86
m add-note --track lead --pitch D5 --t 19.5 --dur 0.5 --velocity 80
m add-note --track lead --pitch C5 --t 20.5 --dur 0.5 --velocity 84   # over F
m add-note --track lead --pitch A4 --t 21.0 --dur 0.5 --velocity 80
m add-note --track lead --pitch C5 --t 21.5 --dur 1.0 --velocity 86
m add-note --track lead --pitch F5 --t 23.0 --dur 1.0 --velocity 82
m add-note --track lead --pitch G4 --t 24.0 --dur 0.5 --velocity 84   # over C
m add-note --track lead --pitch C5 --t 24.5 --dur 0.5 --velocity 82
m add-note --track lead --pitch E5 --t 25.0 --dur 1.0 --velocity 88
m add-note --track lead --pitch G5 --t 26.5 --dur 1.0 --velocity 84
m add-note --track lead --pitch D5 --t 28.0 --dur 0.5 --velocity 86   # over G, turnaround
m add-note --track lead --pitch B4 --t 28.5 --dur 0.5 --velocity 82
m add-note --track lead --pitch G4 --t 29.0 --dur 0.5 --velocity 84
m add-note --track lead --pitch A4 --t 29.5 --dur 1.5 --velocity 88   # resolve toward the Am loop
m render

echo "produced locomotivation audio under $AUD:"
ls -la "$AUD"
