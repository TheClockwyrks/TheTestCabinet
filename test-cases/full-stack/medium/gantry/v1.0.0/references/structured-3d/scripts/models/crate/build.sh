#!/usr/bin/env bash
# Gantry — the crate load class (2 x 2 x 2 units). Palette: see ../PALETTE.md. Timber, banded and battened; fills its class box.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 16, "height": 16, "depth": 16, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
WOD='#a9793f'; WSH='#8a5f2e'; STR='#6e7783'; TEA='#2e6b7a'; TSH='#245663'
RST='#b8452f'; RSH='#8f3423'; ZNC='#c9ced4'
: "$YEL$YSH$CHA$MID$STL$BLK$WOD$WSH$STR$TEA$TSH$RST$RSH$ZNC"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the timber body, filling the class box exactly
v fill-box --x 0 --y 0 --z 0 --width 16 --height 16 --depth 16 --color "$WOD"
# --- plank seams, wrapping every side (a full slab recolor; the interior is never drawn)
for y in 3 7 11; do
  v fill-box --x 0 --y $y --z 0 --width 16 --height 1 --depth 16 --color "$WSH"
done
# --- corner battens: four uprights and the top and bottom frames
for x in 0 14; do for z in 0 14; do
  v fill-box --x $x --y 0 --z $z --width 2 --height 16 --depth 2 --color "$WSH"
done; done
for y in 0 14; do
  v fill-box --x 0  --y $y --z 0  --width 16 --height 2 --depth 2  --color "$WSH"
  v fill-box --x 0  --y $y --z 14 --width 16 --height 2 --depth 2  --color "$WSH"
  v fill-box --x 0  --y $y --z 0  --width 2  --height 2 --depth 16 --color "$WSH"
  v fill-box --x 14 --y $y --z 0  --width 2  --height 2 --depth 16 --color "$WSH"
done
# --- steel strap brackets at all eight corners
for x in 0 14; do for y in 0 14; do for z in 0 14; do
  v fill-box --x $x --y $y --z $z --width 2 --height 2 --depth 2 --color "$STR"
done; done; done
# --- a stencilled shipping placard on the front and back faces
for z in 0 15; do
  v fill-box --x 5 --y 6 --z $z --width 6 --height 5 --depth 1 --color "$STR"
  v fill-box --x 6 --y 9 --z $z --width 4 --height 1 --depth 1 --color "$BLK"
  v fill-box --x 6 --y 7 --z $z --width 4 --height 1 --depth 1 --color "$BLK"
done
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
