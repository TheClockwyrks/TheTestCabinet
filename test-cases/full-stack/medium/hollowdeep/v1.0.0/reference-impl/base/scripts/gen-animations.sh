#!/usr/bin/env bash
# Hollowdeep — produce the delver's animated sprite-sheets with `draw-sheet`
# (specs/assets.md → "Animations", ASSETS.md → "Animations").
#
# The delver is the one thing on screen that must feel ALIVE, so it is animated
# rather than a static sprite. This script authors the four cycles the game plays,
# each as a short run of frames (draw-sheet emits ONE PNG per frame):
#
#   delver/walk/{0..5}.png   6 frames  side-view walk (leg stride + arm swing)
#   delver/dig/{0..3}.png    4 frames  mining swing (pick arcs down)
#   delver/carry/{0..3}.png  4 frames  hauling walk (carries a crate)
#   delver/idle/{0..3}.png   4 frames  breathing/looking idle
#
# One facing (EAST / right) is produced; the game mirrors it in code by `facing`.
# The delver is drawn ~20x20 inside a 32x32 frame — suit #e08a3c, helmet lamp glow
# #ffcb52, visor #47e0c8, boots #3d4552 (specs/overview.md palette).
#
# Usage:  bash scripts/gen-animations.sh   (draw-sheet must be on PATH, or built
#         under $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
if ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw-sheet" ] || { echo "draw-sheet not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEL="$ROOT/assets/delver"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# ---- palette (specs/overview.md, shaded for pixel-art volume) ----------------
SUIT='#e08a3c'   # delver suit
SHADE='#b56a24'  # suit shadow / back-lit side
HI='#f0a75a'     # suit highlight
LAMP='#ffcb52'   # helmet lamp glow
LAMPB='#ffe6a0'  # lamp hot core / beam
VIS='#47e0c8'    # visor (oxygen cyan)
VISB='#9af0e2'   # visor glint
BOOT='#3d4552'   # boots (front)
BOOTD='#2b2f38'  # boots (back, darker)
OUT='#2b2620'    # dark outline (rock)
CRATE='#566073'  # hauled crate body
CRATEB='#d9a441' # crate ore band
PICK='#a89e8d'   # pick head (steel)
HANDLE='#c9862f' # pick handle (ladder wood)
DUST='#6b6355'   # impact dust

# ---- sheet helpers -----------------------------------------------------------
newsheet() { # newsheet <dir> <frames-json>   e.g.  newsheet .../walk "[0,1,2,3,4,5]"
  mkdir -p "$1"
  printf '{ "width": 32, "height": 32, "background": "transparent", "frames": %s, "actions": "%s", "preview": "%s" }\n' \
    "$2" "$TMP/f_{frame}.json" "$1/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
sc() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ---- body parts (all take the frame index; face EAST / right) ----------------

# torso <frame> <dy> : helmet (with lamp + visor) and suited torso, bobbed by dy.
torso() {
  local f=$1 dy=$2
  # helmet dome
  sc fill-circle --frame "$f" --cx 15 --cy $((9+dy)) --r 5 --color "$OUT"
  sc fill-circle --frame "$f" --cx 15 --cy $((9+dy)) --r 4 --color "$SUIT"
  sc fill-circle --frame "$f" --cx 14 --cy $((7+dy)) --r 1 --color "$HI"
  # head-lamp on the front-top of the helmet, casting a short beam east
  sc fill-rect  --frame "$f" --x 18 --y $((6+dy)) --width 2 --height 2 --color "$LAMP"
  sc set-pixel  --frame "$f" --x 19 --y $((6+dy)) --color "$LAMPB"
  # visor across the front of the face
  sc fill-rect  --frame "$f" --x 16 --y $((9+dy)) --width 3 --height 2 --color "$VIS"
  sc set-pixel  --frame "$f" --x 18 --y $((9+dy)) --color "$VISB"
  # torso: dark outline block, then the suit inset (leaves a 1px outline)
  sc fill-rect  --frame "$f" --x 11 --y $((12+dy)) --width 8 --height 9 --color "$OUT"
  sc fill-rect  --frame "$f" --x 12 --y $((13+dy)) --width 6 --height 7 --color "$SUIT"
  sc fill-rect  --frame "$f" --x 12 --y $((13+dy)) --width 1 --height 7 --color "$SHADE"
  sc fill-rect  --frame "$f" --x 15 --y $((14+dy)) --width 2 --height 3 --color "$HI"
  sc fill-rect  --frame "$f" --x 12 --y $((19+dy)) --width 6 --height 1 --color "$BOOT"
}

# legpair <frame> <backfx> <frontfx> <dy> : two striding legs from the hip, booted.
legpair() {
  local f=$1 bfx=$2 ffx=$3 dy=$4
  local hx=15 hy=$((20+dy)) fy=28
  # back leg (in shadow)
  sc line --frame "$f" --x0 "$hx"        --y0 "$hy" --x1 "$bfx"        --y1 "$fy" --color "$OUT"
  sc line --frame "$f" --x0 $((hx+1))    --y0 "$hy" --x1 $((bfx+1))    --y1 "$fy" --color "$SHADE"
  sc fill-rect --frame "$f" --x $((bfx-1)) --y "$fy" --width 3 --height 2 --color "$BOOTD"
  # front leg (lit)
  sc line --frame "$f" --x0 "$hx"        --y0 "$hy" --x1 "$ffx"        --y1 "$fy" --color "$OUT"
  sc line --frame "$f" --x0 $((hx+1))    --y0 "$hy" --x1 $((ffx+1))    --y1 "$fy" --color "$SUIT"
  sc fill-rect --frame "$f" --x $((ffx-1)) --y "$fy" --width 3 --height 2 --color "$BOOT"
}

# swingarm <frame> <handx> <handy> <dy> : single visible arm from shoulder to hand.
swingarm() {
  local f=$1 hx=$2 hy=$3 dy=$4
  local sx=16 sy=$((14+dy))
  sc line --frame "$f" --x0 "$sx"     --y0 "$sy" --x1 "$hx"     --y1 "$hy" --color "$OUT"
  sc line --frame "$f" --x0 $((sx+1)) --y0 "$sy" --x1 $((hx+1)) --y1 "$hy" --color "$SUIT"
  sc fill-rect --frame "$f" --x "$hx" --y "$hy" --width 2 --height 2 --color "$HI"
}

# ============================ WALK (6 frames) =================================
# Side-view walk cycle: front/back legs stride, arm swings in opposition, body
# bobs up on the two passing frames.
newsheet "$DEL/walk" "[0,1,2,3,4,5]"
#            frame  backfx frontfx dy  | armx army
walk_frame() { torso "$1" "$4"; legpair "$1" "$2" "$3" "$4"; swingarm "$1" "$5" "$6" "$4"; }
walk_frame 0 12 19 0 13 20   # contact: front foot forward, arm back
walk_frame 1 13 18 0 15 20
walk_frame 2 15 15 1 18 19   # passing (bob up), arm forward
walk_frame 3 19 12 0 19 20   # contact: legs swapped, arm forward
walk_frame 4 18 13 0 17 20
walk_frame 5 15 15 1 14 19   # passing (bob up), arm back

# ============================ DIG (4 frames) =================================
# Braced stance, pick arcs down from over-the-shoulder to an impact with a dust
# spark. The arm follows the pick handle.
newsheet "$DEL/dig" "[0,1,2,3]"
dig_frame() { # frame headx heady dy [impact]
  local f=$1 hxp=$2 hyp=$3 dy=$4 impact=${5:-0}
  torso "$f" "$dy"
  legpair "$f" 12 18 "$dy"                     # feet planted, braced
  # arm reaches toward the pick hand (just short of the head)
  local sx=16 sy=$((14+dy))
  local handx=$(( (sx+hxp)/2 )) handy=$(( (sy+hyp)/2 ))
  sc line --frame "$f" --x0 "$sx"     --y0 "$sy" --x1 "$handx"     --y1 "$handy" --color "$OUT"
  sc line --frame "$f" --x0 $((sx+1)) --y0 "$sy" --x1 $((handx+1)) --y1 "$handy" --color "$SUIT"
  # pick handle from the hand out to the head, then the steel head
  sc line --frame "$f" --x0 "$handx" --y0 "$handy" --x1 "$hxp" --y1 "$hyp" --color "$HANDLE"
  sc fill-rect --frame "$f" --x $((hxp-1)) --y $((hyp-1)) --width 3 --height 2 --color "$PICK"
  sc set-pixel --frame "$f" --x $((hxp+1)) --y "$hyp" --color "$PICK"
  if [ "$impact" = 1 ]; then                   # dust puff at the strike
    sc set-pixel --frame "$f" --x $((hxp+2)) --y $((hyp+1)) --color "$DUST"
    sc set-pixel --frame "$f" --x $((hxp+1)) --y $((hyp+2)) --color "$LAMPB"
    sc set-pixel --frame "$f" --x $((hxp+3)) --y "$hyp"     --color "$DUST"
  fi
}
dig_frame 0 24 5  0        # raised over the shoulder
dig_frame 1 26 10 0
dig_frame 2 26 16 1        # sweeping down, slight crouch
dig_frame 3 25 20 1 1      # impact + dust

# ============================ CARRY (4 frames) ===============================
# Hauling walk: both arms forward gripping a crate; smaller, careful stride.
newsheet "$DEL/carry" "[0,1,2,3]"
carry_frame() { # frame backfx frontfx dy
  local f=$1 bfx=$2 ffx=$3 dy=$4
  torso "$f" "$dy"
  legpair "$f" "$bfx" "$ffx" "$dy"
  # crate held out front (east) at chest height
  local cx=19 cy=$((14+dy))
  sc fill-rect --frame "$f" --x "$cx"       --y "$cy"       --width 7 --height 7 --color "$OUT"
  sc fill-rect --frame "$f" --x $((cx+1))   --y $((cy+1))   --width 5 --height 5 --color "$CRATE"
  sc fill-rect --frame "$f" --x $((cx+1))   --y $((cy+3))   --width 5 --height 1 --color "$CRATEB"
  sc set-pixel --frame "$f" --x $((cx+2))   --y $((cy+1))   --color "$VISB"
  # both arms reach from the shoulder to grip the crate's near face
  local sy=$((14+dy))
  sc line --frame "$f" --x0 16 --y0 "$sy"       --x1 $((cx-1)) --y1 $((cy+1)) --color "$SHADE"
  sc line --frame "$f" --x0 16 --y0 $((sy+2))   --x1 $((cx-1)) --y1 $((cy+4)) --color "$SUIT"
}
carry_frame 0 13 18 0
carry_frame 1 15 15 1        # passing (bob)
carry_frame 2 18 13 0
carry_frame 3 15 15 1        # passing (bob)

# ============================ IDLE (4 frames) ================================
# A jobless delver: slow breathing bob, a resting arm, and a flickering lamp beam.
newsheet "$DEL/idle" "[0,1,2,3]"
idle_frame() { # frame dy beam
  local f=$1 dy=$2 beam=$3
  torso "$f" "$dy"
  legpair "$f" 13 17 "$dy"                     # feet at rest, slightly apart
  swingarm "$f" 18 $((20+dy)) "$dy"            # arm hangs at the side
  if [ "$beam" = 1 ]; then                     # lamp glow reaches a touch further
    sc set-pixel --frame "$f" --x 21 --y $((7+dy)) --color "$LAMPB"
    sc set-pixel --frame "$f" --x 22 --y $((7+dy)) --color "$LAMP"
  fi
}
idle_frame 0 0 0
idle_frame 1 0 1             # inhale — lamp brightens
idle_frame 2 1 1             # chest rises (bob)
idle_frame 3 0 0             # exhale

echo "produced delver walk/dig/carry/idle sheets under $DEL"
