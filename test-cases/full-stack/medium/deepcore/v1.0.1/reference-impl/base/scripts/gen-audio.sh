#!/usr/bin/env bash
# Deepcore — produce the mine's AUDIO with the on-PATH audio tools (specs/assets.md §Audio).
#
# The palette of the sound is SUBTERRANEAN INDUSTRIAL: cold, heavy, mechanical, and lonely —
# a solitary suited prospector drilling a dead mining world far underground (specs/overview.md
# "subterranean industrial"; "a lone prospector stranded on Vhera Deep"). Grinding drills,
# a burner jetpack, dull metal thuds, molten sizzles, and a slow, mournful descent bed.
#
# Two production lanes, chosen per cue (specs/assets.md: "use whichever suits each cue"):
#   * sfx-synth — PURE SYNTH (oscillator/noise voices): the tonal / mechanical-texture cues
#     that want tight control — the drill grind, the burner loop, the ore blip, the material
#     chime, and the two alarms.
#   * sfx-sample — SAMPLED over the baked `combat-core@0.1.0` pack (engine idle, servo, metal
#     impacts, booms, debris, mech clanks, fire crackle): the RICHER, weightier one-shots —
#     the impact thud, the fabricate confirm, the launch roar, the gas blast, the lava sizzle,
#     and the death cue. The `music` bed sequences the baked `gm-lite@0.1.0` instrument bank.
#
# Produces, under assets/audio/, exactly the cues the game loads (ASSET-LAYOUT.md §Audio):
#   drill.wav          — grinding drill loop        (the miner is drilling; specs/character.md)
#   thrust.wav         — jetpack burner loop        (the miner thrusts up; specs/character.md)
#   ore-pickup.wav     — ore pickup blip            (an ore vein is collected; specs/mining.md)
#   material-chime.wav — richer material chime       (a Resonite/Cryenite find; specs/mining.md)
#   gas-explosion.wav  — green-white gas blast       (a gas pocket detonates; specs/hazards.md)
#   lava-sizzle.wav    — molten contact sizzle       (the miner touches lava; specs/hazards.md)
#   impact.wav         — hard-landing thud           (the miner lands hard; specs/hazards.md)
#   fabricate.wav      — buy / fabricate confirm     (an upgrade or rocket part; specs/rocket.md)
#   launch.wav         — rocket launch roar          (the rocket lifts off; specs/rocket.md)
#   death.wav          — death cue                   (the miner dies; specs/character.md)
#   alarm-fuel.wav     — low-fuel warning klaxon     (fuel runs low; specs/character.md)
#   alarm-core.wav     — escalating core-timer beep  (Core Sample countdown; specs/hazards.md)
#   music.wav (+ music.mid) — the lonely industrial descent bed, looped under the mine
#
# Usage:  bash scripts/gen-audio.sh   (sfx-synth/sfx-sample/music must be on PATH, or built
#         under $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
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
# (TCAB_SAMPLE_PACK_DIR / TCAB_INSTRUMENT_BANK_DIR, set by containers/full-stack-2d/Dockerfile),
# and `audio-core`'s resolve_pack_dir() reads those envs. In THIS dev container they are
# usually unset, so fall back to the repo's checked-in pack tarballs under dist/sample-packs
# ONLY when the env is empty — on the run image the `:=`-guarded assignment never fires.
REPO="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${TCAB_SAMPLE_PACK_DIR:-}" ] && [ -n "$REPO" ] && [ -d "$REPO/dist/sample-packs/combat-core-0.1.0" ]; then
  export TCAB_SAMPLE_PACK_DIR="$REPO/dist/sample-packs/combat-core-0.1.0"
fi
if [ -z "${TCAB_INSTRUMENT_BANK_DIR:-}" ] && [ -n "$REPO" ] && [ -d "$REPO/dist/sample-packs/gm-lite-0.1.0" ]; then
  export TCAB_INSTRUMENT_BANK_DIR="$REPO/dist/sample-packs/gm-lite-0.1.0"
fi

# --- sfx-synth helpers (pure synth) ------------------------------------------
# newsfx <channels> <max_ms> <out.wav> : seed a fresh synth run (empty op log).
newsfx() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 1337, "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/sfx.actions.json" "$TMP/sfx.preview.png" "$3" > "$CFG"
  sfx-synth init --config "$CFG" >/dev/null
}
x() { sfx-synth "$@" --config "$CFG" >/dev/null; }

# --- sfx-sample helpers (sampled over combat-core@0.1.0) ---------------------
# newsmp <channels> <max_ms> <out.wav> : seed a fresh sampled run over the baked pack.
newsmp() {
  printf '{ "sample_rate": 44100, "channels": "%s", "max_duration_ms": %s, "seed": 1337, "sample_pack": "combat-core@0.1.0", "actions": "%s", "preview": "%s", "wav": "%s" }\n' \
    "$1" "$2" "$TMP/smp.actions.json" "$TMP/smp.preview.png" "$3" > "$CFG"
  sfx-sample init --config "$CFG" >/dev/null
}
s() { sfx-sample "$@" --config "$CFG" >/dev/null; }

# --- music helpers (sequenced over gm-lite@0.1.0) ----------------------------
# newmusic <max_ms> <out.wav> <out.mid>
newmusic() {
  printf '{ "sample_rate": 44100, "channels": "stereo", "max_duration_ms": %s, "seed": 1337, "instrument_bank": "gm-lite@0.1.0", "actions": "%s", "preview": "%s", "wav": "%s", "mid": "%s" }\n' \
    "$1" "$TMP/mus.actions.json" "$TMP/mus.preview.png" "$2" "$3" > "$CFG"
  music init --config "$CFG" >/dev/null
}
m() { music "$@" --config "$CFG" >/dev/null; }

# ================================== DRILL =====================================
# The GRINDING DRILL LOOP while the miner bites into a tile (specs/character.md). A harsh,
# steady industrial grind meant to LOOP seamlessly in the game (held for the full clip, no
# attack/release fade so the ends butt cleanly): a low saw GRIND as the motor's torque, a
# ratcheting square BURR ringmodded for the metal-on-rock chatter, and a band-limited noise
# ABRASION for the cutting grit. Bitcrushed + lowpassed so it reads as a working machine,
# not a musical tone. Mono — it is the miner's own tool, dead-centre.
newsfx mono 720 "$AUD/drill.wav"
x add-voice --name grind --wave saw --freq 82 --gain -6 --start 0 --dur 720
x set-envelope --voice grind --attack 0 --decay 0 --sustain 1 --release 0
x add-vibrato --voice grind --rate 24 --depth 0.25
x add-voice --name burr --wave square --freq 165 --gain -12 --start 0 --dur 720
x set-envelope --voice burr --attack 0 --decay 0 --sustain 1 --release 0
x add-ringmod --voice burr --freq 47
x add-voice --name grit --wave noise --gain -13 --start 0 --dur 720
x set-envelope --voice grit --attack 0 --decay 0 --sustain 1 --release 0
x add-filter --voice grit --type bandpass --cutoff 2200 --resonance 1.6
x add-bitcrush --bus master --bits 9 --rate 14000
x add-filter --bus master --type lowpass --cutoff 3200 --resonance 0.8
x render

# ================================== THRUST ====================================
# The JETPACK BURNER LOOP while the miner thrusts up out of a shaft (specs/character.md). A
# roaring gas burner that LOOPS: a low sine RUMBLE (the thrust column), a filtered noise
# BURN (the flame roar), and a resonant bandpass whistle for the nozzle hiss. Held flat for
# a seamless loop, driven a touch so it strains — climbing costs fuel, and it should sound
# like effort. Stereo, faintly wide so the plume feels physical under the pack.
newsfx stereo 720 "$AUD/thrust.wav"
x add-voice --name rumble --wave sine --freq 64 --gain -5 --start 0 --dur 720
x set-envelope --voice rumble --attack 0 --decay 0 --sustain 1 --release 0
x add-vibrato --voice rumble --rate 9 --depth 0.15
x add-voice --name burn --wave noise --gain -7 --start 0 --dur 720 --pan -0.15
x set-envelope --voice burn --attack 0 --decay 0 --sustain 1 --release 0
x add-filter --voice burn --type lowpass --cutoff 1700 --resonance 1.1
x add-voice --name hiss --wave noise --gain -15 --start 0 --dur 720 --pan 0.2
x set-envelope --voice hiss --attack 0 --decay 0 --sustain 1 --release 0
x add-filter --voice hiss --type bandpass --cutoff 3600 --resonance 2.2
x add-distortion --bus master --drive 1.3
x render

# ================================ ORE PICKUP ==================================
# The ORE PICKUP BLIP when an ore vein is collected (specs/mining.md): a small, bright,
# satisfying "got it" tick that fires often, so it stays short and dry. A triangle CHIRP
# snapping quickly UP in pitch (the credit registering) plus a tiny highpassed noise TICK
# for the pick. Mono, cheap, and clean.
newsfx mono 190 "$AUD/ore-pickup.wav"
x add-voice --name chirp --wave triangle --freq 660 --gain -6 --start 0 --dur 130
x set-envelope --voice chirp --env pluck
x set-pitch --voice chirp --slide-to 990 --over 120
x add-voice --name tick --wave noise --gain -14 --start 0 --dur 40
x set-envelope --voice tick --env pluck
x add-filter --voice tick --type highpass --cutoff 4200 --resonance 1.0
x add-reverb --bus master --size 0.2 --mix 0.07
x render

# ============================== MATERIAL CHIME ================================
# The MATERIAL CHIME for a Resonite / Cryenite find (specs/mining.md) — a PRIZE, not routine
# ore, so it is richer, brighter, and lingers: a crystalline bell TRIAD arpeggiating up with
# a high SHIMMER over it, sweetened by a feedback delay + reverb so it rings out cold and
# gem-like. Sine/triangle voices (glassy, few harmonics) climbing a bright chord — the
# unmistakable "you found something rare" read. Stereo, spacious.
newsfx stereo 1200 "$AUD/material-chime.wav"
x add-voice --name b1 --wave sine --freq 784 --gain -6 --start 0   --dur 360 --pan -0.15
x set-envelope --voice b1 --env pluck
x add-voice --name b2 --wave sine --freq 1046 --gain -6 --start 90  --dur 380 --pan 0.05
x set-envelope --voice b2 --env pluck
x add-voice --name b3 --wave triangle --freq 1318 --gain -5 --start 190 --dur 520 --pan 0.2
x set-envelope --voice b3 --env pluck
x add-voice --name shimmer --wave sine --freq 2637 --gain -15 --start 210 --dur 640 --pan -0.1
x set-envelope --voice shimmer --env pluck
x add-voice --name air --wave triangle --freq 1976 --gain -13 --start 300 --dur 520 --pan 0.15
x set-envelope --voice air --env pluck
x add-delay --bus master --time 160 --feedback 0.3 --mix 0.24
x add-reverb --bus master --size 0.6 --mix 0.26
x render

# ============================== GAS EXPLOSION =================================
# The GAS-POCKET DETONATION (specs/hazards.md): a violent GREEN-WHITE burst with flying
# debris — the "you hit gas" read. Sampled for weight: a boom_low_kick BODY, a tumbling
# debris_rubble scatter, and a fire_crackle flash, topped with a highpassed noise CRACK and
# a distorted synth ROAR for the chemical bite. Distortion + reverb so it lands hard.
newsmp stereo 1400 "$AUD/gas-explosion.wav"
s add-sample --name boom_low_kick --t 0 --gain -2
s add-sample --name debris_rubble --t 40 --gain -7 --fade-out 500
s add-sample --name fire_crackle --t 0 --gain -12 --trim 0,700 --fade-out 350
s add-voice --name crack --wave noise --gain -6 --start 0 --dur 120
s set-envelope --voice crack --env pluck
s add-filter --voice crack --type highpass --cutoff 2600 --resonance 1.3
s add-voice --name roar --wave saw --freq 240 --gain -9 --start 0 --dur 300
s set-envelope --voice roar --env punch
s set-pitch --voice roar --slide-to 70 --over 260
s add-distortion --bus master --drive 1.9
s add-reverb --bus master --size 0.5 --mix 0.2
s render

# =============================== LAVA SIZZLE =================================
# The LAVA CONTACT SIZZLE when the miner touches molten rock (specs/hazards.md): a hot hiss
# of embers and smoke at the contact point — dangerous but textural, not an explosion. A
# fire_crackle bed lowpassed to a warm molten roar, a highpassed noise STEAM hiss, and a low
# sine GLOW under it. Heavily lowpassed on the master so it stays thick and subterranean.
newsmp stereo 1400 "$AUD/lava-sizzle.wav"
s add-sample --name fire_crackle --t 0 --gain -4 --trim 0,1300 --fade-in 40 --fade-out 400
s add-voice --name steam --wave noise --gain -12 --start 20 --dur 1100 --pan 0.15
s set-envelope --voice steam --env swell
s add-filter --voice steam --type highpass --cutoff 3000 --resonance 1.2
s add-voice --name glow --wave sine --freq 96 --gain -7 --start 0 --dur 1300 --pan -0.1
s set-envelope --voice glow --env swell
s add-filter --bus master --type lowpass --cutoff 2600 --resonance 0.7
s add-reverb --bus master --size 0.4 --mix 0.16
s render

# ================================== IMPACT ===================================
# The HARD-LANDING THUD when the miner drops and lands hard (specs/hazards.md): a heavy,
# dull metal-and-body impact — the suit hitting rock. Sampled: an impact_metal_hollow for
# the resonant clang of the suit, a boom_low_kick for the sub-body, and a synth SUB thump
# under both. Short, weighty, no ring left over. Mono — a single point of contact.
newsmp mono 700 "$AUD/impact.wav"
s add-sample --name impact_metal_hollow --t 0 --gain -4 --fade-out 300
s add-sample --name boom_low_kick --t 0 --gain -3
s add-voice --name sub --wave sine --freq 110 --gain -3 --start 0 --dur 240
s set-envelope --voice sub --env punch
s set-pitch --voice sub --slide-to 48 --over 220
s add-filter --bus master --type lowpass --cutoff 3400 --resonance 0.8
s add-reverb --bus master --size 0.3 --mix 0.1
s render

# ================================ FABRICATE ==================================
# The BUY / FABRICATE CONFIRM at a surface building — an upgrade or a rocket part locking in
# (specs/rocket.md, specs/upgrades.md). A satisfying MECHANICAL affirmation: a mech_clip_load
# seat and a mech_ratchet lever (the part clamping home), then a bright synth CONFIRM triad
# rising over them — machinery plus a clean "purchased" chime. Stereo, tidy, positive.
newsmp stereo 1000 "$AUD/fabricate.wav"
s add-sample --name mech_clip_load --t 0 --gain -3
s add-sample --name mech_ratchet --t 90 --gain -6
s add-voice --name c1 --wave sine --freq 659 --gain -8 --start 260 --dur 260 --pan -0.1
s set-envelope --voice c1 --env pluck
s add-voice --name c2 --wave sine --freq 988 --gain -8 --start 360 --dur 300 --pan 0.1
s set-envelope --voice c2 --env pluck
s add-voice --name c3 --wave triangle --freq 1318 --gain -9 --start 460 --dur 360 --pan 0.0
s set-envelope --voice c3 --env pluck
s add-reverb --bus master --size 0.4 --mix 0.18
s render

# =================================== LAUNCH ==================================
# The ROCKET LAUNCH ROAR — the victory payoff as the escape rocket lifts off (specs/rocket.md):
# the biggest, longest cue in the game. A cannon_body_heavy IGNITION crack, the engine_diesel_idle
# swelling into a sustained thrust ROAR, a boom_sub_rumble floor and a whoosh_air of displaced
# air, all under a filtered noise BLAST sweeping down as the rocket climbs away. Big reverb;
# it should feel enormous and triumphant. Stereo, wide.
newsmp stereo 3000 "$AUD/launch.wav"
s add-sample --name cannon_body_heavy --t 0 --gain -3
s add-sample --name engine_diesel_idle --t 120 --gain -5 --fade-in 200 --fade-out 700
s add-sample --name boom_sub_rumble --t 0 --gain -4 --fade-out 900
s add-sample --name whoosh_air --t 60 --gain -9 --pitch -4
s add-voice --name blast --wave noise --gain -6 --start 0 --dur 2400 --pan 0.0
s set-envelope --voice blast --attack 60 --decay 400 --sustain 0.55 --release 1400
s add-filter --voice blast --type lowpass --cutoff 3200 --sweep-to 700 --over 2400 --resonance 1.0
s add-distortion --bus master --drive 1.6
s add-reverb --bus master --size 0.68 --mix 0.28
s render

# ==================================== DEATH ==================================
# The DEATH CUE when the prospector dies down a hole (specs/character.md, specs/modes.md): a
# grim, final collapse — the suit venting and the systems dying. A boom_low_kick body, a
# debris_glass shatter for the venting suit, a descending saw WAIL sliding down into silence
# (the miner going under), and a low sine that sags out. Reverb-soaked and bleak — no
# triumph here. Stereo.
newsmp stereo 1600 "$AUD/death.wav"
s add-sample --name boom_low_kick --t 0 --gain -4
s add-sample --name debris_glass --t 60 --gain -8 --fade-out 400
s add-voice --name wail --wave saw --freq 420 --gain -9 --start 0 --dur 900 --pan -0.1
s set-envelope --voice wail --attack 10 --decay 200 --sustain 0.4 --release 640
s set-pitch --voice wail --slide-to 70 --over 880
s add-voice --name sag --wave sine --freq 130 --gain -6 --start 0 --dur 1200 --pan 0.1
s set-envelope --voice sag --attack 20 --decay 0 --sustain 1 --release 700
s set-pitch --voice sag --slide-to 45 --over 1100
s add-filter --bus master --type lowpass --cutoff 2600 --resonance 0.7
s add-reverb --bus master --size 0.6 --mix 0.24
s render

# ================================= ALARM: FUEL ===============================
# The LOW-FUEL WARNING KLAXON (specs/character.md, specs/flow.md): a tense, insistent two-tone
# warble that says "get to the surface NOW" without screaming. A detuned square-pair pulses a
# high-then-low klaxon twice, with a buzzing vibrato and a little distortion for the cheap-suit
# alarm grit, over a steady sub. Urgent and repeating — the game may loop it while fuel is low.
newsfx stereo 900 "$AUD/alarm-fuel.wav"
alarm_beep() { # <start> <freq> <pan>
  local st="$1" f="$2" p="$3"
  x add-voice --name "sq_$st" --wave square --freq "$f" --gain -7 --start "$st" --dur 170 --pan "$p"
  x set-envelope --voice "sq_$st" --env gate
  x add-vibrato --voice "sq_$st" --rate 14 --depth 0.4
  x add-voice --name "dt_$st" --wave square --freq "$(( f + 6 ))" --gain -12 --start "$st" --dur 170 --pan "$p"
  x set-envelope --voice "dt_$st" --env gate
}
alarm_beep 0   740 -0.2
alarm_beep 230 494  0.2
alarm_beep 460 740 -0.2
alarm_beep 690 494  0.2
x add-voice --name sub --wave sine --freq 82 --gain -12 --start 0 --dur 900
x set-envelope --voice sub --attack 30 --decay 0 --sustain 1 --release 200
x add-distortion --bus master --drive 1.3
x add-reverb --bus master --size 0.25 --mix 0.1
x render

# ================================= ALARM: CORE ===============================
# The ESCALATING CORE-TIMER BEEP while carrying the unstable Core Sample (specs/hazards.md):
# ONE sharp, rising countdown blip — the game plays it faster and faster as the detonation
# timer runs down, so the single cue itself must read as urgent. A square PING snapping UP in
# pitch (the charge building) with a ringmod edge and a highpassed noise CLICK. Short, hard,
# and dread-laden. Mono.
newsfx mono 260 "$AUD/alarm-core.wav"
x add-voice --name ping --wave square --freq 880 --gain -6 --start 0 --dur 150
x set-envelope --voice ping --env gate
x set-pitch --voice ping --slide-to 1240 --over 140
x add-ringmod --voice ping --freq 60
x add-voice --name click --wave noise --gain -12 --start 0 --dur 30
x set-envelope --voice click --env pluck
x add-filter --voice click --type highpass --cutoff 3600 --resonance 1.2
x add-reverb --bus master --size 0.22 --mix 0.08
x render

# ==================================== MUSIC ==================================
# The LONELY INDUSTRIAL DESCENT BED — a low, atmospheric loop under the mine for a solitary
# miner far underground (specs/assets.md "Music"; specs/overview.md "a lone prospector").
# Sequenced over the baked `gm-lite@0.1.0` bank. In D MINOR, slow and mournful, over a
# DESCENDING lament bass (roots D · C · Bb · A — the ground literally sinking under the loop):
#   * pad   — a low synth_pad drone holding the chord, cold and wide (the cavern air).
#   * cello — a sustained mournful fifth above the pad, the loneliness.
#   * bass  — bass_electric on the descending roots, a slow half-note pulse.
#   * bell  — a sparse vibraphone motif falling over the top: distant, unresolved.
#   * kick  — a deep drum_kick once a bar: the mine's slow mechanical heartbeat.
# `music` emits both music.wav (the looped asset) and music.mid (portable companion score).
# 66 BPM, 16 beats (four bars) — a clean, seamless loop.
newmusic 16000 "$AUD/music.wav" "$AUD/music.mid"
m set-tempo --bpm 66
m set-time-signature --num 4 --den 4
m define-track --name pad   --instrument synth_pad
m define-track --name cello --instrument cello
m define-track --name bass  --instrument bass_electric
m define-track --name bell  --instrument vibraphone
m define-track --name kick  --instrument drum_kick
m set-track-fx --track pad   --gain -11 --reverb 0.62 --env swell --pan 0.0
m set-track-fx --track cello --gain -15 --reverb 0.55 --env swell --pan -0.15
m set-track-fx --track bass  --gain -6  --reverb 0.2  --env punch --pan 0.0
m set-track-fx --track bell  --gain -13 --reverb 0.55 --env pluck --pan 0.2
m set-track-fx --track kick  --gain -8  --reverb 0.28 --env punch --pan 0.0

# Pad — a held minor chord per bar tracking the descending roots (Dm · Cm-ish · Bb · Am).
m add-note --track pad --pitch D2 --t 0  --dur 4 --velocity 58
m add-note --track pad --pitch A2 --t 0  --dur 4 --velocity 48
m add-note --track pad --pitch F2 --t 0  --dur 4 --velocity 44
m add-note --track pad --pitch C2 --t 4  --dur 4 --velocity 58
m add-note --track pad --pitch G2 --t 4  --dur 4 --velocity 48
m add-note --track pad --pitch D3 --t 4  --dur 4 --velocity 40
m add-note --track pad --pitch A1 --t 8  --dur 4 --velocity 58
m add-note --track pad --pitch F2 --t 8  --dur 4 --velocity 48
m add-note --track pad --pitch D3 --t 8  --dur 4 --velocity 40
m add-note --track pad --pitch A1 --t 12 --dur 4 --velocity 58
m add-note --track pad --pitch E2 --t 12 --dur 4 --velocity 48
m add-note --track pad --pitch C3 --t 12 --dur 4 --velocity 40

# Cello — a slow mournful line above the pad, sustained, one long note per bar.
m add-note --track cello --pitch A3 --t 0  --dur 3.5 --velocity 54
m add-note --track cello --pitch G3 --t 4  --dur 3.5 --velocity 52
m add-note --track cello --pitch F3 --t 8  --dur 3.5 --velocity 56
m add-note --track cello --pitch E3 --t 12 --dur 3.5 --velocity 50

# Bass — the descending lament roots, a slow two-note pulse per bar (root, then the fifth up).
m add-note --track bass --pitch D1 --t 0   --dur 1.8 --velocity 92
m add-note --track bass --pitch A1 --t 2   --dur 1.8 --velocity 74
m add-note --track bass --pitch C2 --t 4   --dur 1.8 --velocity 92
m add-note --track bass --pitch G1 --t 6   --dur 1.8 --velocity 74
m add-note --track bass --pitch Bb1 --t 8  --dur 1.8 --velocity 92
m add-note --track bass --pitch F1 --t 10  --dur 1.8 --velocity 74
m add-note --track bass --pitch A1 --t 12  --dur 1.8 --velocity 92
m add-note --track bass --pitch E1 --t 14  --dur 1.8 --velocity 74

# Bell — a sparse, cold vibraphone motif falling over the loop; tense, minor, unresolved.
m add-note --track bell --pitch D5 --t 1.5  --dur 1   --velocity 74
m add-note --track bell --pitch A4 --t 3    --dur 1.5 --velocity 66
m add-note --track bell --pitch F4 --t 6    --dur 1   --velocity 72
m add-note --track bell --pitch G4 --t 9    --dur 1   --velocity 70
m add-note --track bell --pitch E4 --t 11   --dur 1.5 --velocity 64
m add-note --track bell --pitch D4 --t 14   --dur 1.5 --velocity 68

# Kick — the mine's slow heartbeat, one deep hit on the downbeat of each bar.
m add-note --track kick --pitch C2 --t 0  --dur 0.5 --velocity 96
m add-note --track kick --pitch C2 --t 4  --dur 0.5 --velocity 88
m add-note --track kick --pitch C2 --t 8  --dur 0.5 --velocity 96
m add-note --track kick --pitch C2 --t 12 --dur 0.5 --velocity 88
m render

echo "produced deepcore audio under $AUD:"
ls -la "$AUD"
