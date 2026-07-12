#!/usr/bin/env bash
# Valence — produce the net-new tower sprites with the on-PATH asset tools (specs/assets.md).
#
# The original committed sprite set covered five towers (ionizer, shear→Cleaver,
# fission→Reactor, catalyst, moderator) plus the three damage-type projectiles
# (proj_ionizer=energy, proj_shear=kinetic, proj_fission=nuclear). The redesign added two
# general-purpose towers — EMITTER (energy dart, light blue) and BEAM (energy lance, lime)
# — which this script authors with `draw` / `draw-sheet`: three tiers each (a rotatable
# east-facing head) and a four-frame muzzle-fire cycle each. Re-run it to regenerate them.
#
# Usage:  bash scripts/gen-assets.sh    (draw/draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir.
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOW="$ROOT/assets/towers"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers (draw) ---------------------------------------------
# newsprite <w> <h> <out.png> : start a fresh 32x32 (or given) transparent canvas.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# --- sheet helpers (draw-sheet, 4 frames) -------------------------------------
newsheet() { # newsheet <dir>  -> 4-frame cycle into <dir>/{0..3}.png
  mkdir -p "$1"
  printf '{ "width": 32, "height": 32, "background": "transparent", "frames": [0,1,2,3], "actions": "%s", "preview": "%s" }\n' \
    "$TMP/f_{frame}.json" "$1/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ============================ EMITTER (energy dart, #8fb9ff) ===================
emitter_head() { # <bodyR> : the shared round head at (14,16), east-facing
  d fill-circle --cx 14 --cy 16 --r $(( $1 + 2 )) --color '#2f4d80'
  d fill-circle --cx 14 --cy 16 --r "$1" --color '#8fb9ff'
  d fill-circle --cx 14 --cy 16 --r $(( $1 - 3 )) --color '#cfe0ff'
  d fill-circle --cx 14 --cy 16 --r 1 --color '#eaf3ff'
}

newsprite 32 32 "$TOW/emitter_1.png"
emitter_head 6
d fill-rect --x 20 --y 14 --width 9 --height 4 --color '#6f97d8'
d fill-rect --x 28 --y 14 --width 2 --height 4 --color '#eaf3ff'

newsprite 32 32 "$TOW/emitter_2.png"
emitter_head 7
d stroke-circle --cx 14 --cy 16 --r 9 --color '#cfe0ff'
d fill-rect --x 20 --y 13 --width 10 --height 6 --color '#6f97d8'
d fill-rect --x 29 --y 13 --width 2 --height 6 --color '#eaf3ff'
d fill-rect --x 11 --y 6 --width 4 --height 3 --color '#4a6fb0'
d fill-rect --x 11 --y 23 --width 4 --height 3 --color '#4a6fb0'

newsprite 32 32 "$TOW/emitter_3.png"
emitter_head 7
d stroke-circle --cx 14 --cy 16 --r 10 --color '#cfe0ff'
d fill-circle --cx 14 --cy 16 --r 2 --color '#ffffff'
d fill-rect --x 20 --y 12 --width 11 --height 8 --color '#6f97d8'
d fill-rect --x 22 --y 14 --width 8 --height 4 --color '#b6d0ff'
d fill-circle --cx 30 --cy 16 --r 3 --color '#eaf3ff'
d fill-rect --x 9 --y 4 --width 7 --height 3 --color '#4a6fb0'
d fill-rect --x 9 --y 25 --width 7 --height 3 --color '#4a6fb0'

newsheet "$TOW/emitter_fire"
s fill-circle --frame 0 --cx 30 --cy 16 --r 2 --color '#cfe0ff'
s fill-circle --frame 1 --cx 31 --cy 16 --r 4 --color '#eaf3ff'
s fill-circle --frame 1 --cx 31 --cy 16 --r 2 --color '#ffffff'
s fill-circle --frame 2 --cx 30 --cy 16 --r 3 --color '#b6d0ff'
s fill-circle --frame 3 --cx 30 --cy 16 --r 1 --color '#8fb9ff'

# ============================ BEAM (energy lance, #c9f24a) =====================
beam_head() { # <bodyR> : the head at (11,16) with a long east lance barrel
  d fill-circle --cx 11 --cy 16 --r $(( $1 + 2 )) --color '#4c6a18'
  d fill-circle --cx 11 --cy 16 --r "$1" --color '#c9f24a'
  d fill-circle --cx 11 --cy 16 --r $(( $1 - 3 )) --color '#f2ffb0'
}

newsprite 32 32 "$TOW/beam_1.png"
beam_head 5
d fill-rect --x 16 --y 15 --width 14 --height 2 --color '#a8d13a'
d fill-rect --x 29 --y 14 --width 2 --height 4 --color '#f2ffb0'

newsprite 32 32 "$TOW/beam_2.png"
beam_head 6
d stroke-circle --cx 11 --cy 16 --r 8 --color '#eaffb0'
d fill-rect --x 16 --y 14 --width 15 --height 4 --color '#a8d13a'
d fill-rect --x 16 --y 15 --width 15 --height 2 --color '#eaffb0'
d fill-circle --cx 30 --cy 16 --r 2 --color '#ffffff'

newsprite 32 32 "$TOW/beam_3.png"
beam_head 7
d stroke-circle --cx 11 --cy 16 --r 9 --color '#eaffb0'
d fill-circle --cx 11 --cy 16 --r 2 --color '#ffffff'
d fill-rect --x 7 --y 4 --width 8 --height 3 --color '#6f8f28'
d fill-rect --x 7 --y 25 --width 8 --height 3 --color '#6f8f28'
d fill-rect --x 16 --y 13 --width 15 --height 6 --color '#a8d13a'
d fill-rect --x 16 --y 15 --width 15 --height 2 --color '#ffffff'
d fill-circle --cx 30 --cy 16 --r 3 --color '#f2ffb0'

newsheet "$TOW/beam_fire"
s fill-rect --frame 0 --x 16 --y 15 --width 14 --height 2 --color '#f2ffb0'
s fill-rect --frame 1 --x 12 --y 14 --width 20 --height 4 --color '#ffffff'
s fill-rect --frame 1 --x 12 --y 15 --width 20 --height 2 --color '#f2ffb0'
s fill-rect --frame 2 --x 16 --y 15 --width 16 --height 2 --color '#eaffb0'
s fill-rect --frame 3 --x 20 --y 15 --width 10 --height 1 --color '#c9f24a'

echo "produced Emitter + Beam sprites under $TOW"
