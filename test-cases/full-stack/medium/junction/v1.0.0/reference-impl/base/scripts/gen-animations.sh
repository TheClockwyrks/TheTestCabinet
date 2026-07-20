#!/usr/bin/env bash
# Junction — produce the animated sprite-sheets (the "living"/moving map elements) with the
# on-PATH `draw-sheet` tool (specs/assets.md §2). Three short cycles, one separate PNG per
# frame under its own directory, played on a timer in code:
#
#   assets/anim/signal/{0..3}.png        16x16 x4  traffic-signal cycle (green->amber->red->amber)
#   assets/anim/construction/{0..3}.png  32x32 x4  building under construction (pad->scaffold->framed->topped)
#   assets/anim/tram/{0..3}.png          16x24 x4  rolling tram/metro car (window lights + wheel shuffle)
#
# Re-run it to regenerate them. Only the finished assets/anim/**/*.png are kept; the tool's
# scratch (*.config.json/*.actions.json/*.preview.*) is git-ignored.
#
# Usage:  bash scripts/gen-animations.sh   (draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
if ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw-sheet" ] || { echo "draw-sheet not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANIM="$ROOT/assets/anim"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsheet <w> <h> <dir> : start a fresh 4-frame cycle rendering to <dir>/{0..3}.png
newsheet() {
  mkdir -p "$3"
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [0,1,2,3], "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/f_{frame}.json" "$3/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ============================ SIGNAL (16x16 x4) ===============================
# A stacked traffic-light housing (red top / amber middle / green bottom) with the
# active lamp lit each frame; cycle green -> amber -> red -> amber (specs/transit.md).
sig_base() { # $1 = frame  -> housing + three dim lamps
  s fill-rect   --frame "$1" --x 4 --y 1 --width 8 --height 14 --color '#2a2f26'
  s stroke-rect --frame "$1" --x 4 --y 1 --width 8 --height 14 --color '#5b6570'
  s fill-circle --frame "$1" --cx 8 --cy 4  --r 2 --color '#5a2320'  # red   dim
  s fill-circle --frame "$1" --cx 8 --cy 8  --r 2 --color '#5a4418'  # amber dim
  s fill-circle --frame "$1" --cx 8 --cy 12 --r 2 --color '#1e4630'  # green dim
}
sig_lit() { # $1 frame  $2 cy  $3 color  -> a lit lamp with a bright core
  s fill-circle --frame "$1" --cx 8 --cy "$2" --r 2 --color "$3"
  s set-pixel   --frame "$1" --x 7 --y "$2" --color '#ffffff'
  s set-pixel   --frame "$1" --x 8 --y "$2" --color '#ffffff'
}
newsheet 16 16 "$ANIM/signal"
for f in 0 1 2 3; do sig_base "$f"; done
sig_lit 0 12 '#4caf6d'   # green
sig_lit 1 8  '#e0a63c'   # amber
sig_lit 2 4  '#ff5a52'   # red
sig_lit 3 8  '#e0a63c'   # amber
echo "produced traffic-signal cycle under $ANIM/signal"

# ============================ CONSTRUCTION (32x32 x4) ========================
# A lot developing: empty pad -> scaffold -> full frame -> topped-out shell with lit
# windows. Played while a lot builds/upgrades, paired with the dust particle (specs/map.md).
con_pad() { # $1 frame  -> dirt foundation footprint
  s fill-rect --frame "$1" --x 4 --y 24 --width 24 --height 5 --color '#3a3630'
  s fill-rect --frame "$1" --x 4 --y 24 --width 24 --height 1 --color '#5b6570'
}
newsheet 32 32 "$ANIM/construction"

# frame 0 — empty pad: survey stakes + a spoil heap
con_pad 0
s fill-rect --frame 0 --x 7  --y 21 --width 1 --height 3 --color '#9aa4af'
s fill-rect --frame 0 --x 24 --y 21 --width 1 --height 3 --color '#9aa4af'
s set-pixel --frame 0 --x 15 --y 22 --color '#9aa4af'
s fill-rect --frame 0 --x 12 --y 26 --width 6 --height 2 --color '#2a2f26'

# frame 1 — scaffold: two corner posts, a low beam, a diagonal brace
con_pad 1
s fill-rect --frame 1 --x 7  --y 13 --width 1 --height 11 --color '#5b6570'
s fill-rect --frame 1 --x 24 --y 13 --width 1 --height 11 --color '#5b6570'
s fill-rect --frame 1 --x 7  --y 19 --width 18 --height 1 --color '#9aa4af'
s line      --frame 1 --x0 7 --y0 23 --x1 16 --y1 14 --color '#9aa4af'

# frame 2 — full frame: three full-height posts, two beams, cross-braces
con_pad 2
s fill-rect --frame 2 --x 7  --y 8 --width 1 --height 16 --color '#5b6570'
s fill-rect --frame 2 --x 15 --y 8 --width 1 --height 16 --color '#5b6570'
s fill-rect --frame 2 --x 24 --y 8 --width 1 --height 16 --color '#5b6570'
s fill-rect --frame 2 --x 7  --y 8  --width 18 --height 1 --color '#9aa4af'
s fill-rect --frame 2 --x 7  --y 15 --width 18 --height 1 --color '#9aa4af'
s line      --frame 2 --x0 7  --y0 15 --x1 15 --y1 8 --color '#9aa4af'
s line      --frame 2 --x0 16 --y0 15 --x1 24 --y1 8 --color '#9aa4af'

# frame 3 — topped out: shell walls, roof cap, lit windows
con_pad 3
s fill-rect --frame 3 --x 8  --y 9 --width 16 --height 15 --color '#2a2f26'   # interior/wall
s fill-rect --frame 3 --x 7  --y 8 --width 1  --height 16 --color '#5b6570'   # left post
s fill-rect --frame 3 --x 24 --y 8 --width 1  --height 16 --color '#5b6570'   # right post
s fill-rect --frame 3 --x 5  --y 6 --width 22 --height 3 --color '#9aa4af'    # roof cap
s fill-rect --frame 3 --x 5  --y 6 --width 22 --height 1 --color '#e6ebf0'    # lit top edge
s fill-rect --frame 3 --x 10 --y 12 --width 3 --height 3 --color '#e6ebf0'    # windows
s fill-rect --frame 3 --x 18 --y 12 --width 3 --height 3 --color '#e6ebf0'
s fill-rect --frame 3 --x 10 --y 18 --width 3 --height 3 --color '#e6ebf0'
s fill-rect --frame 3 --x 18 --y 18 --width 3 --height 3 --color '#e6ebf0'
echo "produced construction cycle under $ANIM/construction"

# ============================ TRAM (16x24 x4) ================================
# A single rolling tram/metro car: rail-purple body, windscreen + two window rows whose
# lights cycle, headlight/taillight, and wheel trucks that shuffle to read as motion
# (specs/transit.md). Rotated to heading in code.
tram_base() { # $1 frame  -> body shell, roof, skirt, head/tail lights
  s fill-rect --frame "$1" --x 2 --y 1  --width 12 --height 21 --color '#6a3496'  # outline
  s fill-rect --frame "$1" --x 3 --y 2  --width 10 --height 19 --color '#b061e6'  # body
  s fill-rect --frame "$1" --x 3 --y 2  --width 10 --height 2  --color '#8a4fc0'  # roof/cab band
  s fill-rect --frame "$1" --x 3 --y 20 --width 10 --height 1  --color '#5a2c82'  # skirt
  s set-pixel --frame "$1" --x 5  --y 2 --color '#fff6d6'                          # headlights
  s set-pixel --frame "$1" --x 10 --y 2 --color '#fff6d6'
  s set-pixel --frame "$1" --x 5  --y 20 --color '#ff5a52'                         # taillights
  s set-pixel --frame "$1" --x 10 --y 20 --color '#ff5a52'
  s fill-rect --frame "$1" --x 4 --y 4 --width 8 --height 3 --color '#f0e6ff'      # windscreen
}
tram_win() { # $1 frame  $2 y  $3 color  -> a paired window row (left+right)
  s fill-rect --frame "$1" --x 4 --y "$2" --width 3 --height 3 --color "$3"
  s fill-rect --frame "$1" --x 9 --y "$2" --width 3 --height 3 --color "$3"
}
tram_wheels() { # $1 frame  $2 xoff  -> two shuffling wheel trucks
  s fill-rect --frame "$1" --x $((3 + $2)) --y 21 --width 2 --height 2 --color '#3a2050'
  s fill-rect --frame "$1" --x $((9 + $2)) --y 21 --width 2 --height 2 --color '#3a2050'
}
BRIGHT='#f0e6ff'; DIM='#d0aef0'
newsheet 16 24 "$ANIM/tram"
for f in 0 1 2 3; do tram_base "$f"; done
# window lights alternate row-to-row per frame; wheels shuffle -> rolling read
tram_win 0 10 "$BRIGHT"; tram_win 0 15 "$DIM";    tram_wheels 0 0
tram_win 1 10 "$DIM";    tram_win 1 15 "$BRIGHT"; tram_wheels 1 1
tram_win 2 10 "$BRIGHT"; tram_win 2 15 "$DIM";    tram_wheels 2 0
tram_win 3 10 "$DIM";    tram_win 3 15 "$BRIGHT"; tram_wheels 3 1
echo "produced tram cycle under $ANIM/tram"

echo "done: signal + construction + tram sheets under $ANIM"
