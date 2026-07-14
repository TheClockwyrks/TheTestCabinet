#!/usr/bin/env bash
# Coil — produce the snake SPRITE SET with the on-PATH `draw` / `draw-sheet`
# pixel-art tools (specs/assets.md → "The snake sprite set"). Everything here is
# authored from drawing primitives (fill-circle / fill-rect / line / set-pixel)
# on 32x32 transparent (straight-alpha) canvases — one cell each — in the exact
# Coil palette from specs/overview.md. These are pixel art: draw at native size
# and sample nearest-neighbor in the game so they stay crisp.
#
# Each sprite is authored in ONE canonical orientation; the game rotates/flips it
# in code to cover the four travel directions and the four turns.
#
# Produces, at the exact paths specs/assets.md lists (7 PNGs):
#   assets/snake/head/{0,1,2,3}.png  draw-sheet, head FACING EAST (mouth on the
#                                    RIGHT edge); frame 0 = resting (mouth closed),
#                                    frames 1-3 = a bite (open, chomp wide, close).
#   assets/snake/body.png            draw, a straight HORIZONTAL tube (west<->east).
#   assets/snake/corner.png          draw, a 90-degree bend open EAST and SOUTH.
#   assets/snake/tail.png            draw, connects on WEST, tapers to a point EAST.
#
# Usage:  bash scripts/gen-sprites.sh   (draw + draw-sheet must be on PATH, or
#         built under $CARGO_TARGET_DIR/release — the devcontainer cargo volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir.
if ! command -v draw >/dev/null 2>&1 || ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  { [ -x "$REL/draw" ] && [ -x "$REL/draw-sheet" ]; } \
    || { echo "draw/draw-sheet not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAKE="$ROOT/assets/snake"
HEAD="$SNAKE/head"
mkdir -p "$HEAD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# ---- Coil palette (specs/overview.md), plus pixel-art shades for volume -------
HEAD_C='#5ef38c'   # snake head (bright)
HEAD_OUT='#0f7a45' # head outline (dark green)
HEAD_HI='#b6ffd2'  # head highlight (baked glow)
BODY_C='#2fd07a'   # snake body (clearly dimmer than the head)
BODY_OUT='#12703f' # body outline (dark green)
BODY_HI='#5fe89e'  # body tube shine (glossy centre core)
NECK2='#3edc80'    # head→body neck blend, nearer the body
NECK3='#4ee786'    # head→body neck blend, nearer the head
DARK='#0b0e14'     # mouth interior / eye pupil (stage bg)
WHITE='#e6edf3'    # eye glint (primary text)
TONGUE='#ff5c8a'   # a flick of tongue on the wide chomp (pellet color)

# ---- integer sqrt (for clipping the mouth to the round head silhouette) ------
isqrt() { local n=$1 r=0; while (( (r+1)*(r+1) <= n )); do r=$((r+1)); done; echo "$r"; }

# =============================================================================
# HEAD — draw-sheet, 4 frames, FACING EAST (mouth on the +col / right edge).
# The head is NOT a free-floating disc: its BACK (the west edge) is the SAME tube
# cross-section as body.png — the exact y6..25 outline / y8..23 fill band, full
# width to x=0 — so it butts FLUSH against the neck segment behind it with no gap.
# From that neck-width back it swells to a fatter, rounded head toward the east,
# where a forward eye sits and a mouth opens and chomps shut across the bite.
# The game rotates this sprite to the snake's facing; because the connecting band
# is centred and matches the body exactly, the seam stays continuous in every dir.
# =============================================================================
mkdir -p "$HEAD"
printf '{ "width": 32, "height": 32, "background": "transparent", "frames": %s, "actions": "%s", "preview": "%s" }\n' \
  "[0,1,2,3]" "$TMP/f_{frame}.json" "$HEAD/{frame}.png" > "$CFG"
draw-sheet init --config "$CFG" >/dev/null
sc() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ho <x> — outline half-height of the head silhouette at column x (facing east).
# Flush body-width at the back (10 == body.png's y6..25 band, so the seam matches),
# swelling to a fatter head (13) through the middle, then rounding to a blunt nose
# at the east edge. A vertical span (16-H)..(15+H) is an even band centred like body.
ho() {
  local x=$1
  if   [ "$x" -le 2  ]; then echo 10                       # neck-width back — matches body
  elif [ "$x" -le 8  ]; then echo $(( 10 + (x-2+1)/2 ))     # swell 10→13 over x3..8
  elif [ "$x" -le 24 ]; then echo 13                        # fat head
  else                                                      # blunt rounded nose (arc @ (24,16) r13)
    local dx=$((x-24)); echo "$(isqrt $((169 - dx*dx)))"
  fi
}

# head_frame <frame> <gape>  — gape 0 = closed (resting); larger = wider bite.
head_frame() {
  local f=$1 gape=$2 x Ho Hf des h tongue
  # 1) OUTLINE silhouette: one dark vertical span per column.
  for x in $(seq 0 31); do
    Ho=$(ho "$x")
    sc line --frame "$f" --x0 "$x" --y0 $((16-Ho)) --x1 "$x" --y1 $((15+Ho)) --color "$HEAD_OUT"
  done
  # 2) BRIGHT fill inset 1px inside the outline (the west edge stays open like the
  #    body's cross-section so it reads as continuous tube, not a capped ball).
  for x in $(seq 0 31); do
    Ho=$(ho "$x"); Hf=$((Ho-1)); [ "$Hf" -lt 0 ] && continue
    sc line --frame "$f" --x0 "$x" --y0 $((16-Hf)) --x1 "$x" --y1 $((15+Hf)) --color "$HEAD_C"
  done
  # 3) NECK BLEND — grade the back of the head from the body colour up to the head
  #    colour so it joins the neck without a hard bright step (the front keeps the bright
  #    head colour, so the leading cell is still clearly distinguishable).
  local gx gc
  for gx in $(seq 0 11); do
    Ho=$(ho "$gx"); Hf=$((Ho-1)); [ "$Hf" -lt 0 ] && continue
    if   [ "$gx" -le 3 ]; then gc="$BODY_C"
    elif [ "$gx" -le 7 ]; then gc="$NECK2"
    else                       gc="$NECK3"; fi
    sc line --frame "$f" --x0 "$gx" --y0 $((16-Hf)) --x1 "$gx" --y1 $((15+Hf)) --color "$gc"
  done
  # glossy centre stripe (symmetric about the tube axis, rows 15-16) over the neck and into
  # the head — continuous with the body's core shine, and reflection-safe.
  for gx in $(seq 0 18); do
    sc fill-rect --frame "$f" --x "$gx" --y 15 --width 1 --height 2 --color "$BODY_HI"
  done
  # 4) forward-looking eye on the upper-front of the head
  sc fill-circle --frame "$f" --cx 22 --cy 10 --r 3 --color "$HEAD_OUT"
  sc fill-circle --frame "$f" --cx 22 --cy 10 --r 2 --color "$WHITE"
  sc fill-rect   --frame "$f" --x 22 --y 9  --width 2 --height 2 --color "$DARK"
  sc set-pixel   --frame "$f" --x 23 --y 11 --color "$WHITE"
  # 5) mouth on the east/front
  if [ "$gape" -eq 0 ]; then
    # resting: a closed slit tucked into the nose
    sc line --frame "$f" --x0 24 --y0 16 --x1 31 --y1 16 --color "$HEAD_OUT"
    sc line --frame "$f" --x0 28 --y0 16 --x1 31 --y1 16 --color "$DARK"
  else
    # open: a dark wedge with its apex inside the head at x=21, opening toward the
    # nose; clipped to the head silhouette so it never spills past the outline.
    tongue=0; [ "$gape" -ge 5 ] && tongue=1
    for x in $(seq 21 31); do
      Ho=$(ho "$x"); Ho=$((Ho-1))
      des=$(( ((x-21)*gape + 4) / 9 ))       # desired half-opening (linear toward the nose)
      h=$des; [ "$Ho" -lt "$h" ] && h=$Ho
      [ "$h" -lt 0 ] && continue
      sc line --frame "$f" --x0 "$x" --y0 $((16-h)) --x1 "$x" --y1 $((15+h)) --color "$DARK"
    done
    # a flick of tongue at the back of a wide-open mouth
    if [ "$tongue" -eq 1 ]; then
      sc fill-rect --frame "$f" --x 21 --y 16 --width 3 --height 1 --color "$TONGUE"
    fi
  fi
}

head_frame 0 0    # resting — mouth closed
head_frame 1 3    # bite opens
head_frame 2 6    # chomp wide
head_frame 3 2    # closing

# =============================================================================
# Single-sprite helper (draw) for the body / corner / tail.
# =============================================================================
newsprite() { # newsprite <out.png>  — 32x32 transparent canvas
  printf '{ "width": 32, "height": 32, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$TMP/log.json" "$1" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# =============================================================================
# BODY — a straight HORIZONTAL tube running west<->east (connects W and E edges).
# Dimmer than the head. Shaded SYMMETRICALLY about the tube axis (a glossy centre
# core, no directional top/bottom shine) so a segment looks the same whichever way
# it is rotated and joins its neighbours with no bright/dark seam.
# =============================================================================
newsprite "$SNAKE/body.png"
d fill-rect --x 0 --y 6  --width 32 --height 20 --color "$BODY_OUT"   # outline band
d fill-rect --x 0 --y 8  --width 32 --height 16 --color "$BODY_C"     # tube fill
d fill-rect --x 0 --y 15 --width 32 --height 2  --color "$BODY_HI"    # glossy centre core
# faint scale chevrons pointing WEST (tail-ward), centred on the tube axis (y15.5) so they
# don't shift by a pixel when a neighbouring corner is reflected.
for x in 5 13 21 29; do
  d line --x0 "$x" --y0 13 --x1 $((x-2)) --y1 15 --color "$BODY_OUT"
  d line --x0 "$x" --y0 18 --x1 $((x-2)) --y1 16 --color "$BODY_OUT"
done

# =============================================================================
# CORNER — a 90-degree bend whose two open ends are EAST and SOUTH (an L that
# curves the tube between the right edge and the bottom edge). Built as the union
# of a horizontal arm to the east edge and a vertical arm to the south edge; the
# outer corner sits at the NW. Used at every bend so a turn reads as a coil.
# =============================================================================
newsprite "$SNAKE/corner.png"
# outlines first (both arms), then fills overwrite the interior
d fill-rect --x 6 --y 6 --width 26 --height 20 --color "$BODY_OUT"    # east arm outline
d fill-rect --x 6 --y 6 --width 20 --height 26 --color "$BODY_OUT"    # south arm outline
d fill-rect --x 8 --y 8 --width 24 --height 16 --color "$BODY_C"      # east arm fill
d fill-rect --x 8 --y 8 --width 16 --height 24 --color "$BODY_C"      # south arm fill
# glossy core stripe following the L centreline (symmetric about the corner's NW–SE
# diagonal, so a reflected bend renders identically), continuous with the body core shine.
d fill-rect --x 16 --y 15 --width 16 --height 2 --color "$BODY_HI"    # head-arm core → east edge
d fill-rect --x 15 --y 16 --width 2  --height 16 --color "$BODY_HI"   # tail-arm core → south edge
d fill-rect --x 15 --y 15 --width 2  --height 2  --color "$BODY_HI"   # elbow join
# soften the outer NW corner and firm up the inner corner (both diagonal-symmetric)
d set-pixel --x 6 --y 6 --color "$BODY_OUT"
d fill-circle --cx 24 --cy 24 --r 2 --color "$BODY_OUT"
# faint scale chevrons that flow tail-ward continuously around the bend — the head-ward
# (east) arm points WEST toward the elbow and the tail-ward (south) arm points SOUTH away
# from it, so along the snake the scales read >>> >>> >>>, never converging (>>> <<<). Each
# chevron is centred on its arm's tube axis (y15.5 / x15.5) so a reflected bend does not
# shift it by a pixel.
for p in 22 28; do
  # head-ward (east) arm — west-pointing (toward the elbow), centred on y15.5
  d line --x0 "$p" --y0 13 --x1 $((p-2)) --y1 15 --color "$BODY_OUT"
  d line --x0 "$p" --y0 18 --x1 $((p-2)) --y1 16 --color "$BODY_OUT"
  # tail-ward (south) arm — south-pointing (away from the elbow), centred on x15.5
  d line --x0 13 --y0 "$p" --x1 15 --y1 $((p+2)) --color "$BODY_OUT"
  d line --x0 18 --y0 "$p" --x1 16 --y1 $((p+2)) --color "$BODY_OUT"
done

# =============================================================================
# TAIL — the final segment: connects on its WEST edge (full thickness) and
# TAPERS to a point at the EAST tip (tip points +col / east).
# =============================================================================
newsprite "$SNAKE/tail.png"
# outline pass: a solid tapering wedge from the west edge to a point at the east, the band
# centred on the tube axis (y15.5) so it aligns with the body segment it follows.
for x in $(seq 0 28); do
  H=$(( ((28-x)*10 + 14) / 28 ))          # half-height 10 at west → 0 at the tip
  d line --x0 "$x" --y0 $((16-H)) --x1 "$x" --y1 $((15+H)) --color "$BODY_OUT"
done
# fill pass: inset by the 1px outline
for x in $(seq 0 26); do
  H=$(( ((28-x)*10 + 14) / 28 ))
  h=$((H-1)); [ "$h" -lt 1 ] && continue
  d line --x0 "$x" --y0 $((16-h)) --x1 "$x" --y1 $((15+h)) --color "$BODY_C"
done
# glossy core stripe along the taper (symmetric about the axis), continuous with the body.
for x in $(seq 0 24); do
  H=$(( ((28-x)*10 + 14) / 28 ))
  [ "$H" -ge 2 ] && d fill-rect --x "$x" --y 15 --width 1 --height 2 --color "$BODY_HI"
done

echo "produced 7 snake sprites: head/{0,1,2,3}.png, body.png, corner.png, tail.png"
