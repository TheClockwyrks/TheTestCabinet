#!/usr/bin/env bash
# Holdfast — produce every static pixel-art sprite the game loads (specs/assets.md §1),
# with the on-PATH `draw` tool. Covers the whole `draw` category:
#   terrain tiles (assets/terrain/), resource nodes (assets/nodes/),
#   structures/machines (assets/structures/), item icons (assets/items/),
#   and HUD/palette icons (assets/icons/).
# Animations (draw-sheet), particle systems (particle-2d), and audio (sfx/music) are
# produced by their own scripts — this one is the `draw` sprites only.
#
# All colors are the specs/overview.md palette. Terrain tiles fill their 32x32 (they
# tile flush); everything else is drawn on a transparent (straight-alpha) canvas.
# Tiles/structures/nodes are 32x32; item & HUD icons are 16x16.
#
# Usage:  bash scripts/gen-sprites.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
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

mkdir -p "$A/terrain" "$A/nodes" "$A/structures" "$A/items" "$A/icons"

# newsprite <w> <h> <out.png> [background] : start a fresh transparent (or filled) canvas.
newsprite() {
  local bg="${4:-transparent}"
  printf '{ "width": %s, "height": %s, "background": "%s", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$bg" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# ============================================================================
# 1a. TERRAIN — 32x32, base color fills the tile (tiles flush against neighbors)
# ============================================================================

# soil.png — bare walkable ground: #5a4632 base with darker #4a3826 grain specks.
newsprite 32 32 "$A/terrain/soil.png" '#5a4632'
for xy in 4,5 9,20 15,10 22,26 27,7 19,17 6,27 25,18 12,29 2,14 30,22 17,3; do
  d fill-rect --x "${xy%,*}" --y "${xy#*,}" --width 2 --height 1 --color '#4a3826'
done
for xy in 8,8 24,23 17,4 3,25 28,12; do
  d set-pixel --x "${xy%,*}" --y "${xy#*,}" --color '#6a5238'
done

# grass.png — fertile ground: #6a7638 base, #7c8a44 light / #5a6630 dark blades.
newsprite 32 32 "$A/terrain/grass.png" '#6a7638'
for xy in 3,26 7,10 11,29 14,14 18,24 21,8 25,28 29,12 5,18 16,4; do
  x="${xy%,*}"; y="${xy#*,}"; d line --x0 "$x" --y0 "$y" --x1 "$x" --y1 "$((y-3))" --color '#7c8a44'
done
for xy in 5,30 9,22 13,9 19,30 23,16 27,6 30,26 1,12 15,20 24,4; do
  x="${xy%,*}"; y="${xy#*,}"; d line --x0 "$x" --y0 "$y" --x1 "$x" --y1 "$((y-2))" --color '#5a6630'
done

# rock.png — impassable outcrop: #38332c base, #2b271f cracks, #4a4238 highlights.
newsprite 32 32 "$A/terrain/rock.png" '#38332c'
d fill-circle --cx 10 --cy 11 --r 8 --color '#413a31'
d fill-circle --cx 23 --cy 22 --r 9 --color '#413a31'
d fill-circle --cx 8 --cy 9 --r 4 --color '#4a4238'
d fill-circle --cx 21 --cy 19 --r 4 --color '#4a4238'
d line --x0 0 --y0 18 --x1 14 --y1 24 --color '#2b271f'
d line --x0 14 --y0 24 --x1 31 --y1 15 --color '#2b271f'
d line --x0 16 --y0 0 --x1 12 --y1 12 --color '#2b271f'
d line --x0 20 --y0 31 --x1 26 --y1 24 --color '#2b271f'

# floor.png — built plank floor/path: #4a3f30 planks, #5a4c3a seams (brick-laid).
newsprite 32 32 "$A/terrain/floor.png" '#4a3f30'
for y in 7 15 23 31; do d line --x0 0 --y0 "$y" --x1 31 --y1 "$y" --color '#5a4c3a'; done
d line --x0 16 --y0 0 --x1 16 --y1 7 --color '#5a4c3a'
d line --x0 8 --y0 8 --x1 8 --y1 15 --color '#5a4c3a'
d line --x0 24 --y0 8 --x1 24 --y1 15 --color '#5a4c3a'
d line --x0 16 --y0 16 --x1 16 --y1 23 --color '#5a4c3a'
d line --x0 8 --y0 24 --x1 8 --y1 31 --color '#5a4c3a'
d line --x0 24 --y0 24 --x1 24 --y1 31 --color '#5a4c3a'

# ============================================================================
# 1b. RESOURCE NODES — 32x32, transparent (terrain shows through)
# ============================================================================

# tree.png — forest node: rounded canopy #3f6b3a/#4f7c46 over trunk #5a4632.
newsprite 32 32 "$A/nodes/tree.png"
d fill-rect --x 14 --y 21 --width 5 --height 10 --color '#4a3826'
d fill-rect --x 14 --y 21 --width 3 --height 10 --color '#5a4632'
d fill-circle --cx 16 --cy 13 --r 11 --color '#2f5230'
d fill-circle --cx 16 --cy 13 --r 10 --color '#3f6b3a'
d fill-circle --cx 13 --cy 10 --r 6 --color '#4f7c46'
d fill-circle --cx 20 --cy 15 --r 4 --color '#4f7c46'
d fill-circle --cx 12 --cy 8 --r 2 --color '#5f8c52'

# ore.png — mineral vein: gold flecks #c9a24a/#e0b85c in a dark matrix #38332c.
newsprite 32 32 "$A/nodes/ore.png"
d fill-circle --cx 16 --cy 19 --r 12 --color '#2b271f'
d fill-circle --cx 16 --cy 18 --r 10 --color '#38332c'
d fill-circle --cx 13 --cy 15 --r 4 --color '#413a31'
for xy in 11,13 20,14 15,20 22,22 9,22 18,25 24,17 12,26; do
  d fill-rect --x "${xy%,*}" --y "${xy#*,}" --width 2 --height 2 --color '#c9a24a'
done
for xy in 12,14 21,15 16,21 10,23 19,26; do
  d set-pixel --x "${xy%,*}" --y "${xy#*,}" --color '#e0b85c'
done

# ============================================================================
# 1c. STRUCTURES — 32x32, transparent
# ============================================================================

# wall.png — solid built wall block: #8a6a44 face, #6e5436 mortar, #a07e52 top.
newsprite 32 32 "$A/structures/wall.png"
d fill-rect --x 0 --y 0 --width 32 --height 32 --color '#8a6a44'
d fill-rect --x 0 --y 0 --width 32 --height 3 --color '#a07e52'
d line --x0 0 --y0 10 --x1 31 --y1 10 --color '#6e5436'
d line --x0 0 --y0 21 --x1 31 --y1 21 --color '#6e5436'
d line --x0 16 --y0 3 --x1 16 --y1 10 --color '#6e5436'
d line --x0 8 --y0 11 --x1 8 --y1 21 --color '#6e5436'
d line --x0 24 --y0 11 --x1 24 --y1 21 --color '#6e5436'
d line --x0 16 --y0 22 --x1 16 --y1 31 --color '#6e5436'

# door.png — passable slot in a wall line: #8a6a44 frame, #4a3f30 gap, #a07e52 posts.
newsprite 32 32 "$A/structures/door.png"
d fill-rect --x 0 --y 0 --width 32 --height 32 --color '#4a3f30'
d fill-rect --x 0 --y 0 --width 8 --height 32 --color '#8a6a44'
d fill-rect --x 24 --y 0 --width 8 --height 32 --color '#8a6a44'
d fill-rect --x 0 --y 0 --width 8 --height 3 --color '#a07e52'
d fill-rect --x 24 --y 0 --width 8 --height 3 --color '#a07e52'
d fill-rect --x 0 --y 0 --width 32 --height 4 --color '#8a6a44'
d fill-rect --x 0 --y 0 --width 32 --height 2 --color '#a07e52'
d fill-rect --x 12 --y 6 --width 8 --height 22 --color '#3a3226'

# bed.png — a bed: #8a6a44 frame, blanket #3a6e97 / #4f93c9, pillow lighter.
newsprite 32 32 "$A/structures/bed.png"
d fill-rect --x 6 --y 3 --width 20 --height 26 --color '#6e5436'
d fill-rect --x 7 --y 4 --width 18 --height 24 --color '#8a6a44'
d fill-rect --x 9 --y 6 --width 14 --height 7 --color '#7fb0dc'
d fill-rect --x 9 --y 13 --width 14 --height 14 --color '#3a6e97'
d fill-rect --x 9 --y 13 --width 14 --height 8 --color '#4f93c9'
d line --x0 16 --y0 13 --x1 16 --y1 26 --color '#3a6e97'

# stove_idle.png — cold cook station: #8a6a44 body, #38332c plate.
newsprite 32 32 "$A/structures/stove_idle.png"
d fill-rect --x 4 --y 7 --width 24 --height 21 --color '#6e5436'
d fill-rect --x 5 --y 8 --width 22 --height 19 --color '#8a6a44'
d fill-rect --x 5 --y 8 --width 22 --height 6 --color '#38332c'
d fill-circle --cx 11 --cy 11 --r 2 --color '#2b271f'
d fill-circle --cx 21 --cy 11 --r 2 --color '#2b271f'
d fill-rect --x 9 --y 17 --width 14 --height 9 --color '#6e5436'
d fill-rect --x 11 --y 19 --width 10 --height 5 --color '#38332c'

# stove_on.png — cooking: lit firebox #ff5a52/#c9a24a + a #7cc45a pot on the plate.
newsprite 32 32 "$A/structures/stove_on.png"
d fill-rect --x 4 --y 7 --width 24 --height 21 --color '#6e5436'
d fill-rect --x 5 --y 8 --width 22 --height 19 --color '#8a6a44'
d fill-rect --x 5 --y 8 --width 22 --height 6 --color '#38332c'
d fill-rect --x 9 --y 17 --width 14 --height 9 --color '#6e5436'
d fill-rect --x 11 --y 19 --width 10 --height 5 --color '#7a2b26'
d fill-rect --x 12 --y 21 --width 8 --height 3 --color '#ff5a52'
d fill-rect --x 13 --y 22 --width 6 --height 2 --color '#c9a24a'
d fill-circle --cx 16 --cy 10 --r 5 --color '#2b271f'
d fill-circle --cx 16 --cy 10 --r 4 --color '#38332c'
d fill-rect --x 12 --y 8 --width 8 --height 2 --color '#7cc45a'
d fill-circle --cx 14 --cy 9 --r 1 --color '#8fd66a'

# farm_empty.png — sown bare plot: tilled furrows #5a4632 / #4a3826.
newsprite 32 32 "$A/structures/farm_empty.png" '#5a4632'
for y in 4 11 18 25; do
  d fill-rect --x 2 --y "$y" --width 28 --height 2 --color '#4a3826'
  d fill-rect --x 2 --y "$((y+2))" --width 28 --height 2 --color '#63503a'
done

# farm_growing.png — mid-growth: furrows + small #7cc45a sprouts.
newsprite 32 32 "$A/structures/farm_growing.png" '#5a4632'
for y in 4 11 18 25; do
  d fill-rect --x 2 --y "$y" --width 28 --height 2 --color '#4a3826'
done
for y in 6 13 20 27; do
  for x in 5 11 17 23 29; do d set-pixel --x "$x" --y "$y" --color '#7cc45a'; done
done

# farm_ripe.png — ready to harvest: furrows + full crop tops #7cc45a/#8fd66a.
newsprite 32 32 "$A/structures/farm_ripe.png" '#5a4632'
for y in 4 11 18 25; do
  d fill-rect --x 2 --y "$y" --width 28 --height 1 --color '#4a3826'
done
for y in 6 13 20 27; do
  for x in 5 11 17 23 29; do
    d fill-rect --x "$((x-1))" --y "$((y-2))" --width 3 --height 3 --color '#7cc45a'
    d set-pixel --x "$x" --y "$((y-2))" --color '#8fd66a'
  done
done

# turret_idle.png — automated turret at rest: #8a6a44 base, #38332c barrel, #c9a24a trim.
newsprite 32 32 "$A/structures/turret_idle.png"
d fill-circle --cx 16 --cy 18 --r 10 --color '#6e5436'
d fill-circle --cx 16 --cy 18 --r 9 --color '#8a6a44'
d stroke-circle --cx 16 --cy 18 --r 9 --color '#c9a24a'
d fill-circle --cx 15 --cy 17 --r 6 --color '#a07e52'
d fill-circle --cx 15 --cy 17 --r 5 --color '#8a6a44'
d fill-rect --x 15 --y 15 --width 15 --height 4 --color '#2b271f'
d fill-rect --x 15 --y 16 --width 15 --height 2 --color '#38332c'
d fill-circle --cx 15 --cy 17 --r 2 --color '#c9a24a'

# turret_firing.png — firing: idle turret + a lit muzzle #ffcf6a/#ff5a52 at the barrel tip.
newsprite 32 32 "$A/structures/turret_firing.png"
d fill-circle --cx 16 --cy 18 --r 10 --color '#6e5436'
d fill-circle --cx 16 --cy 18 --r 9 --color '#8a6a44'
d stroke-circle --cx 16 --cy 18 --r 9 --color '#c9a24a'
d fill-circle --cx 15 --cy 17 --r 6 --color '#a07e52'
d fill-circle --cx 15 --cy 17 --r 5 --color '#8a6a44'
d fill-rect --x 15 --y 15 --width 15 --height 4 --color '#2b271f'
d fill-rect --x 15 --y 16 --width 15 --height 2 --color '#38332c'
d fill-circle --cx 15 --cy 17 --r 2 --color '#c9a24a'
d fill-circle --cx 30 --cy 17 --r 3 --color '#ff5a52'
d fill-circle --cx 30 --cy 17 --r 2 --color '#ffcf6a'
d set-pixel --x 30 --y 17 --color '#ffffff'

# ============================================================================
# 1d. ITEM ICONS — 16x16, transparent (stockpile / hauled marks)
# ============================================================================

# wood.png — a small stack of logs: #b98b4e logs, #8a6a44 ends.
newsprite 16 16 "$A/items/wood.png"
d fill-rect --x 2 --y 9 --width 12 --height 3 --color '#b98b4e'
d fill-rect --x 2 --y 9 --width 2 --height 3 --color '#8a6a44'
d fill-rect --x 12 --y 9 --width 2 --height 3 --color '#8a6a44'
d fill-rect --x 3 --y 6 --width 10 --height 3 --color '#c69a5c'
d fill-rect --x 3 --y 6 --width 2 --height 3 --color '#8a6a44'
d fill-rect --x 11 --y 6 --width 2 --height 3 --color '#8a6a44'
d fill-rect --x 5 --y 3 --width 6 --height 3 --color '#b98b4e'
d fill-rect --x 5 --y 3 --width 2 --height 3 --color '#8a6a44'
d fill-rect --x 9 --y 3 --width 2 --height 3 --color '#8a6a44'

# ore.png — ore chunks: #c9a24a chunks, #38332c shadow, #e0b85c highlight.
newsprite 16 16 "$A/items/ore.png"
d fill-circle --cx 8 --cy 12 --r 3 --color '#38332c'
d fill-circle --cx 6 --cy 9 --r 3 --color '#c9a24a'
d fill-circle --cx 10 --cy 8 --r 3 --color '#c9a24a'
d fill-circle --cx 8 --cy 11 --r 3 --color '#c9a24a'
d set-pixel --x 5 --y 8 --color '#e0b85c'
d set-pixel --x 10 --y 7 --color '#e0b85c'
d set-pixel --x 8 --y 10 --color '#e0b85c'

# crops.png — raw harvested crops (bundle): #7cc45a / #8fd66a.
newsprite 16 16 "$A/items/crops.png"
for x in 5 8 11; do d line --x0 "$x" --y0 13 --x1 "$x" --y1 6 --color '#5a9640'; done
d fill-circle --cx 5 --cy 5 --r 2 --color '#7cc45a'
d fill-circle --cx 8 --cy 4 --r 2 --color '#7cc45a'
d fill-circle --cx 11 --cy 5 --r 2 --color '#7cc45a'
d set-pixel --x 5 --y 4 --color '#8fd66a'
d set-pixel --x 8 --y 3 --color '#8fd66a'
d set-pixel --x 11 --y 4 --color '#8fd66a'
d fill-rect --x 4 --y 12 --width 8 --height 2 --color '#8a6a44'

# meal.png — a cooked meal: plate #a89e8d, food #7cc45a/#e0b85c.
newsprite 16 16 "$A/items/meal.png"
d fill-circle --cx 8 --cy 9 --r 6 --color '#8a8072'
d fill-circle --cx 8 --cy 9 --r 5 --color '#a89e8d'
d fill-circle --cx 8 --cy 8 --r 3 --color '#7cc45a'
d fill-circle --cx 6 --cy 8 --r 1 --color '#e0b85c'
d fill-circle --cx 10 --cy 9 --r 1 --color '#e0b85c'
d set-pixel --x 8 --y 7 --color '#8fd66a'

# ============================================================================
# 1e. HUD / PALETTE ICONS — 16x16, transparent (small marks the code HUD uses)
# ============================================================================

# icons/wood.png — single log glyph.
newsprite 16 16 "$A/icons/wood.png"
d fill-rect --x 2 --y 6 --width 12 --height 4 --color '#b98b4e'
d fill-rect --x 2 --y 6 --width 2 --height 4 --color '#8a6a44'
d fill-rect --x 12 --y 6 --width 2 --height 4 --color '#8a6a44'
d line --x0 5 --y0 7 --x1 11 --y1 7 --color '#c69a5c'

# icons/ore.png — ore-stock glyph.
newsprite 16 16 "$A/icons/ore.png"
d fill-circle --cx 8 --cy 9 --r 5 --color '#38332c'
d fill-circle --cx 8 --cy 8 --r 4 --color '#c9a24a'
d fill-circle --cx 6 --cy 6 --r 1 --color '#e0b85c'
d set-pixel --x 9 --y 9 --color '#e0b85c'

# icons/crops.png — crops-stock glyph.
newsprite 16 16 "$A/icons/crops.png"
d line --x0 8 --y0 14 --x1 8 --y1 5 --color '#5a9640'
d fill-circle --cx 8 --cy 5 --r 3 --color '#7cc45a'
d fill-circle --cx 5 --cy 8 --r 2 --color '#7cc45a'
d fill-circle --cx 11 --cy 8 --r 2 --color '#7cc45a'
d set-pixel --x 7 --y 4 --color '#8fd66a'

# icons/meal.png — meals-stock glyph (fork + morsel).
newsprite 16 16 "$A/icons/meal.png"
d fill-circle --cx 8 --cy 8 --r 5 --color '#5a9640'
d fill-circle --cx 8 --cy 8 --r 4 --color '#7cc45a'
d fill-circle --cx 7 --cy 7 --r 2 --color '#8fd66a'
d fill-circle --cx 10 --cy 10 --r 1 --color '#e0b85c'

# icons/settler.png — colonist mark: #4f93c9 body + #cfe3f2 helmet.
newsprite 16 16 "$A/icons/settler.png"
d fill-rect --x 5 --y 8 --width 6 --height 6 --color '#2f5c85'
d fill-rect --x 5 --y 8 --width 6 --height 4 --color '#4f93c9'
d fill-circle --cx 8 --cy 5 --r 4 --color '#2f5c85'
d fill-circle --cx 8 --cy 5 --r 3 --color '#cfe3f2'
d fill-rect --x 5 --y 5 --width 6 --height 2 --color '#cfe3f2'

# icons/raider.png — raider/threat mark: #c0473f, hunched hostile stance.
newsprite 16 16 "$A/icons/raider.png"
d fill-rect --x 4 --y 9 --width 8 --height 5 --color '#7a2b26'
d fill-rect --x 4 --y 9 --width 8 --height 3 --color '#c0473f'
d fill-circle --cx 8 --cy 6 --r 4 --color '#7a2b26'
d fill-circle --cx 8 --cy 6 --r 3 --color '#c0473f'
d fill-rect --x 5 --y 5 --width 6 --height 2 --color '#38332c'
d set-pixel --x 6 --y 6 --color '#ff5a52'
d set-pixel --x 10 --y 6 --color '#ff5a52'

# icons/alert.png — danger glyph: #ff5a52 triangle + #14110d bang.
newsprite 16 16 "$A/icons/alert.png"
for row in 0 1 2 3 4 5 6 7 8 9 10; do
  half=$(( 1 + row*6/10 ))
  d fill-rect --x $(( 8 - half )) --y $(( 2 + row )) --width $(( half*2 )) --height 1 --color '#ff5a52'
done
d fill-rect --x 7 --y 5 --width 2 --height 5 --color '#14110d'
d fill-rect --x 7 --y 11 --width 2 --height 2 --color '#14110d'

# icons/tool_designate.png — designate (chop/mine): #ece6db bracket + #c9a24a pick.
newsprite 16 16 "$A/icons/tool_designate.png"
d line --x0 2 --y0 2 --x1 5 --y1 2 --color '#ece6db'
d line --x0 2 --y0 2 --x1 2 --y1 5 --color '#ece6db'
d line --x0 10 --y0 2 --x1 13 --y1 2 --color '#ece6db'
d line --x0 13 --y0 2 --x1 13 --y1 5 --color '#ece6db'
d line --x0 2 --y0 13 --x1 2 --y1 10 --color '#ece6db'
d line --x0 2 --y0 13 --x1 5 --y1 13 --color '#ece6db'
d line --x0 13 --y0 13 --x1 10 --y1 13 --color '#ece6db'
d line --x0 13 --y0 13 --x1 13 --y1 10 --color '#ece6db'
d line --x0 5 --y0 11 --x1 11 --y1 5 --color '#8a6a44'
d line --x0 9 --y0 3 --x1 13 --y1 7 --color '#c9a24a'
d fill-rect --x 4 --y 10 --width 3 --height 3 --color '#b98b4e'

# icons/tool_cancel.png — cancel / deconstruct: #ff5a52 X.
newsprite 16 16 "$A/icons/tool_cancel.png"
d line --x0 3 --y0 3 --x1 12 --y1 12 --color '#ff5a52'
d line --x0 4 --y0 3 --x1 12 --y1 11 --color '#ff5a52'
d line --x0 3 --y0 4 --x1 11 --y1 12 --color '#ff5a52'
d line --x0 12 --y0 3 --x1 3 --y1 12 --color '#ff5a52'
d line --x0 11 --y0 3 --x1 3 --y1 11 --color '#ff5a52'
d line --x0 12 --y0 4 --x1 4 --y1 12 --color '#ff5a52'

# icons/build_wall.png — palette glyph: wall (brick block).
newsprite 16 16 "$A/icons/build_wall.png"
d fill-rect --x 2 --y 3 --width 12 --height 10 --color '#8a6a44'
d fill-rect --x 2 --y 3 --width 12 --height 2 --color '#a07e52'
d line --x0 2 --y0 8 --x1 13 --y1 8 --color '#6e5436'
d line --x0 8 --y0 5 --x1 8 --y1 8 --color '#6e5436'
d line --x0 5 --y0 8 --x1 5 --y1 12 --color '#6e5436'
d line --x0 11 --y0 8 --x1 11 --y1 12 --color '#6e5436'

# icons/build_door.png — palette glyph: door (#8a6a44 frame / #4a3f30 gap).
newsprite 16 16 "$A/icons/build_door.png"
d fill-rect --x 3 --y 2 --width 10 --height 12 --color '#8a6a44'
d fill-rect --x 6 --y 4 --width 4 --height 10 --color '#4a3f30'
d fill-rect --x 3 --y 2 --width 10 --height 2 --color '#a07e52'
d set-pixel --x 9 --y 9 --color '#c9a24a'

# icons/build_floor.png — palette glyph: floor (#4a3f30 planks).
newsprite 16 16 "$A/icons/build_floor.png"
d fill-rect --x 2 --y 3 --width 12 --height 10 --color '#4a3f30'
d line --x0 2 --y0 8 --x1 13 --y1 8 --color '#5a4c3a'
d line --x0 7 --y0 3 --x1 7 --y1 8 --color '#5a4c3a'
d line --x0 10 --y0 8 --x1 10 --y1 12 --color '#5a4c3a'

# icons/build_bed.png — palette glyph: bed (#8a6a44 frame / #4f93c9 blanket).
newsprite 16 16 "$A/icons/build_bed.png"
d fill-rect --x 2 --y 4 --width 12 --height 8 --color '#8a6a44'
d fill-rect --x 4 --y 6 --width 8 --height 5 --color '#4f93c9'
d fill-rect --x 4 --y 5 --width 3 --height 3 --color '#cfe3f2'

# icons/build_stove.png — palette glyph: stove (#8a6a44 body / #ff5a52 fire).
newsprite 16 16 "$A/icons/build_stove.png"
d fill-rect --x 3 --y 4 --width 10 --height 9 --color '#8a6a44'
d fill-rect --x 3 --y 4 --width 10 --height 3 --color '#38332c'
d fill-rect --x 5 --y 9 --width 6 --height 3 --color '#ff5a52'
d fill-rect --x 6 --y 10 --width 4 --height 2 --color '#ffcf6a'

# icons/build_farm.png — palette glyph: farm plot (#5a4632 soil / #7cc45a crop).
newsprite 16 16 "$A/icons/build_farm.png"
d fill-rect --x 2 --y 4 --width 12 --height 9 --color '#5a4632'
d line --x0 2 --y0 7 --x1 13 --y1 7 --color '#4a3826'
d line --x0 2 --y0 11 --x1 13 --y1 11 --color '#4a3826'
for x in 4 8 12; do d set-pixel --x "$x" --y 6 --color '#7cc45a'; d set-pixel --x "$x" --y 10 --color '#7cc45a'; done
d set-pixel --x 4 --y 5 --color '#8fd66a'

# icons/build_turret.png — palette glyph: turret (#8a6a44 base / #c9a24a trim).
newsprite 16 16 "$A/icons/build_turret.png"
d fill-circle --cx 8 --cy 9 --r 5 --color '#8a6a44'
d stroke-circle --cx 8 --cy 9 --r 5 --color '#c9a24a'
d fill-circle --cx 8 --cy 9 --r 2 --color '#c9a24a'
d fill-rect --x 8 --y 7 --width 7 --height 3 --color '#38332c'

echo "produced Holdfast draw sprites under $A/{terrain,nodes,structures,items,icons}"
