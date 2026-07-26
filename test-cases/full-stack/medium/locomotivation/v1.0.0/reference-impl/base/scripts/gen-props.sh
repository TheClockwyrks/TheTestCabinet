#!/usr/bin/env bash
# Locomotivation — produce the PROP sprites with the on-PATH `draw` tool
# (specs/assets.md §4, ASSET-MANIFEST.md §4). This script owns the freight-yard
# props the shift is played with (specs/cargo.md, specs/world.md, specs/trains.md):
#
#   • the COLOR-CODED PACKAGES — Red/Blue/Green/Amber × Parcel/Crate/Load (12 base
#     sprites). Color reads at a glance; the weight class reads from SIZE + SHAPE
#     (a small taped parcel, a mid wooden crate, a big double-strapped pallet load);
#   • the UNIQUE packages — the (color,class) combos the campaign marks as one-of-a-
#     kind, drawn as the same box but distinctly SEALED (gold wax seal + sealing
#     straps + a stamped band) so a reviewer/player never mistakes it for freight;
#   • the DISPENSERS — a ¾ chute station per color, its color reading on the chute
#     surround + an indicator lamp + a body stripe (source of that color's freight);
#   • the DROP ZONES — a flat color-coded delivery pad (inward chevrons) + a ¾ marker
#     post with a color sign board (the delivery target);
#   • the CROSSING SIGNALS — a 3-aspect head (danger/warning/clear) on a post, one
#     produced PNG per lit state in the signal colors (telegraph an approaching train);
#   • the JUNCTION LEVERS — a ¾ throw post whose handle leans one way (default) or the
#     other (thrown), the knob colored to show which branch is live.
#
# Every color matches the palette in specs/overview.md. The worker, trains, tiles,
# particle systems and audio are produced by their own gen scripts; this one produces
# ONLY the props above, under assets/cargo/ and assets/elements/.
#
# The build itself is SELF-CONTAINED — it loads these committed PNGs and never invokes
# the tools. Re-run this once to regenerate them. The tools' scratch (intermediate
# action logs + previews) goes to a temp dir and is never committed; only the finished
# PNGs under assets/ are kept.
#
# Usage:  bash scripts/gen-props.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tool: prefer PATH, else the cargo target release dir. -----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw >/dev/null 2>&1 || { echo "draw not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARGO="$ROOT/assets/cargo"
ELEM="$ROOT/assets/elements"
mkdir -p "$CARGO" "$ELEM"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsprite <w> <h> <out.png> : fresh transparent canvas that renders straight to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# Soft contact shadow blob at a base center (semi-transparent dark).
shadow() { # cx cy r
  d fill-circle --cx "$1" --cy "$2" --r "$3" --color '#0000002e'
}

# ================================================================================
# PACKAGES — color × weight class (specs/cargo.md). Color = identity; the weight
# class reads from SIZE + SHAPE. Each box is an extruded ¾ read: a lighter TOP band,
# a base FRONT face, a darker RIGHT side, a bright left/top highlight edge, and a
# dark strap outline — anchored at its footprint with a soft contact shadow.
# Per color: base / light-top / dark-side / strap / highlight.
# ================================================================================

# ---- PARCEL (small, taped cardboard box) --------------------------------------
# canvas 28x28; box front (6,11)-22x11, top band 4px, right side 3px.
parcel() { # out base light dark strap hl unique
  local out="$1" base="$2" light="$3" dark="$4" strap="$5" hl="$6" uniq="$7"
  newsprite 28 28 "$out"
  shadow 14 24 6
  d fill-rect --x 6  --y 11 --width 16 --height 11 --color "$base"   # front face
  d fill-rect --x 6  --y 7  --width 16 --height 4  --color "$light"  # top face
  d fill-rect --x 19 --y 11 --width 3  --height 11 --color "$dark"   # right side shade
  d fill-rect --x 6  --y 7  --width 1  --height 15 --color "$hl"     # left highlight edge
  d fill-rect --x 6  --y 7  --width 16 --height 1  --color "$hl"     # top highlight edge
  # packing tape — a lighter cross over the lid + front
  d fill-rect --x 12 --y 7  --width 3  --height 15 --color "$light"
  d fill-rect --x 6  --y 13 --width 16 --height 2  --color "$light"
  d set-pixel --x 13 --y 9  --color "$hl"
  d stroke-rect --x 6 --y 7 --width 16 --height 15 --color "$strap"  # crate outline
  if [ "$uniq" = 1 ]; then seal 14 15 "$strap"; fi
}

# ---- CRATE (medium wooden slat crate, corner posts + X-brace) -----------------
# canvas 34x34; box front (6,12)-22x16, top band 5px, right side 4px.
crate() { # out base light dark strap hl unique
  local out="$1" base="$2" light="$3" dark="$4" strap="$5" hl="$6" uniq="$7"
  newsprite 34 34 "$out"
  shadow 17 29 8
  d fill-rect --x 6  --y 12 --width 22 --height 16 --color "$base"   # front face
  d fill-rect --x 6  --y 7  --width 22 --height 5  --color "$light"  # top face
  d fill-rect --x 24 --y 12 --width 4  --height 16 --color "$dark"   # right side shade
  d fill-rect --x 6  --y 7  --width 1  --height 21 --color "$hl"     # left highlight
  d fill-rect --x 6  --y 7  --width 22 --height 1  --color "$hl"     # top highlight
  # slat gaps (horizontal shadow lines) — reads as planks
  d line --x0 7 --y0 17 --x1 27 --y1 17 --color "$dark"
  d line --x0 7 --y0 22 --x1 27 --y1 22 --color "$dark"
  # corner posts (darker uprights)
  d fill-rect --x 6  --y 12 --width 2 --height 16 --color "$dark"
  d fill-rect --x 26 --y 12 --width 2 --height 16 --color "$strap"
  # X-brace across the front
  d line --x0 8 --y0 13 --x1 26 --y1 27 --color "$strap"
  d line --x0 26 --y0 13 --x1 8 --y1 27 --color "$strap"
  d stroke-rect --x 6 --y 7 --width 22 --height 21 --color "$strap"
  if [ "$uniq" = 1 ]; then seal 17 20 "$strap"; fi
}

# ---- LOAD (big heavy crate on a timber pallet, double straps) -----------------
# canvas 40x40; pallet base + box front (5,10)-30x22, top band 6px, right side 5px.
load() { # out base light dark strap hl unique
  local out="$1" base="$2" light="$3" dark="$4" strap="$5" hl="$6" uniq="$7"
  newsprite 40 40 "$out"
  shadow 20 35 11
  # timber pallet the load rides on
  d fill-rect --x 4 --y 32 --width 32 --height 5 --color '#3c2f26'
  d fill-rect --x 4 --y 32 --width 32 --height 1 --color '#54402f'
  d line --x0 14 --y0 33 --x1 14 --y1 36 --color '#241a12'
  d line --x0 25 --y0 33 --x1 25 --y1 36 --color '#241a12'
  # box body
  d fill-rect --x 5  --y 10 --width 30 --height 22 --color "$base"   # front face
  d fill-rect --x 5  --y 4  --width 30 --height 6  --color "$light"  # top face
  d fill-rect --x 30 --y 10 --width 5  --height 22 --color "$dark"   # right side shade
  d fill-rect --x 5  --y 4  --width 1  --height 28 --color "$hl"     # left highlight
  d fill-rect --x 5  --y 4  --width 30 --height 1  --color "$hl"     # top highlight
  # heavy double steel straps (thick, dark) — signals weight
  d fill-rect --x 5  --y 15 --width 30 --height 2 --color "$strap"
  d fill-rect --x 5  --y 25 --width 30 --height 2 --color "$strap"
  d fill-rect --x 12 --y 4  --width 2  --height 28 --color "$strap"  # vertical strap
  d fill-rect --x 26 --y 4  --width 2  --height 28 --color "$strap"
  # corner braces
  d fill-rect --x 5  --y 10 --width 2 --height 22 --color "$dark"
  d fill-rect --x 33 --y 10 --width 2 --height 22 --color "$strap"
  d stroke-rect --x 5 --y 4 --width 30 --height 28 --color "$strap"
  if [ "$uniq" = 1 ]; then seal 20 20 "$strap"; fi
}

# A UNIQUE seal — a gold wax seal + a bright cross-strap band so a one-of-a-kind
# package reads as SEALED / marked regardless of its freight color.
seal() { # cx cy strap
  local cx="$1" cy="$2" strap="$3"
  # diagonal sealing straps across the whole face
  d line --x0 $((cx-9)) --y0 $((cy-9)) --x1 $((cx+9)) --y1 $((cy+9)) --color '#f0f2f5'
  d line --x0 $((cx+9)) --y0 $((cy-9)) --x1 $((cx-9)) --y1 $((cy+9)) --color '#f0f2f5'
  # gold wax seal disc
  d fill-circle --cx "$cx" --cy "$cy" --r 5 --color '#b8862a'
  d fill-circle --cx "$cx" --cy "$cy" --r 4 --color '#ffd23a'
  d fill-circle --cx "$cx" --cy "$cy" --r 2 --color '#ffe9a8'
  # embossed stamp cross on the seal
  d line --x0 $((cx-2)) --y0 "$cy" --x1 $((cx+2)) --y1 "$cy" --color '#b8862a'
  d line --x0 "$cx" --y0 $((cy-2)) --x1 "$cx" --y1 $((cy+2)) --color '#b8862a'
  d set-pixel --x $((cx-1)) --y $((cy-1)) --color '#fff2d6'
}

# color-set per freight color:  base  light  dark  strap  hl
mk_color() {                 #  $1     $2     $3    $4     $5   (color-name = $6)
  local c="$6"
  parcel "$CARGO/$c-parcel.png" "$1" "$2" "$3" "$4" "$5" 0
  crate  "$CARGO/$c-crate.png"  "$1" "$2" "$3" "$4" "$5" 0
  load   "$CARGO/$c-load.png"   "$1" "$2" "$3" "$4" "$5" 0
}

# Red  #e2503b
mk_color '#e2503b' '#f07a63' '#a5321f' '#6e1e12' '#ffb3a0' red
# Blue #3f8ae0
mk_color '#3f8ae0' '#6fb0f2' '#275f9e' '#16375e' '#bce0ff' blue
# Green #46b95c
mk_color '#46b95c' '#74d886' '#2c8440' '#185226' '#b8f0c4' green
# Amber #f2b03d
mk_color '#f2b03d' '#ffd27a' '#b87e1c' '#6e4a0f' '#ffe9b8' amber

# ---- UNIQUE packages (only the campaign's marked (color,class) combos) ---------
load  "$CARGO/unique-red-load.png"   '#e2503b' '#f07a63' '#a5321f' '#6e1e12' '#ffb3a0' 1
crate "$CARGO/unique-red-crate.png"  '#e2503b' '#f07a63' '#a5321f' '#6e1e12' '#ffb3a0' 1
load  "$CARGO/unique-green-load.png" '#46b95c' '#74d886' '#2c8440' '#185226' '#b8f0c4' 1
crate "$CARGO/unique-blue-crate.png" '#3f8ae0' '#6fb0f2' '#275f9e' '#16375e' '#bce0ff' 1

# ================================================================================
# DISPENSERS — a ¾ chute STATION per color (specs/world.md). Dark steel body +
# ¾ roof, a color-accented chute at the bottom front with a ready package showing,
# a color body stripe, and a glowing color indicator lamp — the SOURCE of its color.
# canvas 40x60 (taller than a tile; anchored at base).
# ================================================================================
dispenser() { # out color light dark  (color = accent)
  local out="$1" col="$2" light="$3" dark="$4"
  newsprite 40 60 "$out"
  shadow 20 54 13
  # body (steel hopper)
  d fill-rect --x 6  --y 18 --width 28 --height 36 --color '#3a3f47'
  d fill-rect --x 28 --y 18 --width 6  --height 36 --color '#2f343b'   # right side shade
  d fill-rect --x 6  --y 18 --width 1  --height 36 --color '#565d67'   # left highlight
  # ¾ roof / hopper top
  d fill-rect --x 4  --y 12 --width 32 --height 7 --color '#4b525b'
  d fill-rect --x 4  --y 12 --width 32 --height 1 --color '#5c646e'
  d fill-rect --x 4  --y 18 --width 32 --height 1 --color '#23262c'
  # rivet studs
  d set-pixel --x 9  --y 22 --color '#565d67'
  d set-pixel --x 31 --y 22 --color '#23262c'
  d set-pixel --x 9  --y 50 --color '#565d67'
  d set-pixel --x 31 --y 50 --color '#23262c'
  # color body stripe (reads the color across the hopper)
  d fill-rect --x 6  --y 26 --width 28 --height 4 --color "$col"
  d fill-rect --x 6  --y 26 --width 28 --height 1 --color "$light"
  # glowing indicator lamp (top center)
  d fill-circle --cx 20 --cy 15 --r 3 --color "$dark"
  d fill-circle --cx 20 --cy 15 --r 2 --color "$col"
  d set-pixel   --x 20 --y 14 --color "$light"
  # chute mouth at the bottom front — dark recess framed in the color
  d fill-rect --x 11 --y 40 --width 18 --height 14 --color "$dark"
  d fill-rect --x 13 --y 42 --width 14 --height 12 --color '#14171d'   # dark opening
  d stroke-rect --x 11 --y 40 --width 18 --height 14 --color "$col"    # color surround
  # a ready package peeking out of the chute (the color)
  d fill-rect --x 15 --y 46 --width 10 --height 8 --color "$col"
  d fill-rect --x 15 --y 46 --width 10 --height 2 --color "$light"
  d stroke-rect --x 15 --y 46 --width 10 --height 8 --color '#00000055'
  # chute lip / spout
  d fill-rect --x 12 --y 38 --width 16 --height 3 --color '#565d67'
}

dispenser "$ELEM/dispenser-red.png"   '#e2503b' '#f07a63' '#a5321f'
dispenser "$ELEM/dispenser-blue.png"  '#3f8ae0' '#6fb0f2' '#275f9e'
dispenser "$ELEM/dispenser-green.png" '#46b95c' '#74d886' '#2c8440'
dispenser "$ELEM/dispenser-amber.png" '#f2b03d' '#ffd27a' '#b87e1c'

# ================================================================================
# DROP ZONES — a flat color-coded delivery PAD (inward chevrons) + a ¾ marker POST
# with a color sign board (specs/world.md, specs/cargo.md). The delivery target.
# canvas 40x56 (pad sits on the ground; post rises behind-left).
# ================================================================================
zone() { # out color light dark
  local out="$1" col="$2" light="$3" dark="$4"
  newsprite 40 56 "$out"
  # flat ground pad (a ¾ rectangle drawn slightly foreshortened)
  d fill-rect --x 4  --y 36 --width 32 --height 16 --color "$dark"
  d fill-rect --x 6  --y 38 --width 28 --height 12 --color "$col"
  d stroke-rect --x 4 --y 36 --width 32 --height 16 --color "$light"
  # hazard/target hatching corners
  d set-pixel --x 6  --y 38 --color "$light"
  d set-pixel --x 33 --y 49 --color "$light"
  # inward-pointing chevrons (deliver-here read)
  d line --x0 12 --y0 40 --x1 20 --y1 44 --color "$light"
  d line --x0 28 --y0 40 --x1 20 --y1 44 --color "$light"
  d line --x0 12 --y0 44 --x1 20 --y1 48 --color "$light"
  d line --x0 28 --y0 44 --x1 20 --y1 48 --color "$light"
  # ¾ marker post (back-left) with a color sign board
  d fill-rect --x 9  --y 10 --width 4 --height 28 --color '#3a3f47'   # post
  d fill-rect --x 9  --y 10 --width 1 --height 28 --color '#565d67'   # post highlight
  d fill-rect --x 5  --y 6  --width 18 --height 12 --color '#171b21'  # sign backing
  d fill-rect --x 7  --y 8  --width 14 --height 8  --color "$col"     # color face
  d fill-rect --x 7  --y 8  --width 14 --height 1  --color "$light"
  d stroke-rect --x 5 --y 6 --width 18 --height 12 --color "$light"
  # down-arrow icon on the sign (deliver here)
  d line --x0 14 --y0 9  --x1 14 --y1 14 --color '#171b21'
  d line --x0 11 --y0 12 --x1 14 --y1 15 --color '#171b21'
  d line --x0 17 --y0 12 --x1 14 --y1 15 --color '#171b21'
}

zone "$ELEM/zone-red.png"   '#e2503b' '#ffb3a0' '#a5321f'
zone "$ELEM/zone-blue.png"  '#3f8ae0' '#bce0ff' '#275f9e'
zone "$ELEM/zone-green.png" '#46b95c' '#b8f0c4' '#2c8440'
zone "$ELEM/zone-amber.png" '#f2b03d' '#ffe9b8' '#b87e1c'

# ================================================================================
# CROSSING SIGNALS — a 3-aspect head on a post (specs/trains.md). One produced PNG
# per lit STATE: danger (red, top) / warning (amber, mid) / clear (green, bottom).
# The active aspect is bright + haloed; the other two are dark. canvas 28x60.
# ================================================================================
# CLEAR #46c96a  WARNING #ffcf4a  DANGER #ff5a52
signal() { # out  redOn amberOn greenOn   (1 = lit)
  local out="$1" ron="$2" aon="$3" gon="$4"
  newsprite 28 60 "$out"
  shadow 14 55 8
  # post
  d fill-rect --x 12 --y 26 --width 4 --height 28 --color '#3a3f47'
  d fill-rect --x 12 --y 26 --width 1 --height 28 --color '#565d67'
  # base plate
  d fill-rect --x 8 --y 52 --width 12 --height 4 --color '#23262c'
  # signal head housing (¾ box)
  d fill-rect --x 6  --y 6  --width 16 --height 24 --color '#171b21'
  d fill-rect --x 18 --y 6  --width 4  --height 24 --color '#0e1015'   # right shade
  d fill-rect --x 6  --y 6  --width 1  --height 24 --color '#2a2f36'
  d stroke-rect --x 6 --y 6 --width 16 --height 24 --color '#2a2f36'
  # visor hoods over each lamp
  d fill-rect --x 7 --y 8  --width 14 --height 1 --color '#0e1015'
  d fill-rect --x 7 --y 15 --width 14 --height 1 --color '#0e1015'
  d fill-rect --x 7 --y 22 --width 14 --height 1 --color '#0e1015'
  # three aspects (top red, mid amber, bottom green)
  aspect() { # cy litColor bright glow  on?
    local cy="$1" lit="$2" bright="$3" glow="$4" on="$5"
    if [ "$on" = 1 ]; then
      d fill-circle --cx 14 --cy "$cy" --r 5 --color "$glow"
      d fill-circle --cx 14 --cy "$cy" --r 3 --color "$lit"
      d fill-circle --cx 14 --cy "$cy" --r 1 --color "$bright"
      d set-pixel --x 13 --y $((cy-1)) --color '#ffffff'
    else
      d fill-circle --cx 14 --cy "$cy" --r 3 --color '#2a2f36'
      d fill-circle --cx 14 --cy "$cy" --r 2 --color "$glow"   # dim tint of its color
    fi
  }
  aspect 12 '#ff5a52' '#ffd0cd' '#5a1f1d' "$ron"
  aspect 19 '#ffcf4a' '#fff0c4' '#5a4a1a' "$aon"
  aspect 26 '#46c96a' '#c4f4d2' '#1d4a2c' "$gon"
}

signal "$ELEM/signal-clear.png"   0 0 1
signal "$ELEM/signal-warning.png" 0 1 0
signal "$ELEM/signal-danger.png"  1 0 0

# ================================================================================
# JUNCTION LEVERS — a ¾ throw post whose handle leans one way (default) or the other
# (thrown) (specs/trains.md, specs/world.md). The knob is colored to show which
# branch is live: neutral steel for default, warning-amber for the diverted throw.
# canvas 32x44.
# ================================================================================
lever() { # out  thrown?
  local out="$1" thrown="$2"
  newsprite 32 44 "$out"
  shadow 16 39 9
  # base plate / housing
  d fill-rect --x 8  --y 30 --width 16 --height 8 --color '#3a3f47'
  d fill-rect --x 8  --y 30 --width 16 --height 1 --color '#565d67'
  d fill-rect --x 8  --y 37 --width 16 --height 1 --color '#23262c'
  # curved throw quadrant (two notch marks: L and R settings)
  d fill-rect --x 10 --y 26 --width 12 --height 5 --color '#23262c'
  d set-pixel --x 11 --y 27 --color '#565d67'   # left notch
  d set-pixel --x 20 --y 27 --color '#565d67'   # right notch
  # pivot
  d fill-circle --cx 16 --cy 28 --r 2 --color '#8a8f98'
  if [ "$thrown" = 1 ]; then
    # handle leans up-RIGHT — diverted branch live (amber knob)
    d line --x0 16 --y0 28 --x1 25 --y1 10 --color '#b9bec6'
    d line --x0 17 --y0 28 --x1 26 --y1 10 --color '#8a8f98'
    d fill-circle --cx 25 --cy 9 --r 4 --color '#b87e1c'
    d fill-circle --cx 25 --cy 9 --r 3 --color '#f2b03d'
    d set-pixel --x 24 --y 8 --color '#ffe9b8'
    d set-pixel --x 21 --y 27 --color '#f2b03d'   # active (right) notch glows
  else
    # handle leans up-LEFT — default branch live (steel knob)
    d line --x0 16 --y0 28 --x1 7 --y1 10 --color '#b9bec6'
    d line --x0 15 --y0 28 --x1 6 --y1 10 --color '#8a8f98'
    d fill-circle --cx 7 --cy 9 --r 4 --color '#565d67'
    d fill-circle --cx 7 --cy 9 --r 3 --color '#b9bec6'
    d set-pixel --x 6 --y 8 --color '#eef2f7'
    d set-pixel --x 11 --y 27 --color '#c4f4d2'   # active (left) notch glows
  fi
}

lever "$ELEM/lever-default.png" 0
lever "$ELEM/lever-thrown.png"  1

echo "produced Locomotivation prop assets:"
echo "  cargo/    {red,blue,green,amber}-{parcel,crate,load} (12 base)"
echo "  cargo/    unique-{red-load,red-crate,green-load,blue-crate} (4 unique)"
echo "  elements/ dispenser-{red,blue,green,amber}"
echo "  elements/ zone-{red,blue,green,amber}"
echo "  elements/ signal-{clear,warning,danger}"
echo "  elements/ lever-{default,thrown}"
