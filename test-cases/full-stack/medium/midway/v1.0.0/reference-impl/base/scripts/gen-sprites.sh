#!/usr/bin/env bash
# Midway — produce every STATIC pixel-art sprite (§1 of ASSETS.md) with the on-PATH
# `draw` tool: ground/path tiles, rides, stalls, scenery, and HUD icons. Mirrors the
# valence reference generator (scripts/gen-assets.sh): resolve the tool from PATH else
# the cargo target release dir, then record the drawing operations that render each
# finished PNG straight into assets/. Re-run it to regenerate the committed files.
#
# Category: §1 only (`draw`, one PNG per sprite). The animated sheets (§2, draw-sheet),
# particle systems (§3, particle-2d) and audio (§4) are produced by their own scripts.
#
# Usage:  bash scripts/gen-sprites.sh
set -euo pipefail

# --- resolve the tool: prefer PATH, else the cargo target release dir ----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="$ROOT/assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

mkdir -p "$A/tiles" "$A/rides" "$A/stalls" "$A/scenery" "$A/icons"

# --- palette (specs/overview.md + ASSETS.md) -----------------------------------
GRASS='#4f8f4a'; GRASS_D='#2f7d3a'; GRASS_L='#63a558'
PATHC='#cdae7d'; PATH_E='#b2925f'; PATH_HL='#dcc39a'
WATER='#37a0c4'; WATER_HI='#45c6f0'; WATER_D='#2c86a5'
STRUCT='#8b93a7'; STRUCT_D='#6d7789'; STRUCT_L='#a7aec0'
ROOF='#e0603c'; ROOF_D='#b64a2c'; TRIM='#ffcb52'
FOLIAGE='#2f7d3a'; FOLIAGE_L='#4f8f4a'; TRUNK='#6d4a2f'
CASH='#5fce6e'; STAR='#ffcb52'; HAPPY='#ffd24a'; THRILL='#c46bff'
HUNGER='#f59042'; THIRST='#45c6f0'; GUEST='#ff8fb0'; GUEST_D='#c46b86'
ALERT='#ff5a52'; TEXT='#f2efe8'; TEXT2='#aeb6c6'; TEXT3='#6d7789'
WOOD='#b2925f'; STONE='#8b93a7'; BODY='#cdae7d'; BODY_D='#b2925f'; WHITE='#ffffff'

# --- helpers -------------------------------------------------------------------
# newsprite <w> <h> <out.png> : start a fresh transparent canvas that renders to out.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# ==============================================================================
# 1a. GROUND & PATH TILES — assets/tiles/ (24x24)
# ==============================================================================

# grass.png — buildable ground, seamless, a couple of darker tufts + light specks.
newsprite 24 24 "$A/tiles/grass.png"
d fill-rect --x 0 --y 0 --width 24 --height 24 --color "$GRASS"
for xy in 4,6 5,5 5,7 9,14 10,13 10,15 16,8 17,7 17,9 14,18 15,19 20,4; do
  IFS=, read -r gx gy <<<"$xy"
  d set-pixel --x "$gx" --y "$gy" --color "$GRASS_D"
  d set-pixel --x "$((gx-1))" --y "$((gy+1))" --color "$GRASS_D"
  d set-pixel --x "$((gx+1))" --y "$((gy+1))" --color "$GRASS_D"
done
for xy in 7,10 13,4 19,15 3,17 21,20 11,20; do
  IFS=, read -r gx gy <<<"$xy"; d set-pixel --x "$gx" --y "$gy" --color "$GRASS_L"
done

# water.png — pond tile with a lighter ripple; darker deep base.
newsprite 24 24 "$A/tiles/water.png"
d fill-rect --x 0 --y 0 --width 24 --height 24 --color "$WATER"
for y in 2 8 14 20; do d fill-rect --x 1 --y "$y" --width 22 --height 1 --color "$WATER_D"; done
d line --x0 3 --y0 5 --x1 9 --y1 5 --color "$WATER_HI"
d line --x0 13 --y0 11 --x1 20 --y1 11 --color "$WATER_HI"
d line --x0 5 --y0 17 --x1 11 --y1 17 --color "$WATER_HI"
d line --x0 15 --y0 4 --x1 19 --y1 4 --color "$WATER_HI"
d set-pixel --x 8 --y 12 --color "$WHITE"; d set-pixel --x 17 --y 18 --color "$WHITE"

# fence.png — sealed border: post-and-rail (transparent, drawn over grass).
newsprite 24 24 "$A/tiles/fence.png"
d fill-rect --x 0 --y 9 --width 24 --height 3 --color "$STRUCT"
d fill-rect --x 0 --y 9 --width 24 --height 1 --color "$STRUCT_L"
d fill-rect --x 0 --y 15 --width 24 --height 3 --color "$STRUCT_D"
for px in 2 11 20; do
  d fill-rect --x "$px" --y 5 --width 3 --height 15 --color "$STRUCT_D"
  d fill-rect --x "$px" --y 5 --width 1 --height 15 --color "$STRUCT"
  d fill-rect --x "$px" --y 4 --width 3 --height 2 --color "$STRUCT_L"
done

# gate.png — entrance arch in the fence: orange arch on structure posts.
newsprite 24 24 "$A/tiles/gate.png"
d fill-rect --x 1 --y 6 --width 4 --height 16 --color "$STRUCT_D"
d fill-rect --x 2 --y 6 --width 2 --height 16 --color "$STRUCT"
d fill-rect --x 19 --y 6 --width 4 --height 16 --color "$STRUCT_D"
d fill-rect --x 20 --y 6 --width 2 --height 16 --color "$STRUCT"
d fill-rect --x 1 --y 2 --width 22 --height 5 --color "$ROOF"
d fill-rect --x 1 --y 2 --width 22 --height 1 --color "$TRIM"
d stroke-circle --cx 12 --cy 8 --r 9 --color "$ROOF"
d fill-rect --x 8 --y 4 --width 8 --height 2 --color "$TRIM"
d set-pixel --x 11 --y 4 --color "$WHITE"; d set-pixel --x 12 --y 4 --color "$WHITE"

# --- path helper: paved base + paving-joint texture ---------------------------
paved_base() { # fills the tile with the paved surface + subtle stone joints
  d fill-rect --x 0 --y 0 --width 24 --height 24 --color "$PATHC"
  d line --x0 0 --y0 12 --x1 23 --y1 12 --color "$PATH_E"
  d line --x0 12 --y0 0 --x1 12 --y1 23 --color "$PATH_E"
  d set-pixel --x 6 --y 6 --color "$PATH_HL"; d set-pixel --x 18 --y 6 --color "$PATH_HL"
  d set-pixel --x 6 --y 18 --color "$PATH_HL"; d set-pixel --x 18 --y 18 --color "$PATH_HL"
}
curb_t() { d fill-rect --x 0 --y 0 --width 24 --height 2 --color "$PATH_E"; }
curb_b() { d fill-rect --x 0 --y 22 --width 24 --height 2 --color "$PATH_E"; }
curb_l() { d fill-rect --x 0 --y 0 --width 2 --height 24 --color "$PATH_E"; }
curb_r() { d fill-rect --x 22 --y 0 --width 2 --height 24 --color "$PATH_E"; }

# path.png — straight run (walkway edges = curbs top & bottom, open left/right).
newsprite 24 24 "$A/tiles/path.png"; paved_base; curb_t; curb_b

# path_corner.png — right-angle bend (connects two adjacent sides; curbs on the
# other two so laid paths turn cleanly). Connects bottom+right, curbs top+left.
newsprite 24 24 "$A/tiles/path_corner.png"; paved_base; curb_t; curb_l

# path_junction.png — T-junction (connects three sides; single curb on the fourth).
newsprite 24 24 "$A/tiles/path_junction.png"; paved_base; curb_t

# ==============================================================================
# 1b. RIDES — assets/rides/ (static structure; motion is §2c)
# ==============================================================================

# carousel.png — 72x72: round platform + striped conical roof + center pole.
newsprite 72 72 "$A/rides/carousel.png"
d fill-circle --cx 36 --cy 52 --r 30 --color "$STRUCT_D"
d fill-circle --cx 36 --cy 50 --r 29 --color "$STRUCT"
d fill-circle --cx 36 --cy 48 --r 27 --color "$STRUCT_L"
d fill-rect --x 34 --y 18 --width 4 --height 34 --color "$STRUCT_D"
# conical striped roof
d fill-circle --cx 36 --cy 30 --r 28 --color "$ROOF_D"
d fill-circle --cx 36 --cy 28 --r 27 --color "$ROOF"
for x in 12 22 32 42 52 62; do
  d line --x0 36 --y0 6 --x1 "$x" --y1 40 --color "$TRIM"
done
d fill-circle --cx 36 --cy 30 --r 10 --color "$ROOF"
# scalloped trim edge
for x in 10 18 26 34 42 50 58; do d fill-circle --cx "$x" --cy 40 --r 2 --color "$TRIM"; done
# finial
d fill-rect --x 35 --y 2 --width 2 --height 6 --color "$STRUCT"
d fill-circle --cx 36 --cy 3 --r 2 --color "$TRIM"

# coaster.png — 96x72: station house + a hilly length of track with supports.
newsprite 96 72 "$A/rides/coaster.png"
# station building
d fill-rect --x 4 --y 34 --width 34 --height 32 --color "$STRUCT"
d fill-rect --x 4 --y 34 --width 34 --height 3 --color "$STRUCT_L"
d fill-rect --x 2 --y 26 --width 38 --height 9 --color "$ROOF"
d fill-rect --x 2 --y 26 --width 38 --height 2 --color "$TRIM"
d fill-rect --x 16 --y 46 --width 10 --height 20 --color "$STRUCT_D"
d fill-rect --x 8 --y 42 --width 6 --height 6 --color "$THRILL"
d fill-rect --x 28 --y 42 --width 6 --height 6 --color "$THRILL"
# track: a hill from the station across to the right, on support posts
d line --x0 38 --y0 40 --x1 52 --y1 14 --color "$STRUCT_D"
d line --x0 52 --y0 14 --x1 70 --y1 14 --color "$STRUCT_D"
d line --x0 70 --y0 14 --x1 84 --y1 44 --color "$STRUCT_D"
d line --x0 84 --y0 44 --x1 94 --y1 30 --color "$STRUCT_D"
d line --x0 38 --y0 42 --x1 52 --y1 16 --color "$STRUCT"
d line --x0 52 --y0 16 --x1 70 --y1 16 --color "$STRUCT"
d line --x0 70 --y0 16 --x1 84 --y1 46 --color "$STRUCT"
d line --x0 84 --y0 46 --x1 94 --y1 32 --color "$STRUCT"
# accent rail highlight along the crest
d line --x0 52 --y0 13 --x1 70 --y1 13 --color "$THRILL"
# support posts down to the ground line (y=66)
for x in 52 61 70 84; do d fill-rect --x "$x" --y 16 --width 2 --height 50 --color "$STRUCT_D"; done
d fill-rect --x 0 --y 66 --width 96 --height 2 --color "$STRUCT_D"

# drop_tower.png — 48x48: lattice mast + base pad; orange cap; thrill rails.
newsprite 48 48 "$A/rides/drop_tower.png"
d fill-rect --x 8 --y 40 --width 32 --height 6 --color "$STRUCT_D"
d fill-rect --x 8 --y 40 --width 32 --height 2 --color "$STRUCT_L"
d fill-rect --x 17 --y 6 --width 3 --height 36 --color "$STRUCT"
d fill-rect --x 28 --y 6 --width 3 --height 36 --color "$STRUCT"
for y in 10 16 22 28 34; do d fill-rect --x 17 --y "$y" --width 14 --height 2 --color "$STRUCT_D"; done
d fill-rect --x 20 --y 8 --width 8 --height 30 --color "$THRILL"
d fill-rect --x 22 --y 8 --width 4 --height 30 --color "$STRUCT_L"
d fill-rect --x 14 --y 2 --width 20 --height 6 --color "$ROOF"
d fill-rect --x 14 --y 2 --width 20 --height 2 --color "$TRIM"
d fill-rect --x 22 --y 0 --width 4 --height 3 --color "$STRUCT"

# ==============================================================================
# 1c. STALLS — assets/stalls/ (48x24, 2x1 footprint): awning + counter + glyph
# ==============================================================================
stall_base() { # awning roof (striped), counter body, side posts
  d fill-rect --x 1 --y 1 --width 46 --height 8 --color "$ROOF"
  d fill-rect --x 1 --y 1 --width 46 --height 2 --color "$ROOF_D"
  for x in 4 12 20 28 36 44; do d fill-rect --x "$x" --y 3 --width 3 --height 6 --color "$TRIM"; done
  for x in 5 13 21 29 37 45; do d fill-circle --cx "$x" --cy 9 --r 1 --color "$ROOF"; done
  d fill-rect --x 2 --y 10 --width 44 --height 13 --color "$BODY"
  d fill-rect --x 2 --y 20 --width 44 --height 3 --color "$BODY_D"
  d fill-rect --x 2 --y 9 --width 2 --height 14 --color "$STRUCT_D"
  d fill-rect --x 44 --y 9 --width 2 --height 14 --color "$STRUCT_D"
  d fill-rect --x 6 --y 12 --width 36 --height 6 --color "$STRUCT_L"
}

# food.png — burger/food glyph in hunger orange.
newsprite 48 24 "$A/stalls/food.png"; stall_base
d fill-rect --x 18 --y 12 --width 12 --height 2 --color "$HUNGER"
d fill-rect --x 17 --y 14 --width 14 --height 2 --color "$ROOF_D"
d fill-rect --x 18 --y 16 --width 12 --height 2 --color "$HUNGER"
d fill-circle --cx 24 --cy 11 --r 4 --color "$HUNGER"
d set-pixel --x 22 --y 10 --color "$TRIM"; d set-pixel --x 26 --y 11 --color "$TRIM"

# drink.png — cup with a tap/straw in thirst blue.
newsprite 48 24 "$A/stalls/drink.png"; stall_base
d fill-rect --x 20 --y 11 --width 8 --height 8 --color "$THIRST"
d fill-rect --x 20 --y 11 --width 8 --height 2 --color "$WHITE"
d fill-rect --x 27 --y 9 --width 2 --height 6 --color "$STRUCT_D"
d line --x0 24 --y0 8 --x1 24 --y1 11 --color "$WHITE"
d fill-circle --cx 24 --cy 7 --r 1 --color "$THIRST"

# souvenir.png — balloons/flags in happiness gold (a want, not a need).
newsprite 48 24 "$A/stalls/souvenir.png"; stall_base
d fill-circle --cx 20 --cy 13 --r 3 --color "$HAPPY"
d fill-circle --cx 26 --cy 12 --r 3 --color "$THRILL"
d fill-circle --cx 31 --cy 14 --r 3 --color "$THIRST"
d line --x0 20 --y0 16 --x1 24 --y1 19 --color "$STRUCT_D"
d line --x0 26 --y0 15 --x1 24 --y1 19 --color "$STRUCT_D"
d line --x0 31 --y0 17 --x1 24 --y1 19 --color "$STRUCT_D"
d set-pixel --x 19 --y 12 --color "$WHITE"; d set-pixel --x 25 --y 11 --color "$WHITE"

# restroom.png — hut with a clear WC glyph (structure + thirst).
newsprite 48 24 "$A/stalls/restroom.png"; stall_base
d fill-rect --x 18 --y 11 --width 12 --height 8 --color "$STRUCT"
d fill-rect --x 18 --y 11 --width 12 --height 2 --color "$STRUCT_L"
# "WC" in thirst blue
d line --x0 20 --y0 13 --x1 21 --y1 17 --color "$THIRST"
d line --x0 21 --y0 17 --x1 22 --y1 14 --color "$THIRST"
d line --x0 22 --y0 14 --x1 23 --y1 17 --color "$THIRST"
d line --x0 23 --y0 17 --x1 24 --y1 13 --color "$THIRST"
d line --x0 28 --y0 13 --x1 26 --y1 14 --color "$THIRST"
d line --x0 26 --y0 14 --x1 26 --y1 16 --color "$THIRST"
d line --x0 26 --y0 16 --x1 28 --y1 17 --color "$THIRST"

# ==============================================================================
# 1d. SCENERY — assets/scenery/
# ==============================================================================

# tree.png — 24x24: round leafy canopy + trunk.
newsprite 24 24 "$A/scenery/tree.png"
d fill-rect --x 10 --y 16 --width 4 --height 7 --color "$TRUNK"
d fill-rect --x 10 --y 16 --width 1 --height 7 --color '#7d5638'
d fill-circle --cx 12 --cy 10 --r 9 --color "$FOLIAGE"
d fill-circle --cx 10 --cy 8 --r 5 --color "$FOLIAGE_L"
d fill-circle --cx 15 --cy 11 --r 4 --color "$FOLIAGE_L"
d set-pixel --x 9 --y 6 --color "$GRASS_L"; d set-pixel --x 13 --y 7 --color "$GRASS_L"

# flowerbed.png — 24x24: low green mound with mixed-color blooms.
newsprite 24 24 "$A/scenery/flowerbed.png"
d fill-rect --x 2 --y 15 --width 20 --height 7 --color "$FOLIAGE"
d fill-rect --x 2 --y 15 --width 20 --height 1 --color "$FOLIAGE_L"
d fill-rect --x 2 --y 21 --width 20 --height 1 --color '#245f2c'
for xy in 5,14,'#f59042' 9,16,'#c46bff' 13,14,'#ffd24a' 17,16,'#ff8fb0' 20,14,'#45c6f0'; do
  IFS=, read -r fx fy fc <<<"$xy"; fc="${fc//\'/}"
  d fill-circle --cx "$fx" --cy "$fy" --r 2 --color "$fc"
  d set-pixel --x "$fx" --y "$fy" --color "$TRIM"
done

# bench.png — 24x24: wooden seat + back slats on structure legs.
newsprite 24 24 "$A/scenery/bench.png"
d fill-rect --x 3 --y 8 --width 18 --height 2 --color "$WOOD"
d fill-rect --x 3 --y 11 --width 18 --height 2 --color "$WOOD"
d fill-rect --x 3 --y 14 --width 18 --height 3 --color "$WOOD"
d fill-rect --x 3 --y 14 --width 18 --height 1 --color '#c9a877'
d fill-rect --x 4 --y 17 --width 3 --height 4 --color "$STRUCT_D"
d fill-rect --x 17 --y 17 --width 3 --height 4 --color "$STRUCT_D"
d fill-rect --x 4 --y 9 --width 2 --height 8 --color "$STRUCT"
d fill-rect --x 18 --y 9 --width 2 --height 8 --color "$STRUCT"

# lamp.png — 24x24: post with a warm golden-hour glow head.
newsprite 24 24 "$A/scenery/lamp.png"
d fill-rect --x 11 --y 8 --width 2 --height 14 --color "$STRUCT"
d fill-rect --x 8 --y 20 --width 8 --height 2 --color "$STRUCT_D"
d fill-circle --cx 12 --cy 6 --r 5 --color '#5a4a1e'
d fill-circle --cx 12 --cy 6 --r 4 --color "$TRIM"
d fill-circle --cx 12 --cy 6 --r 2 --color "$HAPPY"
d set-pixel --x 11 --y 5 --color "$WHITE"
d fill-rect --x 9 --y 2 --width 6 --height 2 --color "$STRUCT_D"

# fountain.png — 48x48: stone basin (concentric) + water jet.
newsprite 48 48 "$A/scenery/fountain.png"
d fill-circle --cx 24 --cy 26 --r 20 --color "$STRUCT_D"
d fill-circle --cx 24 --cy 24 --r 19 --color "$STONE"
d fill-circle --cx 24 --cy 24 --r 16 --color "$WATER_D"
d fill-circle --cx 24 --cy 23 --r 15 --color "$WATER"
d stroke-circle --cx 24 --cy 23 --r 11 --color "$WATER_HI"
d fill-circle --cx 24 --cy 24 --r 5 --color "$STONE"
d fill-circle --cx 24 --cy 24 --r 4 --color "$STRUCT_L"
d fill-rect --x 23 --y 8 --width 2 --height 16 --color "$WATER_HI"
d fill-circle --cx 24 --cy 8 --r 2 --color "$WHITE"
d set-pixel --x 20 --y 14 --color "$WATER_HI"; d set-pixel --x 28 --y 16 --color "$WATER_HI"
d set-pixel --x 14 --y 24 --color "$WHITE"; d set-pixel --x 33 --y 27 --color "$WHITE"

# ==============================================================================
# 1e. HUD ICONS — assets/icons/ (16x16), bold single-glyph marks
# ==============================================================================

# cash.png — a coin with a center mark.
newsprite 16 16 "$A/icons/cash.png"
d fill-circle --cx 8 --cy 8 --r 7 --color '#2f7d3f'
d fill-circle --cx 8 --cy 8 --r 6 --color "$CASH"
d fill-circle --cx 8 --cy 8 --r 4 --color '#8fe89a'
d fill-rect --x 7 --y 4 --width 2 --height 8 --color '#2f7d3f'
d line --x0 6 --y0 5 --x1 10 --y1 5 --color '#2f7d3f'
d line --x0 6 --y0 10 --x1 10 --y1 10 --color '#2f7d3f'

# guest.png — a little guest head + shoulders.
newsprite 16 16 "$A/icons/guest.png"
d fill-circle --cx 8 --cy 6 --r 4 --color "$GUEST"
d fill-circle --cx 8 --cy 6 --r 4 --color "$GUEST"
d fill-rect --x 4 --y 10 --width 8 --height 5 --color "$GUEST"
d fill-rect --x 4 --y 10 --width 8 --height 1 --color "$GUEST_D"
d set-pixel --x 6 --y 5 --color "$WHITE"

# star.png — 5-point rating star (outline + flood fill).
newsprite 16 16 "$A/icons/star.png"
d line --x0 8 --y0 1 --x1 10 --y1 6 --color "$STAR"
d line --x0 10 --y0 6 --x1 15 --y1 6 --color "$STAR"
d line --x0 15 --y0 6 --x1 11 --y1 9 --color "$STAR"
d line --x0 11 --y0 9 --x1 12 --y1 14 --color "$STAR"
d line --x0 12 --y0 14 --x1 8 --y1 11 --color "$STAR"
d line --x0 8 --y0 11 --x1 4 --y1 14 --color "$STAR"
d line --x0 4 --y0 14 --x1 5 --y1 9 --color "$STAR"
d line --x0 5 --y0 9 --x1 1 --y1 6 --color "$STAR"
d line --x0 1 --y0 6 --x1 6 --y1 6 --color "$STAR"
d line --x0 6 --y0 6 --x1 8 --y1 1 --color "$STAR"
d flood-fill --x 8 --y 8 --color "$STAR"
d set-pixel --x 7 --y 5 --color "$WHITE"

# happiness.png — smiley mood face.
newsprite 16 16 "$A/icons/happiness.png"
d fill-circle --cx 8 --cy 8 --r 7 --color '#c99a1e'
d fill-circle --cx 8 --cy 8 --r 6 --color "$HAPPY"
d fill-rect --x 5 --y 6 --width 2 --height 2 --color '#5a4a1e'
d fill-rect --x 9 --y 6 --width 2 --height 2 --color '#5a4a1e'
d line --x0 5 --y0 10 --x1 6 --y1 11 --color '#5a4a1e'
d line --x0 6 --y0 11 --x1 9 --y1 11 --color '#5a4a1e'
d line --x0 9 --y0 11 --x1 10 --y1 10 --color '#5a4a1e'

# thrill.png — lightning bolt.
newsprite 16 16 "$A/icons/thrill.png"
d fill-rect --x 8 --y 1 --width 4 --height 3 --color "$THRILL"
d fill-rect --x 6 --y 4 --width 4 --height 3 --color "$THRILL"
d fill-rect --x 5 --y 7 --width 6 --height 2 --color "$THRILL"
d fill-rect --x 4 --y 7 --width 8 --height 1 --color '#e0b0ff'
d fill-rect --x 6 --y 9 --width 4 --height 3 --color "$THRILL"
d fill-rect --x 4 --y 12 --width 4 --height 3 --color "$THRILL"
d set-pixel --x 9 --y 2 --color "$WHITE"

# hunger.png — a drumstick / food glyph.
newsprite 16 16 "$A/icons/hunger.png"
d fill-circle --cx 6 --cy 6 --r 4 --color "$HUNGER"
d fill-circle --cx 5 --cy 5 --r 2 --color '#ffb066'
d fill-rect --x 8 --y 8 --width 6 --height 3 --color '#c9762a'
d fill-rect --x 12 --y 9 --width 3 --height 3 --color "$TEXT"
d set-pixel --x 4 --y 4 --color "$WHITE"

# thirst.png — a cup with a drop.
newsprite 16 16 "$A/icons/thirst.png"
d fill-rect --x 4 --y 6 --width 8 --height 8 --color "$THIRST"
d fill-rect --x 4 --y 6 --width 8 --height 2 --color '#7fd8f5'
d fill-rect --x 3 --y 5 --width 10 --height 1 --color "$WHITE"
d fill-circle --cx 8 --cy 3 --r 2 --color "$THIRST"
d set-pixel --x 8 --y 1 --color "$WHITE"

# bladder.png — a water droplet (WC/relief).
newsprite 16 16 "$A/icons/bladder.png"
d fill-circle --cx 8 --cy 10 --r 5 --color "$THIRST"
d line --x0 8 --y0 2 --x1 4 --y1 9 --color "$THIRST"
d line --x0 8 --y0 2 --x1 12 --y1 9 --color "$THIRST"
d fill-rect --x 6 --y 6 --width 5 --height 6 --color "$THIRST"
d fill-circle --cx 6 --cy 9 --r 2 --color "$WHITE"

# energy.png — a bolt reserve (gold).
newsprite 16 16 "$A/icons/energy.png"
d fill-rect --x 8 --y 1 --width 4 --height 3 --color "$HAPPY"
d fill-rect --x 6 --y 4 --width 4 --height 3 --color "$HAPPY"
d fill-rect --x 4 --y 7 --width 8 --height 2 --color "$HAPPY"
d fill-rect --x 6 --y 9 --width 4 --height 3 --color "$HAPPY"
d fill-rect --x 4 --y 12 --width 4 --height 3 --color "$HAPPY"
d set-pixel --x 9 --y 2 --color "$WHITE"

# litter.png — crumpled paper.
newsprite 16 16 "$A/icons/litter.png"
d fill-circle --cx 8 --cy 9 --r 5 --color "$TEXT3"
d fill-circle --cx 6 --cy 7 --r 2 --color '#8a94a6'
d line --x0 4 --y0 9 --x1 12 --y1 8 --color '#4d5666'
d line --x0 6 --y0 12 --x1 11 --y1 6 --color '#4d5666'
d set-pixel --x 5 --y 6 --color '#aeb6c6'

# alert.png — warning triangle with "!".
newsprite 16 16 "$A/icons/alert.png"
d line --x0 8 --y0 2 --x1 1 --y1 14 --color "$ALERT"
d line --x0 8 --y0 2 --x1 15 --y1 14 --color "$ALERT"
d line --x0 1 --y0 14 --x1 15 --y1 14 --color "$ALERT"
d flood-fill --x 8 --y 11 --color "$ALERT"
d fill-rect --x 7 --y 6 --width 2 --height 4 --color "$WHITE"
d fill-rect --x 7 --y 11 --width 2 --height 2 --color "$WHITE"

# tool_path.png — a paved-strip glyph.
newsprite 16 16 "$A/icons/tool_path.png"
d fill-rect --x 2 --y 5 --width 12 --height 6 --color "$PATHC"
d fill-rect --x 2 --y 5 --width 12 --height 1 --color "$PATH_HL"
d fill-rect --x 2 --y 10 --width 12 --height 1 --color "$PATH_E"
for x in 5 8 11; do d fill-rect --x "$x" --y 6 --width 1 --height 4 --color "$PATH_E"; done

# tool_build.png — a hammer (build) in roof orange.
newsprite 16 16 "$A/icons/tool_build.png"
d fill-rect --x 3 --y 3 --width 9 --height 4 --color "$ROOF"
d fill-rect --x 3 --y 3 --width 9 --height 1 --color "$TRIM"
d fill-rect --x 7 --y 6 --width 3 --height 9 --color "$WOOD"
d fill-rect --x 7 --y 6 --width 1 --height 9 --color '#c9a877'

# tool_staff.png — a person (staff) in guest pink.
newsprite 16 16 "$A/icons/tool_staff.png"
d fill-circle --cx 8 --cy 5 --r 3 --color "$GUEST"
d fill-rect --x 5 --y 8 --width 6 --height 6 --color "$GUEST"
d fill-rect --x 5 --y 8 --width 6 --height 1 --color "$GUEST_D"
d set-pixel --x 7 --y 4 --color "$WHITE"

# tool_price.png — a price tag in cash green.
newsprite 16 16 "$A/icons/tool_price.png"
d line --x0 3 --y0 3 --x1 12 --y1 3 --color "$CASH"
d line --x0 12 --y0 3 --x1 13 --y1 4 --color "$CASH"
d line --x0 3 --y0 3 --x1 3 --y1 12 --color "$CASH"
d line --x0 3 --y0 12 --x1 13 --y1 4 --color "$CASH"
d flood-fill --x 6 --y 6 --color "$CASH"
d fill-circle --cx 5 --cy 5 --r 1 --color '#0f1626'
d set-pixel --x 9 --y 7 --color "$WHITE"

# tool_demolish.png — a demolish X in alert red.
newsprite 16 16 "$A/icons/tool_demolish.png"
d line --x0 3 --y0 3 --x1 12 --y1 12 --color "$ALERT"
d line --x0 3 --y0 4 --x1 11 --y1 12 --color "$ALERT"
d line --x0 4 --y0 3 --x1 12 --y1 11 --color "$ALERT"
d line --x0 12 --y0 3 --x1 3 --y1 12 --color "$ALERT"
d line --x0 12 --y0 4 --x1 4 --y1 12 --color "$ALERT"
d line --x0 11 --y0 3 --x1 3 --y1 11 --color "$ALERT"
d set-pixel --x 5 --y 5 --color "$WHITE"; d set-pixel --x 10 --y 10 --color "$WHITE"

echo "Midway §1 sprites produced under $A/{tiles,rides,stalls,scenery,icons}"
