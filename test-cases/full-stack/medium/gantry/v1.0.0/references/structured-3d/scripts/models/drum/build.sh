#!/usr/bin/env bash
# Gantry — the drum load class (2 x 3 x 2 units). Palette: see ../PALETTE.md. An upright storage drum: rolling hoops in real relief.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 16, "height": 24, "depth": 16, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
WOD='#a9793f'; WSH='#8a5f2e'; STR='#6e7783'; TEA='#2e6b7a'; TSH='#245663'
RST='#b8452f'; RSH='#8f3423'; ZNC='#8f9aa5'  # the yard's own steel: the drum carries no metal of its own
: "$YEL$YSH$CHA$MID$STL$BLK$WOD$WSH$STR$TEA$TSH$RST$RSH$ZNC"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the drum is stacked in alternating radii, so the hoops stand physically proud
v fill-cylinder --cx 8 --cy 0  --cz 8 --r 7 --height 2 --axis y --color "$STL"   # bottom chime
v fill-cylinder --cx 8 --cy 2  --cz 8 --r 6 --height 5 --axis y --color "$RST"
v fill-cylinder --cx 8 --cy 7  --cz 8 --r 7 --height 1 --axis y --color "$STL"   # lower rolling hoop
v fill-cylinder --cx 8 --cy 8  --cz 8 --r 6 --height 6 --axis y --color "$RST"
v fill-cylinder --cx 8 --cy 14 --cz 8 --r 7 --height 1 --axis y --color "$STL"   # upper rolling hoop
v fill-cylinder --cx 8 --cy 15 --cz 8 --r 6 --height 6 --axis y --color "$RST"
v fill-cylinder --cx 8 --cy 21 --cz 8 --r 7 --height 3 --axis y --color "$STL"   # top chime and lid
# --- a darker band around the middle: where a drum carries its markings
v fill-cylinder --cx 8 --cy 9 --cz 8 --r 6 --height 4 --axis y --color "$RSH"
# --- the welded seam, up both painted faces. Kept strictly inside the r6 body so it
# --- recolours the drum rather than adding a slab across it (fill-box fills empty cells).
v fill-box --x 7 --y 2 --z 2  --width 2 --height 19 --depth 1 --color "$RSH"
v fill-box --x 7 --y 2 --z 13 --width 2 --height 19 --depth 1 --color "$RSH"
# --- the lid: a raised centre, an offset bung, and a small vent
v fill-cylinder --cx 8 --cy 23 --cz 8 --r 5 --height 1 --axis y --color "$RSH"
v fill-box --x 3 --y 23 --z 6 --width 3 --height 1 --depth 3 --color "$BLK"
v fill-box --x 10 --y 23 --z 7 --width 2 --height 1 --depth 2 --color "$BLK"
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
