#!/usr/bin/env bash
# Gantry — the container load class (4 x 2 x 2 units). Palette: see ../PALETTE.md. Corrugated teal box, corner castings, doors at one end.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 32, "height": 16, "depth": 16, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
WOD='#a9793f'; WSH='#8a5f2e'; STR='#6e7783'; TEA='#2e6b7a'; TSH='#245663'
RST='#b8452f'; RSH='#8f3423'; ZNC='#c9ced4'
: "$YEL$YSH$CHA$MID$STL$BLK$WOD$WSH$STR$TEA$TSH$RST$RSH$ZNC"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the box, filling the class box exactly
v fill-box --x 0 --y 0 --z 0 --width 32 --height 16 --depth 16 --color "$TEA"
# --- corrugations: vertical ribs down both long sides (slab recolours; interior is never drawn)
for i in 3 5 7 9 11 13 15 17 19 21 23 25 27; do
  v fill-box --x $i --y 2 --z 0 --width 1 --height 12 --depth 16 --color "$TSH"
done
# --- top and bottom rails
v fill-box --x 0 --y 0  --z 0 --width 32 --height 2 --depth 16 --color "$TSH"
v fill-box --x 0 --y 14 --z 0 --width 32 --height 2 --depth 16 --color "$TSH"
# --- the four vertical corner posts
for x in 0 30; do for z in 0 14; do
  v fill-box --x $x --y 0 --z $z --width 2 --height 16 --depth 2 --color "$TSH"
done; done
# --- corner castings: the eight steel blocks a container is actually lifted by
for x in 0 29; do for y in 0 13; do for z in 0 13; do
  v fill-box --x $x --y $y --z $z --width 3 --height 3 --depth 3 --color "$STL"
done; done; done
# --- roof ribs
for i in 6 12 18 24; do
  v fill-box --x $i --y 15 --z 3 --width 1 --height 1 --depth 10 --color "$TSH"
done
# --- the doors, at the far end: two leaves, a centre seam, and locking bars
v fill-box --x 31 --y 3 --z 3 --width 1 --height 11 --depth 10 --color "$TSH"
v fill-box --x 31 --y 3 --z 7 --width 1 --height 11 --depth 2  --color "$BLK"
for z in 4 10; do
  v fill-box --x 31 --y 3 --z $z --width 1 --height 11 --depth 1 --color "$STL"
done
v fill-box --x 31 --y 8 --z 4 --width 1 --height 1 --depth 3 --color "$STL"
v fill-box --x 31 --y 8 --z 9 --width 1 --height 1 --depth 3 --color "$STL"
# --- a stencilled placard on both long sides
for z in 0 15; do
  v fill-box --x 8 --y 8 --z $z --width 9 --height 4 --depth 1 --color "$BLK"
  v fill-box --x 9 --y 9 --z $z --width 7 --height 2 --depth 1 --color "$STL"
done
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
