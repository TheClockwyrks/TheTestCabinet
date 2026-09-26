#!/usr/bin/env bash
# Kessler — produce the SPRITE SET with the on-PATH `draw` / `draw-sheet` tools
# (specs/assets.md → "The sprites"). Everything is authored from drawing
# primitives on transparent (straight-alpha) canvases at the native size the
# contract pins — the 1000x1000 stage fits the viewport's short side, so at the
# reference fit one logical unit is one pixel and every sprite here is drawn at
# 1:1 with no scale at draw time.
#
# The look is COLD ORBITAL DEMOLITION (specs/assets.md "The look"): hard vacuum,
# glass, and sunlight on dead metal — steel greys and cold cyans — with the
# planet below the ONE WARM thing in view (amber bands, warm atmosphere limb).
#
# Produces, at the exact paths specs/assets.md lists (12 PNGs):
#   assets/sprites/planet.png        draw, 160x160 — the warm banded planet,
#                                    disc 140 px across, atmosphere in the margin.
#   assets/sprites/pods/{widen,narrow,multiball,shield,pierce}.png
#                                    draw, 24x24 each — five salvage pods, pairwise
#                                    tellable apart in flight by hue + glyph + shape.
#   assets/sprites/ball/{0..5}.png   draw-sheet, 6 frames 24x24 — ONE tumbling
#                                    debris chunk (the ball is 16 px across),
#                                    rotated 60 deg per frame via a layer keyframe
#                                    so 0→5 wraps into a seamless full turn.
#
# Usage:  bash scripts/gen-sprites.sh   (draw + draw-sheet must be on PATH, or
#         built under $CARGO_TARGET_DIR).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release/debug dirs.
TARGET="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"
for tool in draw draw-sheet; do
  command -v "$tool" >/dev/null 2>&1 && continue
  for dir in "$TARGET/release" "$TARGET/debug"; do
    [ -x "$dir/$tool" ] && { export PATH="$dir:$PATH"; break; }
  done
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found on PATH or under $TARGET" >&2; exit 1; }
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPR="$ROOT/assets/sprites"
mkdir -p "$SPR/pods" "$SPR/ball"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The tools write their own scratch into the working directory; every output
# path below is absolute, so work from the scratch dir rather than the repo.
cd "$TMP"
CFG="$TMP/cfg.json"

# ---- Kessler palette (cold steel + cyan; the planet alone is warm) ----------
HULL='#2b3340'      # dark hull outline (reads on the near-black field)
STEEL='#5a6472'     # dead-metal mid grey
STEEL_LT='#9aa7b5'  # sunlit steel
STEEL_HI='#e8f0f8'  # bare-metal glint
CYAN='#6ee6ff'      # cold energy cyan (glass / glow)
POD_WIDEN='#5fd9ff'   # widen  — ice cyan
POD_NARROW='#ff6a4e'  # narrow — warning ember (the bad catch)
POD_MULTI='#ffd25f'   # multiball — salvage gold
POD_SHIELD='#7df5a6'  # shield — aegis green
POD_PIERCE='#c08dff'  # pierce — lance violet

# ---- integer sqrt (scanline half-widths for discs) --------------------------
isqrt() { local n=$1 r=0; while (( (r+1)*(r+1) <= n )); do r=$((r+1)); done; echo "$r"; }

# ---- single-sprite helpers --------------------------------------------------
newsprite() { # newsprite <w> <h> <out.png> — transparent canvas
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# =============================================================================
# PLANET — 160x160, disc 140 px across centered at (80,80), the margin kept for
# the atmosphere (specs/assets.md "The sprites"). A warm BANDED giant — latitude
# bands in rust and amber with a bright equator, a pale storm oval, limb
# darkening toward the edge, and a translucent warm atmosphere ring OUTSIDE the
# disc so the limb glows against the dark field. Scanline-drawn: one horizontal
# line per row, clipped to the disc by isqrt, so every band ends exactly on the
# circular limb.
# =============================================================================
newsprite 160 160 "$SPR/planet.png"

# band <dy> — the band color at signed distance dy from the equator (y - 80).
band() {
  local dy=$1
  if   [ "$dy" -lt -58 ]; then echo '#e2955f'   # north polar haze
  elif [ "$dy" -lt -46 ]; then echo '#c9662a'
  elif [ "$dy" -lt -38 ]; then echo '#e8a35f'
  elif [ "$dy" -lt -26 ]; then echo '#b05526'
  elif [ "$dy" -lt -16 ]; then echo '#f0b070'
  elif [ "$dy" -lt  -6 ]; then echo '#c9662a'
  elif [ "$dy" -lt   4 ]; then echo '#ffc688'   # bright equator band
  elif [ "$dy" -lt  12 ]; then echo '#b05526'
  elif [ "$dy" -lt  24 ]; then echo '#e8a35f'
  elif [ "$dy" -lt  36 ]; then echo '#c9662a'
  elif [ "$dy" -lt  48 ]; then echo '#d98a4f'
  elif [ "$dy" -lt  58 ]; then echo '#a34d22'
  else                         echo '#e2955f'   # south polar haze
  fi
}

# Disc body, row by row (radius 70 → rows 10..150).
for y in $(seq 10 150); do
  dy=$((y - 80))
  [ "$dy" -lt 0 ] && ady=$((-dy)) || ady=$dy
  half=$(isqrt $((4900 - dy*dy)))
  [ "$half" -lt 1 ] && continue
  d line --x0 $((80 - half)) --y0 "$y" --x1 $((80 + half)) --y1 "$y" --color "$(band $dy)"
done

# Band-edge turbulence: broken, varied streak segments riding the band seams so
# the bands read as weather, not ruled stripes. The draw tools REPLACE pixels
# (no over-compositing), so each streak is an OPAQUE pre-blended shade of the
# band it rides. streak <y> <from%> <to%> <color>
streak() {
  local y=$1 dy half x0 x1
  dy=$((y - 80)); half=$(isqrt $((4900 - dy*dy)))
  x0=$((80 - half + (2 * half * $2) / 100))
  x1=$((80 - half + (2 * half * $3) / 100))
  d line --x0 "$x0" --y0 "$y" --x1 "$x1" --y1 "$y" --color "$4"
}
streak  54  8 55 '#cc8b4e'; streak  55 20 48 '#dd9d5e'   # darker on #f0b070
streak  64 40 92 '#a34f1f'; streak  65 55 85 '#b5591f'   # darker on #c9662a
streak  86  5 40 '#8d3f18'; streak  87 12 30 '#9c4a1e'   # darker on #b05526
streak 104 50 95 '#a34f1f'; streak 105 60 88 '#b5591f'   # darker on #c9662a
streak 128 15 60 '#7f3a17'                               # darker on #a34d22
streak  44 30 75 '#c97a42'; streak  45 38 66 '#bd6c34'   # paler on #b05526
streak  74 10 45 '#ffe0b3'; streak  75 16 38 '#ffd39d'   # paler on #ffc688
streak  96 55 90 '#ffc78a'; streak  97 62 84 '#f5b573'   # paler on #e8a35f
streak 116 25 62 '#f2ad72'                               # paler on #d98a4f
# pale cloud flecks (opaque, per-band paler shades)
d fill-circle --cx 110 --cy 60  --r 3 --color '#ffd9a0'
d fill-circle --cx 116 --cy 61  --r 2 --color '#f8c98a'
d fill-circle --cx  62 --cy 132 --r 2 --color '#c97747'
d fill-circle --cx  96 --cy 122 --r 2 --color '#f0b070'

# The storm — a pale oval eye in the southern mid-latitudes.
d fill-circle --cx 52 --cy 102 --r 8 --color '#9a5228'
d fill-circle --cx 52 --cy 101 --r 6 --color '#ffd9a0'
d fill-circle --cx 58 --cy 101 --r 5 --color '#ffd9a0'
d fill-circle --cx 55 --cy 100 --r 3 --color '#fff0d0'

# Limb darkening — translucent dark rings hugging the inside of the disc edge.
d stroke-circle --cx 80 --cy 80 --r 70 --color '#3a160a99'
d stroke-circle --cx 80 --cy 80 --r 69 --color '#3a160a66'
d stroke-circle --cx 80 --cy 80 --r 68 --color '#3a160a4d'
d stroke-circle --cx 80 --cy 80 --r 67 --color '#3a160a33'
d stroke-circle --cx 80 --cy 80 --r 66 --color '#3a160a1f'
d stroke-circle --cx 80 --cy 80 --r 65 --color '#3a160a12'

# Atmosphere — the warm glow OUTSIDE the disc, fading over the 10 px margin.
d stroke-circle --cx 80 --cy 80 --r 71 --color '#ffb46bb3'
d stroke-circle --cx 80 --cy 80 --r 72 --color '#ffb46b8c'
d stroke-circle --cx 80 --cy 80 --r 73 --color '#ffab6066'
d stroke-circle --cx 80 --cy 80 --r 74 --color '#ff9d4a4d'
d stroke-circle --cx 80 --cy 80 --r 75 --color '#ff9d4a33'
d stroke-circle --cx 80 --cy 80 --r 76 --color '#ff9d4a21'
d stroke-circle --cx 80 --cy 80 --r 77 --color '#ff9d4a14'
d stroke-circle --cx 80 --cy 80 --r 78 --color '#ff9d4a0a'

echo "produced planet.png"

# =============================================================================
# SALVAGE PODS — 24x24 each, centered, transparent. One shared design language
# (a dark hull with a bright accent shell and a bold glyph) so they read as one
# family, but each kind keeps its OWN hue, silhouette, and glyph so the five are
# pairwise tellable apart at 24 px in flight (specs/assets.md "The art bar").
# =============================================================================

# --- WIDEN — ice cyan, WIDE squat capsule, outward-pointing arrows -----------
newsprite 24 24 "$SPR/pods/widen.png"
d fill-rect --x 2 --y 7 --width 20 --height 10 --color "$HULL"
d fill-rect --x 3 --y 6 --width 18 --height 12 --color "$HULL"
d fill-rect --x 4 --y 8 --width 16 --height 8 --color "$POD_WIDEN"
d fill-rect --x 3 --y 9 --width 18 --height 6 --color "$POD_WIDEN"
d fill-rect --x 4 --y 8 --width 16 --height 2 --color '#b7f0ff'      # top shine
# glyph: two outward arrows < > in dark, on the accent shell
d line --x0 8 --y0 9  --x1 5  --y1 12 --color "$HULL"
d line --x0 5 --y0 12 --x1 8  --y1 15 --color "$HULL"
d line --x0 8 --y0 10 --x1 6  --y1 12 --color "$HULL"
d line --x0 6 --y0 12 --x1 8  --y1 14 --color "$HULL"
d line --x0 15 --y0 9  --x1 18 --y1 12 --color "$HULL"
d line --x0 18 --y0 12 --x1 15 --y1 15 --color "$HULL"
d line --x0 15 --y0 10 --x1 17 --y1 12 --color "$HULL"
d line --x0 17 --y0 12 --x1 15 --y1 14 --color "$HULL"
d fill-rect --x 10 --y 11 --width 4 --height 2 --color "$HULL"        # center bar
echo "produced pods/widen.png"

# --- NARROW — warning ember, TALL thin capsule, inward-pointing arrows -------
newsprite 24 24 "$SPR/pods/narrow.png"
d fill-rect --x 8 --y 2 --width 8 --height 20 --color "$HULL"
d fill-rect --x 7 --y 3 --width 10 --height 18 --color "$HULL"
d fill-rect --x 9 --y 4 --width 6 --height 16 --color "$POD_NARROW"
d fill-rect --x 8 --y 5 --width 8 --height 14 --color "$POD_NARROW"
d fill-rect --x 9 --y 4 --width 6 --height 2 --color '#ffb3a0'        # top shine
# glyph: two chunky arrows pointing INWARD at the waist (v above, ^ below)
d line --x0 9  --y0 6  --x1 12 --y1 9  --color "$HULL"
d line --x0 15 --y0 6  --x1 12 --y1 9  --color "$HULL"
d line --x0 9  --y0 7  --x1 12 --y1 10 --color "$HULL"
d line --x0 15 --y0 7  --x1 12 --y1 10 --color "$HULL"
d line --x0 9  --y0 18 --x1 12 --y1 15 --color "$HULL"
d line --x0 15 --y0 18 --x1 12 --y1 15 --color "$HULL"
d line --x0 9  --y0 17 --x1 12 --y1 14 --color "$HULL"
d line --x0 15 --y0 17 --x1 12 --y1 14 --color "$HULL"
d fill-rect --x 8 --y 11 --width 8 --height 2 --color "$HULL"         # the waist bar
echo "produced pods/narrow.png"

# --- MULTIBALL — salvage gold, ROUND pod, three-ball glyph -------------------
newsprite 24 24 "$SPR/pods/multiball.png"
d fill-circle --cx 12 --cy 12 --r 10 --color "$HULL"
d fill-circle --cx 12 --cy 12 --r 8  --color "$POD_MULTI"
d fill-circle --cx 10 --cy 9  --r 3  --color '#ffe9a8'                # shine
# glyph: three dark balls in a triangle
d fill-circle --cx 12 --cy 9  --r 2 --color "$HULL"
d fill-circle --cx 8  --cy 15 --r 2 --color "$HULL"
d fill-circle --cx 16 --cy 15 --r 2 --color "$HULL"
echo "produced pods/multiball.png"

# --- SHIELD — aegis green, HEX pod, ring glyph -------------------------------
newsprite 24 24 "$SPR/pods/shield.png"
# hexagon: a center band plus tapering top/bottom
d fill-rect --x 3 --y 8 --width 18 --height 8 --color "$HULL"
d fill-rect --x 6 --y 4 --width 12 --height 16 --color "$HULL"
d fill-rect --x 4 --y 6 --width 16 --height 12 --color "$HULL"
d fill-rect --x 4 --y 9 --width 16 --height 6 --color "$POD_SHIELD"
d fill-rect --x 7 --y 5 --width 10 --height 14 --color "$POD_SHIELD"
d fill-rect --x 5 --y 7 --width 14 --height 10 --color "$POD_SHIELD"
d fill-rect --x 7 --y 5 --width 10 --height 2 --color '#c8ffdd'       # top shine
# glyph: the shield ring — one bold dark annulus
d fill-circle --cx 12 --cy 12 --r 6 --color "$HULL"
d fill-circle --cx 12 --cy 12 --r 4 --color "$POD_SHIELD"
d fill-circle --cx 11 --cy 11 --r 2 --color '#c8ffdd'
echo "produced pods/shield.png"

# --- PIERCE — lance violet, DIAMOND pod, down-chevron glyph ------------------
newsprite 24 24 "$SPR/pods/pierce.png"
# diamond silhouette drawn as stacked centered rows (widest at the middle)
pierce_row() { # <y> <half>
  d line --x0 $((12 - $2)) --y0 "$1" --x1 $((11 + $2)) --y1 "$1" --color "$HULL"
}
for i in $(seq 0 9);  do pierce_row $((2 + i)) $((1 + i)); done
for i in $(seq 0 9);  do pierce_row $((12 + i)) $((10 - i)); done
# accent fill inset 2 px
pierce_fill() { d line --x0 $((12 - $2)) --y0 "$1" --x1 $((11 + $2)) --y1 "$1" --color "$POD_PIERCE"; }
for i in $(seq 2 9);  do pierce_fill $((2 + i)) $((i - 1)); done
for i in $(seq 0 7);  do pierce_fill $((12 + i)) $((8 - i)); done
d fill-rect --x 10 --y 5 --width 4 --height 2 --color '#e2ccff'       # top shine
# glyph: a bold dark chevron driving DOWN (the lance)
d line --x0 8  --y0 10 --x1 12 --y1 14 --color "$HULL"
d line --x0 16 --y0 10 --x1 12 --y1 14 --color "$HULL"
d line --x0 8  --y0 11 --x1 12 --y1 15 --color "$HULL"
d line --x0 16 --y0 11 --x1 12 --y1 15 --color "$HULL"
d line --x0 12 --y0 6 --x1 12 --y1 12 --color "$HULL"
echo "produced pods/pierce.png"

# =============================================================================
# BALL — draw-sheet, 6 frames of 24x24. ONE debris chunk (the ball is 16 px
# across) drawn ONCE on a 20x20 layer centered on the canvas, then spun with a
# linear rotation keyframe: frame 0 = 0 deg, frame 5 = 300 deg, so each frame
# advances 60 deg and frame 5 → frame 0 wraps the full turn seamlessly
# (specs/assets.md "The ball sheet": frames 0..5 in order, one per 5 ticks).
# The chunk is deliberately ASYMMETRIC — a sunlit face, a dark crater, and an
# antenna stub — so the 60-degree steps read as tumbling, not flicker.
# =============================================================================
printf '{ "width": 24, "height": 24, "background": "transparent", "frames": [0,1,2,3,4,5], "actions": "%s", "preview": "%s" }\n' \
  "$TMP/ball_{frame}.json" "$SPR/ball/{frame}.png" > "$CFG"
draw-sheet init --config "$CFG" >/dev/null
sc() { draw-sheet "$@" --config "$CFG" >/dev/null; }

sc register-layer --name chunk --x 2 --y 2 --width 20 --height 20
# silhouette: an irregular union of discs and a jutting shoulder, laid down in
# SUNLIT steel so the outermost edge is a rim light on the dark field
sc fill-circle --layer chunk --cx 9  --cy 10 --r 6 --color "$STEEL_LT"
sc fill-circle --layer chunk --cx 15 --cy 6  --r 4 --color "$STEEL_LT"
sc fill-circle --layer chunk --cx 5  --cy 14 --r 4 --color "$STEEL_LT"
sc fill-rect   --layer chunk --x 12 --y 12 --width 6 --height 5 --color "$STEEL_LT"
sc fill-rect   --layer chunk --x 2  --y 6  --width 4 --height 3 --color "$STEEL_LT"
# body metal, inset one px, keeping the light rim all round
sc fill-circle --layer chunk --cx 9  --cy 10 --r 5 --color "$STEEL"
sc fill-circle --layer chunk --cx 15 --cy 6  --r 3 --color "$STEEL"
sc fill-circle --layer chunk --cx 5  --cy 14 --r 3 --color "$STEEL"
sc fill-rect   --layer chunk --x 13 --y 13 --width 4 --height 3 --color "$STEEL"
sc fill-rect   --layer chunk --x 3  --y 7  --width 3 --height 1 --color "$STEEL"
# sunlit face (upper-left) + bare-metal glint
sc fill-circle --layer chunk --cx 8 --cy 8 --r 4 --color "$STEEL_LT"
sc fill-circle --layer chunk --cx 7 --cy 7 --r 2 --color '#c7d3e0'
sc set-pixel   --layer chunk --x 7 --y 7 --color "$STEEL_HI"
sc set-pixel   --layer chunk --x 6 --y 7 --color "$STEEL_HI"
# dark crater with a lit rim, off-center (a strong rotation tell)
sc fill-circle --layer chunk --cx 14 --cy 14 --r 2 --color '#39414c'
sc set-pixel   --layer chunk --x 14 --y 14 --color '#272e38'
sc set-pixel   --layer chunk --x 13 --y 13 --color "$STEEL_HI"
# a cold glass shard catching the light (ties into the cyan palette)
sc fill-rect   --layer chunk --x 10 --y 4 --width 3 --height 2 --color "$CYAN"
sc set-pixel   --layer chunk --x 10 --y 4 --color '#d6f7ff'
# antenna stub jutting out (the strongest rotation tell)
sc fill-rect   --layer chunk --x 17 --y 9 --width 3 --height 2 --color "$STEEL_LT"
sc set-pixel   --layer chunk --x 19 --y 9 --color "$STEEL_HI"

# the spin: 60 degrees per frame, linear, wrapping 300 → 360(=0)
sc animate-layer --layer chunk --property rotation --frame 0 --value 0   --interp linear
sc animate-layer --layer chunk --property rotation --frame 5 --value 300 --interp linear
# every draw-sheet op re-renders the frame previews; no explicit render step exists
echo "produced ball/{0..5}.png"

echo "produced kessler sprites under $SPR:"
find "$SPR" -name '*.png' | sort
