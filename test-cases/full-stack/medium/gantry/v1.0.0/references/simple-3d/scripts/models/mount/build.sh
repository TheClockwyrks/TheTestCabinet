#!/usr/bin/env bash
# Gantry — an anchor mount (1.5 x 0.75 x 1.5 units). Palette: see ../PALETTE.md. A bolted ground plate, a painted pedestal, a square machined socket.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 12, "height": 6, "depth": 12, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
: "$YEL$YSH$CHA$MID$STL$BLK"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init
# --- the ground plate, edged near-black
v fill-box   --x 0 --y 0 --z 0 --width 12 --height 2 --depth 12 --color "$CHA"
v stroke-box --x 0 --y 0 --z 0 --width 12 --height 2 --depth 12 --color "$BLK"
# --- four cardinal gussets, standing proud of the pedestal
v fill-box --x 5 --y 2 --z 1 --width 2 --height 2 --depth 2 --color "$MID"
v fill-box --x 5 --y 2 --z 9 --width 2 --height 2 --depth 2 --color "$MID"
v fill-box --x 1 --y 2 --z 5 --width 2 --height 2 --depth 2 --color "$MID"
v fill-box --x 9 --y 2 --z 5 --width 2 --height 2 --depth 2 --color "$MID"
# --- the painted pedestal
v fill-box --x 2 --y 2 --z 2 --width 8 --height 2 --depth 8 --color "$YEL"
v fill-box --x 2 --y 2 --z 2 --width 8 --height 1 --depth 8 --color "$YSH"
# --- the socket the strut seats into: a square collar, machined on top, bored through
v fill-box  --x 3 --y 4 --z 3 --width 6 --height 2 --depth 6 --color "$CHA"
v fill-box  --x 3 --y 5 --z 3 --width 6 --height 1 --depth 6 --color "$STL"
v clear-box --x 5 --y 4 --z 5 --width 2 --height 2 --depth 2
# --- four anchor studs through the plate, capped
for x in 1 9; do for z in 1 9; do
  v fill-box --x $x --y 2 --z $z --width 2 --height 1 --depth 2 --color "$STL"
  v fill-box --x $x --y 3 --z $z --width 2 --height 1 --depth 2 --color "$BLK"
done; done
voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
