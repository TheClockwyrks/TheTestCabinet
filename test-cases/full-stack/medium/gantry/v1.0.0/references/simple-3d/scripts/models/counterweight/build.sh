#!/usr/bin/env bash
# Gantry — a counterweight (1.5 x 1.5 x 1.5 units). Palette: see ../PALETTE.md. A dense charcoal ballast block, hazard-banded, lugs on top.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 12, "height": 12, "depth": 12, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
WOD='#a9793f'; WSH='#8a5f2e'; STR='#6e7783'; TEA='#2e6b7a'; TSH='#245663'
RST='#b8452f'; RSH='#8f3423'; ZNC='#c9ced4'
: "$YEL$YSH$CHA$MID$STL$BLK$WOD$WSH$STR$TEA$TSH$RST$RSH$ZNC"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the mass itself
v fill-box --x 0 --y 0 --z 0 --width 12 --height 12 --depth 12 --color "$CHA"
# --- machined cap and base slabs
v fill-box --x 0 --y 0  --z 0 --width 12 --height 2 --depth 12 --color "$MID"
v fill-box --x 0 --y 10 --z 0 --width 12 --height 2 --depth 12 --color "$MID"
# --- the hazard band, wrapping all four sides so it reads from any angle
for i in 0 4 8; do
  v fill-box --x $i       --y 4 --z 0        --width 2  --height 4 --depth 1  --color "$YEL"
  v fill-box --x $((i+2)) --y 4 --z 0        --width 2  --height 4 --depth 1  --color "$BLK"
  v fill-box --x $i       --y 4 --z 11       --width 2  --height 4 --depth 1  --color "$YEL"
  v fill-box --x $((i+2)) --y 4 --z 11       --width 2  --height 4 --depth 1  --color "$BLK"
  v fill-box --x 0        --y 4 --z $i       --width 1  --height 4 --depth 2  --color "$YEL"
  v fill-box --x 0        --y 4 --z $((i+2)) --width 1  --height 4 --depth 2  --color "$BLK"
  v fill-box --x 11       --y 4 --z $i       --width 1  --height 4 --depth 2  --color "$YEL"
  v fill-box --x 11       --y 4 --z $((i+2)) --width 1  --height 4 --depth 2  --color "$BLK"
done
# --- near-black edges: the silhouette every crane part carries
v stroke-box --x 0 --y 0 --z 0 --width 12 --height 12 --depth 12 --color "$BLK"
# --- two lifting lugs on the top face
v fill-box --x 2 --y 10 --z 5 --width 2 --height 2 --depth 2 --color "$STL"
v fill-box --x 8 --y 10 --z 5 --width 2 --height 2 --depth 2 --color "$STL"
# --- corner bolt heads on the cap
for x in 1 9; do for z in 1 9; do
  v fill-box --x $x --y 11 --z $z --width 2 --height 1 --depth 2 --color "$BLK"
done; done
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
