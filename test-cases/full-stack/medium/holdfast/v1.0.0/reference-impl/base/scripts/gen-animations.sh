#!/usr/bin/env bash
# Holdfast — produce the ANIMATED sprite-sheets for the living units with `draw-sheet`
# (specs/assets.md §"Animations", ASSETS.md §2). Every cycle is drawn one east-facing
# facing; the game mirrors/rotates it in code. `draw-sheet` emits one separate PNG per
# frame, so each cycle lands as `<dir>/N.png`. Re-run to regenerate.
#
#   settler/walk   4 frames   top-down walk cycle (legs alternate, slight bob)
#   settler/work   4 frames   tool raises + strikes (chop / mine / build)
#   settler/fight  4 frames   braced shooting pose, muzzle flash on the fire frame
#   settler/downed 2 frames   collapsed, bleeding-out settler
#   raider/walk    4 frames   hunched, hostile advance (distinct silhouette)
#   raider/fight   4 frames   firing pose, muzzle flash on the fire frame
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
A="$ROOT/assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# 24x24 transparent cycle; $1 = output dir, $2 = frame list (e.g. "0,1,2,3").
newsheet() {
  mkdir -p "$1"
  printf '{ "width": 24, "height": 24, "background": "transparent", "frames": [%s], "actions": "%s", "preview": "%s" }\n' \
    "$2" "$TMP/f_{frame}.json" "$1/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# --- shared building blocks ----------------------------------------------------
# soft ground shadow (drawn first, under everything)
shadow() { s fill-circle --frame "$1" --cx 12 --cy 20 --r 6 --color '#12100b55'; }

# two feet poking out north/south of the torso; $2 north-cx, $3 south-cx, $4 boot color
legs() {
  s fill-circle --frame "$1" --cx "$2" --cy 5  --r 2 --color "$4"
  s fill-circle --frame "$1" --cx "$3" --cy 19 --r 2 --color "$4"
}

# settler torso + forward helmet + visor (front = east); $1 frame, $2 torso-cy
sbody() {
  local f=$1 cy=$2
  s fill-circle --frame "$f" --cx 12 --cy "$cy" --r 6 --color '#2f5c85'                 # dark rim
  s fill-circle --frame "$f" --cx 12 --cy "$cy" --r 5 --color '#4f93c9'                 # body
  s fill-circle --frame "$f" --cx 10 --cy $((cy-2)) --r 1 --color '#6aa8d8'             # back highlight
  s fill-circle --frame "$f" --cx 14 --cy "$cy" --r 3 --color '#cfe3f2'                 # helmet (forward)
  s fill-rect   --frame "$f" --x 17 --y $((cy-1)) --width 2 --height 3 --color '#2f5c85' # visor slit
}

# raider torso + hunched dark-masked head (front = east); $1 frame, $2 torso-cy
rbody() {
  local f=$1 cy=$2
  s fill-circle --frame "$f" --cx 12 --cy "$cy" --r 6 --color '#7a2b26'                 # dark rim
  s fill-circle --frame "$f" --cx 12 --cy "$cy" --r 5 --color '#c0473f'                 # body
  s fill-rect   --frame "$f" --x 5 --y $((cy-2)) --width 3 --height 5 --color '#7a2b26' # hunched back bulk (west)
  s fill-circle --frame "$f" --cx 15 --cy $((cy+1)) --r 3 --color '#7a2b26'             # head forward+low
  s fill-circle --frame "$f" --cx 15 --cy $((cy+1)) --r 2 --color '#38332c'             # mask
  s set-pixel   --frame "$f" --x 16 --y "$cy" --color '#ff5a52'                         # red eye
  s set-pixel   --frame "$f" --x 16 --y $((cy+2)) --color '#ff5a52'                     # red eye
}

# gun barrel pointing east from the torso; $1 frame, $2 torso-cy
gun() { s fill-rect --frame "$1" --x 13 --y "$2" --width 9 --height 2 --color '#38332c'; }
# muzzle flash at the barrel tip; $1 frame, $2 torso-cy, $3 radius
muzzle() {
  s fill-circle --frame "$1" --cx 23 --cy $(($2+1)) --r "$3"        --color '#ffcf6a'
  s fill-circle --frame "$1" --cx 23 --cy $(($2+1)) --r $(($3-1))   --color '#ffffff'
}

# ============================ SETTLER walk =====================================
newsheet "$A/settler/walk" "0,1,2,3"
# f0: north foot forward (east), south foot back (west)
shadow 0; legs 0 15 9  '#2f5c85'; sbody 0 12
# f1: mid-stride, body bobs up 1px
shadow 1; legs 1 12 12 '#2f5c85'; sbody 1 11
# f2: opposite stride
shadow 2; legs 2 9 15  '#2f5c85'; sbody 2 12
# f3: mid-stride, bob
shadow 3; legs 3 12 12 '#2f5c85'; sbody 3 11

# ============================ SETTLER work (tool swing) ========================
# legs planted; a wood-handled, ore-headed tool raises (f0) and strikes down (f2).
newsheet "$A/settler/work" "0,1,2,3"
# f0 — raised high
shadow 0; legs 0 12 12 '#2f5c85'; sbody 0 12
s line --frame 0 --x0 14 --y0 11 --x1 20 --y1 3 --color '#b98b4e'
s fill-circle --frame 0 --cx 20 --cy 3 --r 2 --color '#c9a24a'
# f1 — swinging down
shadow 1; legs 1 12 12 '#2f5c85'; sbody 1 12
s line --frame 1 --x0 14 --y0 11 --x1 22 --y1 8 --color '#b98b4e'
s fill-circle --frame 1 --cx 22 --cy 8 --r 2 --color '#c9a24a'
# f2 — struck (impact, tool low-east)
shadow 2; legs 2 12 12 '#2f5c85'; sbody 2 13
s line --frame 2 --x0 14 --y0 13 --x1 22 --y1 16 --color '#b98b4e'
s fill-circle --frame 2 --cx 22 --cy 16 --r 2 --color '#c9a24a'
# f3 — recovering up
shadow 3; legs 3 12 12 '#2f5c85'; sbody 3 12
s line --frame 3 --x0 14 --y0 11 --x1 21 --y1 10 --color '#b98b4e'
s fill-circle --frame 3 --cx 21 --cy 10 --r 2 --color '#c9a24a'

# ============================ SETTLER fight (shooting) =========================
# braced (feet apart), gun east, muzzle flashes on the fire frame (f1), fades f2.
newsheet "$A/settler/fight" "0,1,2,3"
shadow 0; legs 0 9 15 '#2f5c85'; sbody 0 12; gun 0 12                         # aim, steady
shadow 1; legs 1 9 15 '#2f5c85'; sbody 1 12; gun 1 12; muzzle 1 12 3         # FIRE
shadow 2; legs 2 9 15 '#2f5c85'; sbody 2 12; gun 2 12; muzzle 2 12 2         # flash fading
shadow 3; legs 3 9 15 '#2f5c85'; sbody 3 12; gun 3 12                         # steady

# ============================ SETTLER downed (bleeding out) ====================
# collapsed east, dim body, growing blood pool.
newsheet "$A/settler/downed" "0,1"
s fill-circle --frame 0 --cx 12 --cy 21 --r 7 --color '#12100b55'
s fill-circle --frame 0 --cx 12 --cy 14 --r 5 --color '#3a6e97'
s fill-circle --frame 0 --cx 17 --cy 15 --r 3 --color '#8fb0cc'
s fill-circle --frame 0 --cx 7  --cy 17 --r 3 --color '#e05a6a'
s fill-circle --frame 0 --cx 7  --cy 17 --r 1 --color '#c0473f'
s fill-circle --frame 1 --cx 12 --cy 21 --r 7 --color '#12100b55'
s fill-circle --frame 1 --cx 12 --cy 14 --r 5 --color '#3a6e97'
s fill-circle --frame 1 --cx 17 --cy 15 --r 3 --color '#8fb0cc'
s fill-circle --frame 1 --cx 6  --cy 17 --r 4 --color '#e05a6a'
s fill-circle --frame 1 --cx 6  --cy 17 --r 2 --color '#c0473f'

# ============================ RAIDER walk ======================================
newsheet "$A/raider/walk" "0,1,2,3"
shadow 0; legs 0 15 9  '#38332c'; rbody 0 12
shadow 1; legs 1 12 12 '#38332c'; rbody 1 11
shadow 2; legs 2 9 15  '#38332c'; rbody 2 12
shadow 3; legs 3 12 12 '#38332c'; rbody 3 11

# ============================ RAIDER fight (shooting) ==========================
newsheet "$A/raider/fight" "0,1,2,3"
shadow 0; legs 0 9 15 '#38332c'; rbody 0 12; gun 0 12
shadow 1; legs 1 9 15 '#38332c'; rbody 1 12; gun 1 12; muzzle 1 12 3
shadow 2; legs 2 9 15 '#38332c'; rbody 2 12; gun 2 12; muzzle 2 12 2
shadow 3; legs 3 9 15 '#38332c'; rbody 3 12; gun 3 12

echo "produced settler + raider animation cycles under $A/{settler,raider}"
