#!/usr/bin/env bash
# Midway — produce the ANIMATED sprite-sheets (the living units) with `draw-sheet`
# (ASSETS.md §2, specs/assets.md "Animations"). Every frame is a separate PNG on a
# small transparent (straight-alpha) pixel-art canvas, in the overview.md palette.
#
# Covers exactly ASSETS.md §2:
#   §2a Guests  assets/guest/{walk,happy,angry,eating}/{0..3}.png   16×16, 4f
#   §2b Staff   assets/staff/{janitor,mechanic,entertainer}/{0..3}.png 16×16, 4f
#   §2c Rides   assets/ride/carousel/{0..5}.png    72×72, 6f
#               assets/ride/coaster/{0..3}.png      96×72, 4f
#               assets/ride/drop_tower/{0..5}.png   48×48, 6f
#
# Re-run to regenerate.  Usage:  bash scripts/gen-animations.sh
# (draw-sheet must be on PATH, or built under $CARGO_TARGET_DIR/release — the
#  devcontainer's cargo target volume.)
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir.
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

# --- sheet helpers ------------------------------------------------------------
# newsheet <dir> <w> <h> <frames-csv>  -> init one PNG per frame into <dir>/{i}.png
newsheet() {
  mkdir -p "$1"
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [%s], "actions": "%s", "preview": "%s" }\n' \
    "$2" "$3" "$4" "$TMP/f_{frame}.json" "$1/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }
# pos <angle-deg> <radius> <cx> <cy>  -> "x y" on the circle (integer, for the carousel ring)
pos() { awk -v a="$1" -v r="$2" -v cx="$3" -v cy="$4" \
  'BEGIN{p=3.14159265;printf "%d %d\n", cx+r*cos(a*p/180)+0.5, cy+r*sin(a*p/180)+0.5}'; }

# ============================ §2a GUESTS (16×16, 4f, body #ff8fb0) =============
# A shared little round person; head keeps the guest pink, the shirt/shade carries
# the state color so a glance reads the crowd's mood (specs/guests.md).
gbody() { # gbody <frame> <shirt> <shade>
  s fill-circle --frame "$1" --cx 8 --cy 5 --r 3 --color "$3"   # head outline
  s fill-circle --frame "$1" --cx 8 --cy 5 --r 2 --color '#ff8fb0'
  s set-pixel   --frame "$1" --x 7 --y 4 --color '#ffc0d4'       # face highlight
  s fill-rect --frame "$1" --x 5 --y 8 --width 6 --height 5 --color "$3"  # torso outline
  s fill-rect --frame "$1" --x 6 --y 8 --width 4 --height 4 --color "$2"  # shirt
}
foot() { s fill-rect --frame "$1" --x "$2" --y "$3" --width 2 --height 2 --color "$4"; }
arm()  { s fill-rect --frame "$1" --x "$2" --y "$3" --width 2 --height 2 --color "$4"; }

# --- walk: neutral pink, swinging arms, alternating legs ----------------------
newsheet "$A/guest/walk" 16 16 "0,1,2,3"
for f in 0 1 2 3; do gbody "$f" '#ff8fb0' '#c46b86'; done
arm 0 3 9 '#c46b86'; arm 0 11 10 '#c46b86'; foot 0 5 12 '#c46b86'; foot 0 9 13 '#c46b86'
arm 1 4 10 '#c46b86'; arm 1 11 10 '#c46b86'; foot 1 6 13 '#c46b86'; foot 1 8 13 '#c46b86'
arm 2 4 10 '#c46b86'; arm 2 11 9 '#c46b86';  foot 2 5 13 '#c46b86'; foot 2 9 12 '#c46b86'
arm 3 4 10 '#c46b86'; arm 3 11 10 '#c46b86'; foot 3 6 13 '#c46b86'; foot 3 8 13 '#c46b86'

# --- happy: yellow shirt, arms raised, smile, sparkles, bounce ----------------
newsheet "$A/guest/happy" 16 16 "0,1,2,3"
for f in 0 1 2 3; do gbody "$f" '#ffd24a' '#c9a02f'; done
for f in 0 1 2 3; do  # smile
  s set-pixel --frame "$f" --x 7 --y 6 --color '#c9a02f'
  s set-pixel --frame "$f" --x 9 --y 6 --color '#c9a02f'
  s set-pixel --frame "$f" --x 8 --y 7 --color '#c9a02f'
done
arm 0 3 6 '#c9a02f'; arm 0 11 6 '#c9a02f'; foot 0 6 13 '#c9a02f'; foot 0 8 13 '#c9a02f'
arm 1 3 7 '#c9a02f'; arm 1 11 7 '#c9a02f'; foot 1 6 12 '#c9a02f'; foot 1 8 12 '#c9a02f'
arm 2 3 6 '#c9a02f'; arm 2 11 6 '#c9a02f'; foot 2 6 13 '#c9a02f'; foot 2 8 13 '#c9a02f'
arm 3 3 7 '#c9a02f'; arm 3 11 7 '#c9a02f'; foot 3 6 12 '#c9a02f'; foot 3 8 12 '#c9a02f'
s set-pixel --frame 0 --x 13 --y 2 --color '#ffffff'; s set-pixel --frame 0 --x 2 --y 3 --color '#ffd24a'
s set-pixel --frame 1 --x 2 --y 2 --color '#ffffff';  s set-pixel --frame 1 --x 13 --y 3 --color '#ffd24a'
s set-pixel --frame 2 --x 12 --y 1 --color '#ffffff'; s set-pixel --frame 2 --x 3 --y 2 --color '#ffd24a'
s set-pixel --frame 3 --x 3 --y 1 --color '#ffffff';  s set-pixel --frame 3 --x 12 --y 2 --color '#ffd24a'

# --- angry: red shirt, flushed cheeks, frown, anger marks, stomping ----------
newsheet "$A/guest/angry" 16 16 "0,1,2,3"
for f in 0 1 2 3; do
  gbody "$f" '#ff5a52' '#b83b34'
  s set-pixel --frame "$f" --x 5 --y 5 --color '#ff5a52'   # flushed cheeks
  s set-pixel --frame "$f" --x 11 --y 5 --color '#ff5a52'
  s set-pixel --frame "$f" --x 7 --y 6 --color '#b83b34'   # flat frown
  s set-pixel --frame "$f" --x 8 --y 6 --color '#b83b34'
  s set-pixel --frame "$f" --x 9 --y 6 --color '#b83b34'
done
arm 0 3 10 '#b83b34'; arm 0 11 10 '#b83b34'; foot 0 4 12 '#b83b34'; foot 0 10 13 '#b83b34'
arm 1 3 10 '#b83b34'; arm 1 11 10 '#b83b34'; foot 1 6 13 '#b83b34'; foot 1 8 13 '#b83b34'
arm 2 3 10 '#b83b34'; arm 2 11 10 '#b83b34'; foot 2 4 13 '#b83b34'; foot 2 10 12 '#b83b34'
arm 3 3 10 '#b83b34'; arm 3 11 10 '#b83b34'; foot 3 6 13 '#b83b34'; foot 3 8 13 '#b83b34'
# anger "steam" marks, rising
s set-pixel --frame 0 --x 12 --y 2 --color '#ff5a52'; s set-pixel --frame 0 --x 13 --y 3 --color '#ff5a52'
s set-pixel --frame 1 --x 12 --y 1 --color '#ff5a52'; s set-pixel --frame 1 --x 13 --y 2 --color '#ff5a52'
s set-pixel --frame 2 --x 12 --y 2 --color '#ff5a52'; s set-pixel --frame 2 --x 13 --y 3 --color '#ff5a52'
s set-pixel --frame 3 --x 12 --y 1 --color '#ff5a52'; s set-pixel --frame 3 --x 13 --y 2 --color '#ff5a52'

# --- eating: orange shirt, one arm raising food to mouth ----------------------
newsheet "$A/guest/eating" 16 16 "0,1,2,3"
for f in 0 1 2 3; do gbody "$f" '#f59042' '#b96a26'; done
# static-ish legs (standing), left arm resting
for f in 0 1 2 3; do arm "$f" 3 10 '#b96a26'; done
foot 0 6 13 '#b96a26'; foot 0 8 13 '#b96a26'
foot 1 6 12 '#b96a26'; foot 1 8 13 '#b96a26'
foot 2 6 13 '#b96a26'; foot 2 8 12 '#b96a26'
foot 3 6 13 '#b96a26'; foot 3 8 13 '#b96a26'
# food item (raise → mouth → chew → lower) with the eating hand
efood() { # <frame> <fx> <fy>
  arm "$1" "$2" "$3" '#ff8fb0'                                  # hand
  s fill-circle --frame "$1" --cx $(( $2 + 1 )) --cy "$3" --r 1 --color '#f59042'
  s set-pixel   --frame "$1" --x "$2" --y "$3" --color '#ffcb52'
}
efood 0 11 11
efood 1 10 8
efood 2 9 6;  s set-pixel --frame 2 --x 8 --y 6 --color '#b96a26'   # chewing mouth
efood 3 10 9

# ============================ §2b STAFF (16×16, 4f) ===========================
# Capped worker with a tool — reads distinct from a bare-headed guest.
staff_base() { # <frame> <uniform> <shade>
  s fill-circle --frame "$1" --cx 8 --cy 5 --r 3 --color "$3"
  s fill-circle --frame "$1" --cx 8 --cy 5 --r 2 --color '#f2efe8'   # face
  s fill-rect --frame "$1" --x 4 --y 2 --width 8 --height 2 --color "$2"  # cap dome
  s fill-rect --frame "$1" --x 4 --y 4 --width 8 --height 1 --color "$3"  # cap brim
  s set-pixel --frame "$1" --x 7 --y 5 --color '#16202f'
  s set-pixel --frame "$1" --x 9 --y 5 --color '#16202f'
  s fill-rect --frame "$1" --x 5 --y 8 --width 6 --height 5 --color "$3"   # torso outline
  s fill-rect --frame "$1" --x 6 --y 8 --width 4 --height 4 --color "$2"   # uniform
}
staff_legs() { # <frame> <lx> <ly> <rx> <ry> <shade>
  foot "$1" "$2" "$3" "$6"; foot "$1" "$4" "$5" "$6"
}

# --- janitor: teal uniform, straw broom sweeping ------------------------------
newsheet "$A/staff/janitor" 16 16 "0,1,2,3"
for f in 0 1 2 3; do
  staff_base "$f" '#37a0c4' '#256b85'
  arm "$f" 11 9 '#256b85'                       # hand on broom
done
staff_legs 0 5 13 9 13 '#256b85'
staff_legs 1 6 13 8 13 '#256b85'
staff_legs 2 5 13 9 13 '#256b85'
staff_legs 3 6 13 8 13 '#256b85'
broom() { # <frame> <bx>  : stick down to bristles at bx, sweeping
  s line --frame "$1" --x0 11 --y0 8 --x1 $(( $2 + 1 )) --y1 12 --color '#b2925f'
  s fill-rect --frame "$1" --x "$2" --y 12 --width 4 --height 2 --color '#cdae7d'
}
broom 0 12; broom 1 13; broom 2 14; broom 3 13
s set-pixel --frame 2 --x 15 --y 13 --color '#aeb6c6'   # dust flick at full sweep

# --- mechanic: orange uniform, grey wrench raised/lowered ---------------------
newsheet "$A/staff/mechanic" 16 16 "0,1,2,3"
for f in 0 1 2 3; do
  staff_base "$f" '#f59042' '#b96a26'
  arm "$f" 11 9 '#b96a26'
done
staff_legs 0 5 13 9 13 '#b96a26'
staff_legs 1 6 13 8 13 '#b96a26'
staff_legs 2 5 13 9 13 '#b96a26'
staff_legs 3 6 13 8 13 '#b96a26'
wrench() { # <frame> <topy> : handle up from the hand to <topy>, jaw at top
  s line --frame "$1" --x0 12 --y0 10 --x1 12 --y1 $(( $2 + 1 )) --color '#8b93a7'
  s fill-rect --frame "$1" --x 11 --y "$2" --width 3 --height 2 --color '#8b93a7'
  s set-pixel --frame "$1" --x 12 --y "$2" --color '#b96a26'   # open jaw notch
}
wrench 0 9; wrench 1 7; wrench 2 5; wrench 3 7

# --- entertainer: round purple mascot, gold trim, waving arms -----------------
newsheet "$A/staff/entertainer" 16 16 "0,1,2,3"
for f in 0 1 2 3; do
  s fill-circle --frame "$f" --cx 8 --cy 5 --r 4 --color '#7a2ea8'    # head outline
  s fill-circle --frame "$f" --cx 8 --cy 5 --r 3 --color '#c46bff'
  s set-pixel --frame "$f" --x 6 --y 4 --color '#f2efe8'; s set-pixel --frame "$f" --x 6 --y 4 --color '#16202f'
  s set-pixel --frame "$f" --x 10 --y 4 --color '#16202f'
  s set-pixel --frame "$f" --x 8 --y 6 --color '#ffcb52'             # nose
  s fill-rect --frame "$f" --x 4 --y 8 --width 8 --height 1 --color '#ffcb52'  # collar trim
  s fill-circle --frame "$f" --cx 8 --cy 11 --r 4 --color '#7a2ea8'  # body outline
  s fill-circle --frame "$f" --cx 8 --cy 11 --r 3 --color '#c46bff'
  s set-pixel --frame "$f" --x 8 --y 10 --color '#ffcb52'; s set-pixel --frame "$f" --x 8 --y 12 --color '#ffcb52'
  foot "$f" 5 14 '#ffcb52'; foot "$f" 9 14 '#ffcb52'                 # gold shoes
done
# waving arms (opposite phase)
arm 0 2 7 '#c46bff'; arm 0 13 11 '#c46bff'
arm 1 2 9 '#c46bff'; arm 1 13 9 '#c46bff'
arm 2 2 11 '#c46bff'; arm 2 13 7 '#c46bff'
arm 3 2 9 '#c46bff'; arm 3 13 9 '#c46bff'

# ============================ §2c RIDES =======================================
# --- carousel (72×72, 6f): horses ride a ring rotating 60° over the loop ------
newsheet "$A/ride/carousel" 72 72 "0,1,2,3,4,5"
for f in 0 1 2 3 4 5; do
  s stroke-circle --frame "$f" --cx 36 --cy 36 --r 28 --color '#8b93a7'   # platform edge
  s stroke-circle --frame "$f" --cx 36 --cy 36 --r 27 --color '#6d7789'
  s fill-circle --frame "$f" --cx 36 --cy 36 --r 5 --color '#8b93a7'      # center hub
  s fill-circle --frame "$f" --cx 36 --cy 36 --r 3 --color '#aeb6c6'
  for k in 0 1 2 3 4 5; do
    ang=$(( 60 * k + 10 * f ))
    read hx hy < <(pos "$ang" 22 36 36)
    # horses bob up/down; alternate the two trim colors around the ring
    if [ $(( (k + f) % 2 )) -eq 0 ]; then hc='#ffcb52'; yb=-1; else hc='#e0603c'; yb=1; fi
    hy=$(( hy + yb ))
    s line --frame "$f" --x0 36 --y0 36 --x1 "$hx" --y1 "$hy" --color '#8b93a7'  # spoke/pole
    s fill-circle --frame "$f" --cx "$hx" --cy "$hy" --r 3 --color '#6d4a2f'     # horse outline
    s fill-circle --frame "$f" --cx "$hx" --cy "$hy" --r 2 --color "$hc"         # horse body
    s set-pixel --frame "$f" --x "$hx" --y $(( hy - 1 )) --color '#f2efe8'       # bridle glint
  done
done

# --- coaster (96×72, 4f): the car runs the station→hill→dip track --------------
newsheet "$A/ride/coaster" 96 72 "0,1,2,3"
# static track + posts, redrawn each frame (rail #8b93a7)
track() { # <frame>
  local f="$1"
  s fill-rect --frame "$f" --x 4 --y 50 --width 20 --height 3 --color '#8b93a7'   # station platform
  s line --frame "$f" --x0 4  --y0 49 --x1 24 --y1 49 --color '#aeb6c6'
  s line --frame "$f" --x0 24 --y0 49 --x1 44 --y1 18 --color '#8b93a7'           # climb
  s line --frame "$f" --x0 44 --y0 18 --x1 70 --y1 56 --color '#8b93a7'           # drop
  s line --frame "$f" --x0 70 --y0 56 --x1 92 --y1 40 --color '#8b93a7'           # rise-out
  for px in 12 30 48 66 84; do
    s line --frame "$f" --x0 "$px" --y0 62 --x1 "$px" --y1 68 --color '#6d7789'   # support posts
  done
}
car() { # <frame> <cx> <cy>
  s fill-rect --frame "$1" --x $(( $2 - 4 )) --y $(( $3 - 5 )) --width 9 --height 5 --color '#7a2ea8'
  s fill-rect --frame "$1" --x $(( $2 - 3 )) --y $(( $3 - 4 )) --width 7 --height 3 --color '#c46bff'
  s set-pixel --frame "$1" --x $(( $2 - 2 )) --y $(( $3 - 4 )) --color '#f2efe8'
  s fill-circle --frame "$1" --cx $(( $2 - 2 )) --cy "$3" --r 1 --color '#16202f'  # wheels
  s fill-circle --frame "$1" --cx $(( $2 + 2 )) --cy "$3" --r 1 --color '#16202f'
}
track 0; car 0 14 47
track 1; car 1 34 27
track 2; car 2 58 45
track 3; car 3 84 38

# --- drop tower (48×48, 6f): car rises the mast then drops ---------------------
newsheet "$A/ride/drop_tower" 48 48 "0,1,2,3,4,5"
for f in 0 1 2 3 4 5; do
  s fill-rect --frame "$f" --x 20 --y 2 --width 4 --height 44 --color '#8b93a7'   # mast
  s fill-rect --frame "$f" --x 21 --y 2 --width 1 --height 44 --color '#aeb6c6'
  for by in 8 16 24 32 40; do                                                     # cross-braces
    s line --frame "$f" --x0 20 --y0 "$by" --x1 24 --y1 $(( by + 4 )) --color '#6d7789'
    s line --frame "$f" --x0 24 --y0 "$by" --x1 20 --y1 $(( by + 4 )) --color '#6d7789'
  done
  s fill-rect --frame "$f" --x 16 --y 44 --width 16 --height 3 --color '#6d7789'   # base
done
dcar() { # <frame> <topy>
  s fill-rect --frame "$1" --x 14 --y "$2" --width 20 --height 6 --color '#a83b25'
  s fill-rect --frame "$1" --x 15 --y $(( $2 + 1 )) --width 18 --height 4 --color '#e0603c'
  s set-pixel --frame "$1" --x 18 --y $(( $2 + 2 )) --color '#ffcb52'   # seat lights
  s set-pixel --frame "$1" --x 24 --y $(( $2 + 2 )) --color '#ffcb52'
  s set-pixel --frame "$1" --x 30 --y $(( $2 + 2 )) --color '#ffcb52'
}
dcar 0 38; dcar 1 28; dcar 2 16; dcar 3 6; dcar 4 22; dcar 5 34   # rise 0-3, drop 3-5

echo "produced Midway animation sheets under $A/{guest,staff,ride}"
