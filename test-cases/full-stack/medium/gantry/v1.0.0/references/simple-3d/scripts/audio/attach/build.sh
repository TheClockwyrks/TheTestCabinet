#!/usr/bin/env bash
# Gantry — attach.wav
#
# The `attach` cue (specs/ui.md): the hook seizes a waiting load. specs/assets.md
# calls it "the clunk of the hook taking a load" — a HEAVY METAL-ON-METAL SEIZE
# with a LITTLE RING after it.
#
# Authored entirely with sfx-sample's VOICE + EFFECT operations: the baked sample
# pack is empty on this machine (`sfx-sample list-samples` -> "no samples"), so
# there is no `add-sample` here, exactly as the Arc Foundry gen-audio.sh works
# around the same constraint.
#
# The shape, in four layers:
#   contact — a very short highpassed noise crack: steel touching steel.
#   body    — a low sine THUMP sliding down: the load's mass arriving on the hook.
#   clank   — an inharmonically FM'd square: the bite of the seize, the "clunk".
#   ring    — two quiet inharmonic partials that hang on after the hit and decay:
#             the "little ring after it". They stop well short of the file end so
#             the tail reaches silence and the cue never smears into the next.
#
# Usage:  bash build.sh   (sfx-sample on PATH, or in $CARGO_TARGET_DIR/release)
set -euo pipefail

if ! command -v sfx-sample >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/sfx-sample" ] || { echo "sfx-sample not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
CFG="sfx-sample.config.json"

cat > "$CFG" <<'JSON'
{
  "sample_rate": 44100,
  "channels": "mono",
  "max_duration_ms": 700,
  "seed": 7,
  "sample_pack": "combat-core@0.1.0",
  "actions": "attach.actions.json",
  "preview": "preview.png",
  "wav": "attach.wav"
}
JSON

x() { sfx-sample "$@" --config "$CFG" >/dev/null; }

sfx-sample init --config "$CFG" >/dev/null

# --- contact: the instant of steel meeting steel -----------------------------
x add-voice --name contact --wave noise --gain -14 --start 0 --dur 34
x set-envelope --voice contact --env pluck
x add-filter --voice contact --type highpass --cutoff 2800 --resonance 1.2

# --- body: the load's weight arriving, a short falling thump -----------------
x add-voice --name body --wave sine --freq 128 --gain -11 --start 0 --dur 130
x set-envelope --voice body --env punch
x set-pitch --voice body --slide-to 58 --over 110

# --- clank: the metal-on-metal bite of the seize ------------------------------
x add-voice --name clank --wave square --freq 430 --gain -13 --start 3 --dur 150
x set-envelope --voice clank --env pluck
x add-fm --voice clank --carrier 1 --modulator 3.7 --index 7
x set-pitch --voice clank --slide-to 260 --over 130

# --- ring: the little metallic ring left hanging after the hit ----------------
x add-voice --name ring1 --wave triangle --freq 1180 --gain -15 --start 14 --dur 200
x set-envelope --voice ring1 --attack 2 --decay 80 --sustain 0.16 --release 280
x add-fm --voice ring1 --carrier 1 --modulator 2.41 --index 2.2
x add-voice --name ring2 --wave sine --freq 1735 --gain -19 --start 20 --dur 170
x set-envelope --voice ring2 --attack 2 --decay 65 --sustain 0.13 --release 240
x add-fm --voice ring2 --carrier 1 --modulator 1.63 --index 1.4
x add-voice --name ring3 --wave sine --freq 2480 --gain -25 --start 24 --dur 140
x set-envelope --voice ring3 --attack 2 --decay 55 --sustain 0.14 --release 170

# --- master: a little grit, a small yard-sized room, no top-end hiss ----------
x add-distortion --bus master --drive 1.1
x add-filter --bus master --type lowpass --cutoff 8200 --resonance 0.7
x add-reverb --bus master --size 0.32 --mix 0.13
x add-compressor --bus master --threshold -6 --ratio 2

x render

echo "wrote $HERE/attach.wav"
