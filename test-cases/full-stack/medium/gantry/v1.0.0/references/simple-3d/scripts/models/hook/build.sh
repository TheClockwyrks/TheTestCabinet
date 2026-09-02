#!/usr/bin/env bash
# Gantry — the hook block (0.6 x 1 x 0.6 units). Palette: see ../PALETTE.md.
# Half the model's height is the hook itself: at six voxels across, the open throat is
# the only cue that reads as "hook", so everything else is kept subordinate to it.
set -euo pipefail
command -v voxel >/dev/null 2>&1 || export PATH="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release:$PATH"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$DIR/voxel.config.json"
mkdir -p "$DIR/views"
cat > "$CFG" <<JSON
{ "width": 6, "height": 8, "depth": 6, "background": "#101418",
  "actions": "$DIR/actions.json", "preview": "$DIR/preview.png", "mesh": "$DIR/mesh.glb" }
JSON
YEL='#e0a32e'; YSH='#c07f1c'; CHA='#2b3138'; MID='#4b545e'; STL='#8f9aa5'; BLK='#1b1f24'
: "$YEL$YSH$CHA$MID$STL$BLK"
v() { voxel "$@" --config "$CFG" >/dev/null; }
v init

# --- the becket the hoist cable makes off to
v fill-box --x 1 --y 7 --z 2 --width 4 --height 1 --depth 2 --color "$CHA"
# --- the block: a painted body between two cheek plates, kept to three voxels so it
# --- never out-weighs the hook slung under it
v fill-box --x 1 --y 4 --z 1 --width 4 --height 3 --depth 4 --color "$YEL"
v fill-box --x 1 --y 4 --z 1 --width 4 --height 1 --depth 4 --color "$YSH"
v fill-box --x 0 --y 4 --z 1 --width 1 --height 3 --depth 4 --color "$CHA"
v fill-box --x 5 --y 4 --z 1 --width 1 --height 3 --depth 4 --color "$CHA"
# --- the sheave pin through each cheek, so the side elevation is not a bare slab
v fill-box --x 0 --y 5 --z 2 --width 1 --height 1 --depth 2 --color "$STL"
v fill-box --x 5 --y 5 --z 2 --width 1 --height 1 --depth 2 --color "$STL"
# --- the hook proper, four of the eight voxels of height. Shoulder, the back of the
# --- bight running down, the floor sweeping across, and a short point rising to face
# --- it — with the throat between them left open.
v fill-box --x 1 --y 3 --z 2 --width 3 --height 1 --depth 2 --color "$STL"
v fill-box --x 1 --y 1 --z 2 --width 1 --height 2 --depth 2 --color "$STL"
v fill-box --x 1 --y 0 --z 2 --width 4 --height 1 --depth 2 --color "$STL"
v fill-box --x 4 --y 1 --z 2 --width 1 --height 1 --depth 2 --color "$STL"
# --- the swivel nut where the hook enters the block
v fill-box --x 2 --y 3 --z 1 --width 2 --height 1 --depth 4 --color "$MID"

voxel render --config "$CFG" --view front --out "$DIR/views/front.png" >/dev/null 2>&1
voxel render --config "$CFG" --view side  --out "$DIR/views/side.png"  >/dev/null 2>&1
voxel render --config "$CFG" --view top   --out "$DIR/views/top.png"   >/dev/null 2>&1
voxel render --config "$CFG" --view iso >/dev/null 2>&1
echo "built $(basename "$DIR"): $DIR/mesh.glb"
