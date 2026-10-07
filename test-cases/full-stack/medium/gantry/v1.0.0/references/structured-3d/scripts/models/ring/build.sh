#!/usr/bin/env bash
# Gantry — the slew ring (2.5 x 2 x 2.5 units). Palette: see ../PALETTE.md. A squat bearing drum stacked in collars between two bolted flange plates.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 20, "height": 16, "depth": 20, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
: "$YEL$YSH$CHA$MID$STL$BLK"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the two flange plates the ring bolts between
v fill-box --x 0 --y 0  --z 0 --width 20 --height 2 --depth 20 --color "$CHA"
v fill-box --x 0 --y 14 --z 0 --width 20 --height 2 --depth 20 --color "$CHA"
# --- the bearing itself, stacked so the raceway and the collars stand in real relief:
# --- collar, painted body, the machined raceway, painted body, collar.
v fill-cylinder --cx 10 --cy 2  --cz 10 --r 8 --height 1 --axis y --color "$MID"
v fill-cylinder --cx 10 --cy 3  --cz 10 --r 7 --height 4 --axis y --color "$YEL"
v fill-cylinder --cx 10 --cy 7  --cz 10 --r 8 --height 2 --axis y --color "$STL"
v fill-cylinder --cx 10 --cy 9  --cz 10 --r 7 --height 4 --axis y --color "$YEL"
v fill-cylinder --cx 10 --cy 13 --cz 10 --r 8 --height 1 --axis y --color "$MID"
# --- the painted body is shadowed where it tucks under each collar
v fill-cylinder --cx 10 --cy 3  --cz 10 --r 7 --height 1 --axis y --color "$YSH"
v fill-cylinder --cx 10 --cy 12 --cz 10 --r 7 --height 1 --axis y --color "$YSH"
# --- one flange corner, bossed and bolted; mirrored into all four
v fill-box --x 0 --y 0  --z 0 --width 5 --height 2 --depth 5 --color "$MID"
v fill-box --x 0 --y 14 --z 0 --width 5 --height 2 --depth 5 --color "$MID"
v fill-box --x 1 --y 2  --z 1 --width 2 --height 1 --depth 2 --color "$BLK"
v fill-box --x 1 --y 13 --z 1 --width 2 --height 1 --depth 2 --color "$BLK"
# --- bolt heads round the collars, on the cardinal faces
v fill-box --x 9 --y 2  --z 2 --width 2 --height 2 --depth 1 --color "$BLK"
v fill-box --x 9 --y 12 --z 2 --width 2 --height 2 --depth 1 --color "$BLK"
v fill-box --x 2 --y 2  --z 9 --width 1 --height 2 --depth 2 --color "$BLK"
v fill-box --x 2 --y 12 --z 9 --width 1 --height 2 --depth 2 --color "$BLK"
# --- four-fold symmetry
v mirror --plane x --at 10
v mirror --plane z --at 10
# --- and, once symmetric, a single index mark so the ring's rotation reads
v fill-box --x 9 --y 15 --z 2 --width 2 --height 1 --depth 7 --color "$BLK"
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
