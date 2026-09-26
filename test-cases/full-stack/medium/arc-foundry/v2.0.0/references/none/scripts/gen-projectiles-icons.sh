#!/usr/bin/env bash
# Arc Foundry — produce the projectile sprites, the panel and bar icons, and the press
# cycle (specs/assets.md).
#
#   • assets/projectiles/<type>.png — 12 by 12, one per FIRING base type (seven). Each is
#     drawn facing +x, the canonical direction the game rotates it from. A combination
#     tower's shot reuses the sprite of the base type its dominant output matches.
#   • assets/icons/charge.png, integrity.png, type-<type>.png — 16 by 16.
#   • assets/press/0.png .. 3.png — the press stamping, played when a rock is placed.
#
# Usage:  bash scripts/gen-projectiles-icons.sh   (draw and draw-sheet must be on PATH, or
#         built under $CARGO_TARGET_DIR/debug).
set -euo pipefail

if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/debug"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/assets/projectiles"
ICON="$ROOT/assets/icons"
PRESS="$ROOT/assets/press"
mkdir -p "$PROJ" "$ICON" "$PRESS"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

newsprite() { # newsprite <w> <h> <out.png>
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

newsheet() { # newsheet <w> <h> <outdir> : a four-frame cycle -> <outdir>/{0..3}.png
  mkdir -p "$3"
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [0,1,2,3], "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/f_{frame}.json" "$3/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# =============================== PROJECTILES (12 x 12) =========================
# Each type's shot carries its own silhouette and its type colour, so a yard under fire
# reads which component is shooting. All point +x with the hot tip at x = 10.

# Capacitor — a compact balanced bolt with a hot head and a short tail.
newsprite 12 12 "$PROJ/capacitor.png"
d fill-circle --cx 7 --cy 6 --r 3 --color '#2f6d92'
d fill-circle --cx 7 --cy 6 --r 2 --color '#4ac6ff'
d fill-circle --cx 8 --cy 6 --r 1 --color '#eaf6ff'
d line --x0 1 --y0 6 --x1 4 --y1 6 --color '#2f6d92'
d set-pixel --x 5 --y 6 --color '#4ac6ff'

# Coil — a forked bolt: a head with two trailing arms, reading as a chain about to leap.
newsprite 12 12 "$PROJ/coil.png"
d line --x0 2 --y0 3 --x1 6 --y1 6 --color '#3f7f5a'
d line --x0 2 --y0 9 --x1 6 --y1 6 --color '#3f7f5a'
d fill-circle --cx 8 --cy 6 --r 3 --color '#3f7f5a'
d fill-circle --cx 8 --cy 6 --r 2 --color '#66e08a'
d set-pixel --x 9 --y 6 --color '#eaffe8'

# Emitter — a small, fast spark with a long thin trail.
newsprite 12 12 "$PROJ/emitter.png"
d line --x0 0 --y0 6 --x1 7 --y1 6 --color '#8a6ad0'
d fill-circle --cx 8 --cy 6 --r 2 --color '#b18cff'
d set-pixel --x 9 --y 6 --color '#f0e6ff'

# Arc-Node — a heavy round charge that will discharge over an area on impact.
newsprite 12 12 "$PROJ/arcnode.png"
d fill-circle --cx 7 --cy 6 --r 4 --color '#8a5a1f'
d fill-circle --cx 7 --cy 6 --r 3 --color '#ffa63c'
d fill-circle --cx 7 --cy 6 --r 1 --color '#fff0d0'
d set-pixel --x 2 --y 6 --color '#8a5a1f'
d set-pixel --x 4 --y 6 --color '#ffa63c'

# Discharge Rig — a long heavy lance, the biggest single shot in the game.
newsprite 12 12 "$PROJ/discharge.png"
d fill-rect --x 1 --y 5 --width 9 --height 3 --color '#9a3a3a'
d fill-rect --x 1 --y 6 --width 9 --height 1 --color '#ff6a5a'
d fill-circle --cx 9 --cy 6 --r 2 --color '#ff9a8a'
d set-pixel --x 10 --y 6 --color '#fff0ea'

# Choke — an icy bead trailing drag, so a slowing shot reads on sight.
newsprite 12 12 "$PROJ/choke.png"
d fill-circle --cx 7 --cy 6 --r 3 --color '#2a6f88'
d fill-circle --cx 7 --cy 6 --r 2 --color '#7fe0ff'
d set-pixel --x 8 --y 6 --color '#e8fbff'
d set-pixel --x 3 --y 4 --color '#7fe0ff'
d set-pixel --x 3 --y 8 --color '#7fe0ff'
d set-pixel --x 1 --y 6 --color '#2a6f88'

# Rectifier — an ember bead trailing sparks, so a burning shot reads on sight.
newsprite 12 12 "$PROJ/rectifier.png"
d fill-circle --cx 7 --cy 6 --r 3 --color '#8a3a1f'
d fill-circle --cx 7 --cy 6 --r 2 --color '#ff7a3c'
d set-pixel --x 8 --y 6 --color '#ffe0c0'
d set-pixel --x 3 --y 5 --color '#ff7a3c'
d set-pixel --x 2 --y 7 --color '#8a3a1f'

# =============================== BAR ICONS (16 x 16) ===========================

# Charge — a lightning bolt in a hot cyan, the currency mark.
newsprite 16 16 "$ICON/charge.png"
d line --x0 9 --y0 1 --x1 4 --y1 8 --color '#2f6d92'
d line --x0 10 --y0 1 --x1 5 --y1 8 --color '#4ac6ff'
d fill-rect --x 4 --y 7 --width 7 --height 2 --color '#4ac6ff'
d line --x0 10 --y0 7 --x1 5 --y1 14 --color '#4ac6ff'
d line --x0 11 --y0 7 --x1 6 --y1 14 --color '#eaf6ff'
d set-pixel --x 9 --y 3 --color '#eaf6ff'

# Grid Integrity — a shield over a grid, the counter a leak drains.
newsprite 16 16 "$ICON/integrity.png"
d fill-rect --x 3 --y 2 --width 10 --height 7 --color '#2a5f4a'
d fill-circle --cx 8 --cy 9 --r 5 --color '#2a5f4a'
d fill-rect --x 4 --y 3 --width 8 --height 6 --color '#4ade9a'
d fill-circle --cx 8 --cy 9 --r 4 --color '#4ade9a'
d line --x0 8 --y0 3 --x1 8 --y1 12 --color '#0e2a20'
d line --x0 4 --y0 6 --x1 12 --y1 6 --color '#0e2a20'
d set-pixel --x 5 --y 4 --color '#d8fff0'

# =============================== TYPE ICONS (16 x 16) ==========================
# One glyph per base component type, for the panel. Each is a distinct silhouette in its
# own type colour so the eight read apart at a glance.

# Capacitor — two parallel plates with an arc between them.
newsprite 16 16 "$ICON/type-capacitor.png"
d fill-rect --x 4 --y 3 --width 2 --height 10 --color '#4ac6ff'
d fill-rect --x 10 --y 3 --width 2 --height 10 --color '#4ac6ff'
d line --x0 6 --y0 8 --x1 10 --y1 8 --color '#eaf6ff'
d set-pixel --x 8 --y 6 --color '#eaf6ff'

# Coil — a wound helix.
newsprite 16 16 "$ICON/type-coil.png"
d stroke-circle --cx 8 --cy 5 --r 4 --color '#66e08a'
d stroke-circle --cx 8 --cy 9 --r 4 --color '#66e08a'
d stroke-circle --cx 8 --cy 12 --r 3 --color '#3f7f5a'
d set-pixel --x 8 --y 1 --color '#eaffe8'

# Emitter — a fan of fast sparks.
newsprite 16 16 "$ICON/type-emitter.png"
d fill-circle --cx 4 --cy 8 --r 3 --color '#8a6ad0'
d fill-circle --cx 4 --cy 8 --r 2 --color '#b18cff'
d line --x0 7 --y0 8 --x1 14 --y1 3 --color '#b18cff'
d line --x0 7 --y0 8 --x1 14 --y1 8 --color '#f0e6ff'
d line --x0 7 --y0 8 --x1 14 --y1 13 --color '#b18cff'

# Arc-Node — a node with a discharge ring around it.
newsprite 16 16 "$ICON/type-arcnode.png"
d stroke-circle --cx 8 --cy 8 --r 7 --color '#8a5a1f'
d stroke-circle --cx 8 --cy 8 --r 5 --color '#ffa63c'
d fill-circle --cx 8 --cy 8 --r 2 --color '#fff0d0'

# Discharge Rig — a long barrel with a heavy muzzle.
newsprite 16 16 "$ICON/type-discharge.png"
d fill-rect --x 1 --y 6 --width 12 --height 4 --color '#9a3a3a'
d fill-rect --x 1 --y 7 --width 12 --height 2 --color '#ff6a5a'
d fill-rect --x 12 --y 4 --width 3 --height 8 --color '#ff9a8a'
d set-pixel --x 14 --y 8 --color '#fff0ea'

# Choke — a constricted throat, wide to narrow.
newsprite 16 16 "$ICON/type-choke.png"
d line --x0 1 --y0 2 --x1 7 --y1 8 --color '#7fe0ff'
d line --x0 1 --y0 14 --x1 7 --y1 8 --color '#7fe0ff'
d line --x0 15 --y0 2 --x1 9 --y1 8 --color '#2a6f88'
d line --x0 15 --y0 14 --x1 9 --y1 8 --color '#2a6f88'
d fill-circle --cx 8 --cy 8 --r 2 --color '#e8fbff'

# Rectifier — a diode triangle against its bar.
newsprite 16 16 "$ICON/type-rectifier.png"
d line --x0 4 --y0 2 --x1 4 --y1 14 --color '#ff7a3c'
d line --x0 4 --y0 2 --x1 11 --y1 8 --color '#ff7a3c'
d line --x0 4 --y0 14 --x1 11 --y1 8 --color '#ff7a3c'
d fill-rect --x 11 --y 2 --width 2 --height 13 --color '#ffe0c0'
d fill-circle --cx 7 --cy 8 --r 2 --color '#8a3a1f'

# Regulator — a support node radiating its aura, with no muzzle.
newsprite 16 16 "$ICON/type-regulator.png"
d stroke-circle --cx 8 --cy 8 --r 7 --color '#455a22'
d stroke-circle --cx 8 --cy 8 --r 5 --color '#7d9a34'
d stroke-circle --cx 8 --cy 8 --r 3 --color '#b6e05a'
d fill-circle --cx 8 --cy 8 --r 1 --color '#f2fbd8'
d set-pixel --x 8 --y 0 --color '#b6e05a'
d set-pixel --x 0 --y 8 --color '#b6e05a'
d set-pixel --x 15 --y 8 --color '#b6e05a'
d set-pixel --x 8 --y 15 --color '#b6e05a'

# =============================== THE PRESS (40 x 40, four frames) ==============
# The scrap-press stamping, played when a rock is placed: the ram drops onto the anvil,
# the strike flashes, and the ram lifts clear.
newsheet 40 40 "$PRESS"
press_frame() { # press_frame <frame> <ramY>
  local f=$1 ry=$2
  # the anvil and its bed
  s fill-rect --frame "$f" --x 6  --y 30 --width 28 --height 6 --color '#232f3c'
  s fill-rect --frame "$f" --x 6  --y 30 --width 28 --height 1 --color '#4a5f74'
  s fill-rect --frame "$f" --x 10 --y 26 --width 20 --height 4 --color '#37485a'
  # the frame uprights
  s fill-rect --frame "$f" --x 3  --y 4 --width 4 --height 30 --color '#313f4e'
  s fill-rect --frame "$f" --x 33 --y 4 --width 4 --height 30 --color '#313f4e'
  s fill-rect --frame "$f" --x 3  --y 4 --width 34 --height 3 --color '#37485a'
  # the ram
  s fill-rect --frame "$f" --x 14 --y $((ry - 8)) --width 12 --height 8 --color '#4a5f74'
  s fill-rect --frame "$f" --x 12 --y "$ry" --width 16 --height 5 --color '#5a708a'
  s fill-rect --frame "$f" --x 12 --y "$ry" --width 16 --height 1 --color '#8aa0b8'
}
press_frame 0 12
press_frame 1 18
press_frame 2 21
s fill-circle --frame 2 --cx 20 --cy 28 --r 6 --color '#4ac6ff'
s fill-circle --frame 2 --cx 20 --cy 28 --r 3 --color '#eaf6ff'
s line --frame 2 --x0 20 --y0 28 --x1 8  --y1 24 --color '#eaf6ff'
s line --frame 2 --x0 20 --y0 28 --x1 32 --y1 24 --color '#eaf6ff'
press_frame 3 15
s fill-circle --frame 3 --cx 20 --cy 28 --r 3 --color '#2f6d92'
s set-pixel --frame 3 --x 12 --y 24 --color '#4ac6ff'
s set-pixel --frame 3 --x 28 --y 25 --color '#4ac6ff'

echo "produced projectiles -> $PROJ"
echo "produced icons       -> $ICON"
echo "produced press cycle -> $PRESS"
