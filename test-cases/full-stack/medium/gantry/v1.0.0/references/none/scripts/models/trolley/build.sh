#!/usr/bin/env bash
# Gantry — the trolley (1.5 x 1 x 1.5 units). Palette: see ../PALETTE.md. Sheave below, painted body, and two painted bogie cheeks with the rail channel between them.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 12, "height": 8, "depth": 12, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
: "$YEL$YSH$CHA$MID$STL$BLK"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the sheave housing under the body, where the hoist cable leaves
v fill-box --x 3 --y 0 --z 3 --width 6 --height 1 --depth 6 --color "$CHA"
v fill-cylinder --cx 6 --cy 0 --cz 6 --r 2 --height 1 --axis y --color "$STL"
# --- the painted body, shadowed underneath
v fill-box --x 1 --y 1 --z 1 --width 10 --height 4 --depth 10 --color "$YEL"
v fill-box --x 1 --y 1 --z 1 --width 10 --height 1 --depth 10 --color "$YSH"
# --- two ribs recoloured through the body, so the flanks are not a bare slab
v fill-box --x 3 --y 1 --z 1 --width 1 --height 4 --depth 10 --color "$MID"
v fill-box --x 8 --y 1 --z 1 --width 1 --height 4 --depth 10 --color "$MID"
# --- charcoal end caps, hazard-striped: the ends of the carriage
for x in 0 11; do
  v fill-box --x $x --y 1 --z 1 --width 1 --height 4 --depth 10 --color "$CHA"
  v fill-box --x $x --y 1 --z 2 --width 1 --height 4 --depth 2 --color "$BLK"
  v fill-box --x $x --y 1 --z 7 --width 1 --height 4 --depth 2 --color "$BLK"
done
# --- the deck plate
v fill-box --x 1 --y 5 --z 1 --width 10 --height 1 --depth 10 --color "$CHA"
# --- the two bogie cheeks, painted like the body and capped in charcoal where the
# --- rail bears. The gap between them IS the channel the rail runs in.
for z in 1 9; do
  v fill-box --x 1 --y 6 --z $z --width 10 --height 2 --depth 2 --color "$YEL"
  v fill-box --x 1 --y 7 --z $z --width 10 --height 1 --depth 2 --color "$CHA"
done
# --- four running rollers, standing proud OUTBOARD of the cheeks so they read as
# --- wheels rather than as panels let into them
for x in 2 8; do for z in 0 11; do
  v fill-box --x $x --y 6 --z $z --width 2 --height 2 --depth 1 --color "$STL"
done; done
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
