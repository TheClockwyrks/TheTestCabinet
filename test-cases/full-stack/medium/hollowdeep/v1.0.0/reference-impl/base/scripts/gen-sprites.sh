#!/usr/bin/env bash
# Hollowdeep — produce the static pixel-art SPRITES with the on-PATH `draw` tool
# (specs/assets.md §Sprites, ASSETS.md §Sprites). Everything here is authored from
# drawing primitives (fill-rect / line / fill-circle / …) on small transparent
# straight-alpha canvases, in the exact palette from specs/overview.md.
#
# Produces, at the exact paths ASSETS.md lists (26 PNGs):
#   assets/tiles/     dirt ore rock bedrock open wall floor ladder wire   (9, 32x32)
#   assets/machines/  generator diffuser pump refinery farm farm_ripe     (6, 32x32)
#   assets/items/     ore material fungus                                 (3, 16x16)
#   assets/icons/     oxygen co2 power food alert dig cancel priority     (8, 16x16)
#
# (The delver animation sheets, gas/dust particle systems and audio are produced by
# the sibling generators — this one owns only the `draw` sprites.)
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
TILES="$ROOT/assets/tiles"
MACH="$ROOT/assets/machines"
ITEMS="$ROOT/assets/items"
ICONS="$ROOT/assets/icons"
mkdir -p "$TILES" "$MACH" "$ITEMS" "$ICONS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers ----------------------------------------------------
# newsprite <w> <h> <background> <out.png> : start a fresh canvas. Tiling world
# tiles get an opaque background so they sit flush against neighbors; overlays and
# icons use "transparent" straight alpha.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "%s", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$3" "$TMP/log.json" "$4" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }
# px <x> <y> <color> — a single pixel (grain/detail).
px() { d set-pixel --x "$1" --y "$2" --color "$3"; }

# ============================================================================
# TILES — 32x32
# ============================================================================

# --- dirt: packed earth, darker grain -----------------------------------------
newsprite 32 32 '#4a3524' "$TILES/dirt.png"
for xy in 3,4 6,9 10,3 14,11 19,5 24,8 28,3 5,17 11,20 17,15 22,22 27,18 \
          2,26 8,29 13,25 18,28 23,26 29,29 15,2 26,13 9,13 20,10; do
  IFS=, read -r x y <<<"$xy"
  d fill-rect --x "$x" --y "$y" --width 2 --height 2 --color '#3a2a1c'
done
for xy in 1,8 7,2 12,7 21,17 30,10 4,22 16,20 25,4 30,24 11,28; do
  IFS=, read -r x y <<<"$xy"; px "$x" "$y" '#573f2a'
done

# --- ore: dirt veined with mineral --------------------------------------------
newsprite 32 32 '#4a3524' "$TILES/ore.png"
for xy in 5,8 8,10 11,11; do IFS=, read -r x y <<<"$xy"; d fill-rect --x "$x" --y "$y" --width 2 --height 2 --color '#3a2a1c'; done
# a diagonal mineral vein of chunky nuggets
for cc in 6,7 9,10 13,12 16,15 20,17 24,20 27,23; do
  IFS=, read -r cx cy <<<"$cc"; d fill-circle --cx "$cx" --cy "$cy" --r 2 --color '#d9a441'
done
# a small offshoot vein
d fill-circle --cx 22 --cy 8 --r 2 --color '#d9a441'
d fill-circle --cx 25 --cy 11 --r 2 --color '#d9a441'
for gg in 9,9 16,14 24,19 22,7; do IFS=, read -r cx cy <<<"$gg"; d fill-circle --cx "$cx" --cy "$cy" --r 1 --color '#f0c86a'; done
px 8 8 '#f0c86a'; px 20 16 '#f0c86a'

# --- rock: dense stone with cracks --------------------------------------------
newsprite 32 32 '#2b2620' "$TILES/rock.png"
d line --x0 3 --y0 6 --x1 12 --y1 10 --color '#38322a'
d line --x0 12 --y0 10 --x1 10 --y1 20 --color '#38322a'
d line --x0 12 --y0 10 --x1 22 --y1 8 --color '#38322a'
d line --x0 22 --y0 8 --x1 28 --y1 14 --color '#38322a'
d line --x0 22 --y0 8 --x1 25 --y1 2 --color '#38322a'
d line --x0 10 --y0 20 --x1 18 --y1 27 --color '#38322a'
d line --x0 18 --y0 27 --x1 28 --y1 24 --color '#38322a'
d line --x0 10 --y0 20 --x1 2 --y1 25 --color '#38322a'
px 6 15 '#38322a'; px 19 17 '#38322a'; px 27 20 '#38322a'; px 14 4 '#38322a'

# --- bedrock: indestructible world-seal border --------------------------------
newsprite 32 32 '#201c17' "$TILES/bedrock.png"
d fill-rect --x 0 --y 0 --width 32 --height 3 --color '#2b2620'
d fill-rect --x 0 --y 29 --width 32 --height 3 --color '#2b2620'
d fill-rect --x 0 --y 0 --width 3 --height 32 --color '#2b2620'
d fill-rect --x 29 --y 0 --width 3 --height 32 --color '#2b2620'
# chevron seam pointing inward, top and bottom
for x in 4 12 20 28; do
  d line --x0 "$x" --y0 4 --x1 $((x+4)) --y1 8 --color '#2b2620'
  d line --x0 $((x+4)) --y0 8 --x1 $((x+8)) --y1 4 --color '#2b2620'
  d line --x0 "$x" --y0 27 --x1 $((x+4)) --y1 23 --color '#2b2620'
  d line --x0 $((x+4)) --y0 23 --x1 $((x+8)) --y1 27 --color '#2b2620'
done

# --- open: dug/hollow backing wall (a lit interior, not a hole) ----------------
newsprite 32 32 '#191410' "$TILES/open.png"
d fill-rect --x 3 --y 3 --width 26 --height 26 --color '#221a12'
d fill-rect --x 3 --y 3 --width 26 --height 1 --color '#2a2016'
d fill-rect --x 3 --y 3 --width 1 --height 26 --color '#2a2016'
# corner darkening → vignette
px 3 3 '#191410'; px 28 3 '#191410'; px 3 28 '#191410'; px 28 28 '#191410'
px 4 4 '#1d1712'; px 27 4 '#1d1712'; px 4 27 '#1d1712'; px 27 27 '#1d1712'

# --- wall: built wall (blocks gas) --------------------------------------------
newsprite 32 32 '#566073' "$TILES/wall.png"
d fill-rect --x 0 --y 0 --width 32 --height 2 --color '#6b7788'
d fill-rect --x 0 --y 0 --width 2 --height 32 --color '#6b7788'
d fill-rect --x 0 --y 30 --width 32 --height 2 --color '#3d4552'
d fill-rect --x 30 --y 0 --width 2 --height 32 --color '#3d4552'
# brick courses (offset)
d fill-rect --x 0 --y 15 --width 32 --height 2 --color '#3d4552'
d fill-rect --x 15 --y 2 --width 2 --height 13 --color '#3d4552'
d fill-rect --x 7 --y 17 --width 2 --height 13 --color '#3d4552'
d fill-rect --x 23 --y 17 --width 2 --height 13 --color '#3d4552'
px 2 3 '#6b7788'; px 18 18 '#6b7788'

# --- floor: walkable top plate (transparent below) ----------------------------
newsprite 32 32 'transparent' "$TILES/floor.png"
d fill-rect --x 0 --y 3 --width 32 --height 6 --color '#566073'
d fill-rect --x 0 --y 3 --width 32 --height 1 --color '#6b7788'
d fill-rect --x 0 --y 8 --width 32 --height 1 --color '#3d4552'
# support ticks
for x in 3 11 19 27; do d fill-rect --x "$x" --y 9 --width 2 --height 3 --color '#3d4552'; done

# --- ladder: climbable rungs (transparent) ------------------------------------
newsprite 32 32 'transparent' "$TILES/ladder.png"
d fill-rect --x 8 --y 0 --width 3 --height 32 --color '#c9862f'
d fill-rect --x 21 --y 0 --width 3 --height 32 --color '#c9862f'
d fill-rect --x 8 --y 0 --width 1 --height 32 --color '#e0a24a'
d fill-rect --x 21 --y 0 --width 1 --height 32 --color '#e0a24a'
for y in 2 8 14 20 26; do
  d fill-rect --x 8 --y "$y" --width 16 --height 2 --color '#c9862f'
  d fill-rect --x 8 --y "$y" --width 16 --height 1 --color '#e0a24a'
done

# --- wire: power conduit (transparent, doesn't block gas) ---------------------
newsprite 32 32 'transparent' "$TILES/wire.png"
d fill-rect --x 0 --y 14 --width 32 --height 4 --color '#c9862f'
d fill-rect --x 0 --y 14 --width 32 --height 1 --color '#e0a24a'
d fill-circle --cx 16 --cy 16 --r 4 --color '#c9862f'
d fill-circle --cx 16 --cy 16 --r 3 --color '#ffcb52'
d fill-circle --cx 16 --cy 16 --r 1 --color '#fff0c0'

# ============================================================================
# MACHINES — 32x32
# ============================================================================

# --- generator: coal/fuel generator (power supply) ----------------------------
newsprite 32 32 'transparent' "$MACH/generator.png"
d fill-rect --x 4 --y 8 --width 24 --height 22 --color '#566073'
d fill-rect --x 4 --y 8 --width 24 --height 2 --color '#6b7788'
d fill-rect --x 4 --y 28 --width 24 --height 2 --color '#3d4552'
d fill-rect --x 26 --y 8 --width 2 --height 22 --color '#3d4552'
# dark fuel hopper on top
d fill-rect --x 9 --y 3 --width 14 --height 6 --color '#2b2620'
d fill-rect --x 11 --y 1 --width 10 --height 3 --color '#2b2620'
# ember firebox glow
d fill-rect --x 9 --y 18 --width 14 --height 8 --color '#3d4552'
d fill-rect --x 11 --y 20 --width 10 --height 5 --color '#ffcb52'
d fill-rect --x 13 --y 21 --width 6 --height 3 --color '#fff0c0'
px 8 12 '#6b7788'; px 24 12 '#6b7788'

# --- diffuser: oxygen diffuser (emits O2 while powered) ------------------------
newsprite 32 32 'transparent' "$MACH/diffuser.png"
d fill-rect --x 6 --y 12 --width 20 --height 18 --color '#566073'
d fill-rect --x 6 --y 12 --width 20 --height 2 --color '#6b7788'
d fill-rect --x 6 --y 28 --width 20 --height 2 --color '#3d4552'
# emitter head with cyan vents
d fill-rect --x 9 --y 4 --width 14 --height 8 --color '#3d4552'
for x in 11 15 19; do d fill-rect --x "$x" --y 5 --width 2 --height 6 --color '#47e0c8'; done
d fill-rect --x 10 --y 16 --width 12 --height 4 --color '#47e0c8'
d fill-rect --x 10 --y 16 --width 12 --height 1 --color '#eaf7f3'
px 13 6 '#eaf7f3'; px 20 6 '#eaf7f3'

# --- pump: gas pump (moves gas intake→output) ---------------------------------
newsprite 32 32 'transparent' "$MACH/pump.png"
d fill-rect --x 7 --y 9 --width 18 --height 20 --color '#566073'
d fill-rect --x 7 --y 9 --width 18 --height 2 --color '#6b7788'
d fill-rect --x 7 --y 27 --width 18 --height 2 --color '#3d4552'
# ducts on both sides
d fill-rect --x 2 --y 13 --width 5 --height 4 --color '#c9862f'
d fill-rect --x 25 --y 13 --width 5 --height 4 --color '#c9862f'
d fill-rect --x 2 --y 13 --width 5 --height 1 --color '#e0a24a'
d fill-rect --x 25 --y 13 --width 5 --height 1 --color '#e0a24a'
# round intake impeller
d fill-circle --cx 16 --cy 19 --r 6 --color '#a89e8d'
d fill-circle --cx 16 --cy 19 --r 4 --color '#3d4552'
d line --x0 16 --y0 15 --x1 16 --y1 23 --color '#a89e8d'
d line --x0 12 --y0 19 --x1 20 --y1 19 --color '#a89e8d'
px 16 19 '#eaf7f3'

# --- refinery: operated ore refinery (ore→material) ---------------------------
newsprite 32 32 'transparent' "$MACH/refinery.png"
d fill-rect --x 4 --y 9 --width 24 --height 21 --color '#566073'
d fill-rect --x 4 --y 9 --width 24 --height 2 --color '#6b7788'
d fill-rect --x 4 --y 28 --width 24 --height 2 --color '#3d4552'
d fill-rect --x 26 --y 9 --width 2 --height 21 --color '#3d4552'
# chimney
d fill-rect --x 20 --y 3 --width 5 --height 7 --color '#3d4552'
# crucible window with molten glow + hot core
d fill-rect --x 8 --y 15 --width 12 --height 11 --color '#2b2620'
d fill-rect --x 10 --y 17 --width 8 --height 7 --color '#d9a441'
d fill-rect --x 12 --y 19 --width 4 --height 4 --color '#ff5a52'
d fill-rect --x 13 --y 20 --width 2 --height 2 --color '#ffcb52'
px 8 13 '#6b7788'

# --- farm: planted fungus farm (growing) --------------------------------------
newsprite 32 32 'transparent' "$MACH/farm.png"
d fill-rect --x 2 --y 20 --width 28 --height 10 --color '#2b2620'
d fill-rect --x 2 --y 20 --width 28 --height 1 --color '#38322a'
# young caps sprouting from the bed
for cx in 7 13 19 25; do
  d fill-rect --x $((cx-1)) --y 17 --width 2 --height 4 --color '#5aa83e'
  d fill-circle --cx "$cx" --cy 16 --r 2 --color '#7cd45a'
done
px 7 15 '#a6e87a'; px 19 15 '#a6e87a'

# --- farm_ripe: harvestable variant -------------------------------------------
newsprite 32 32 'transparent' "$MACH/farm_ripe.png"
d fill-rect --x 2 --y 20 --width 28 --height 10 --color '#2b2620'
d fill-rect --x 2 --y 20 --width 28 --height 1 --color '#38322a'
for cx in 7 13 19 25; do
  d fill-rect --x $((cx-1)) --y 15 --width 2 --height 6 --color '#5aa83e'
  d fill-circle --cx "$cx" --cy 13 --r 3 --color '#a6e87a'
  d fill-circle --cx "$cx" --cy 13 --r 1 --color '#7cd45a'
done
# spore glow drifting up
for xy in 5,9 15,7 23,10 11,8 27,7; do IFS=, read -r x y <<<"$xy"; px "$x" "$y" '#c9862f'; done

# ============================================================================
# ITEMS — 16x16 stock icons
# ============================================================================

# --- ore chunk ----------------------------------------------------------------
newsprite 16 16 'transparent' "$ITEMS/ore.png"
d fill-circle --cx 8 --cy 9 --r 5 --color '#8a6420'
d fill-circle --cx 8 --cy 8 --r 5 --color '#d9a441'
d fill-rect --x 4 --y 11 --width 9 --height 2 --color '#8a6420'
d fill-circle --cx 6 --cy 6 --r 2 --color '#f0c86a'
px 10 5 '#f0c86a'; px 11 9 '#8a6420'

# --- refined material block ---------------------------------------------------
newsprite 16 16 'transparent' "$ITEMS/material.png"
d fill-rect --x 3 --y 5 --width 10 --height 8 --color '#566073'
d fill-rect --x 3 --y 4 --width 10 --height 2 --color '#6b7788'
d fill-rect --x 3 --y 11 --width 10 --height 2 --color '#3d4552'
d fill-rect --x 11 --y 5 --width 2 --height 8 --color '#3d4552'
d line --x0 3 --y0 4 --x1 6 --y1 2 --color '#6b7788'
d line --x0 6 --y0 2 --x1 13 --y1 2 --color '#6b7788'
d line --x0 13 --y0 2 --x1 13 --y1 4 --color '#6b7788'
px 5 6 '#8f9db0'

# --- fungus/food --------------------------------------------------------------
newsprite 16 16 'transparent' "$ITEMS/fungus.png"
d fill-rect --x 6 --y 8 --width 4 --height 6 --color '#5aa83e'
d fill-circle --cx 8 --cy 7 --r 5 --color '#7cd45a'
d fill-rect --x 3 --y 8 --width 10 --height 2 --color '#7cd45a'
d fill-rect --x 3 --y 10 --width 10 --height 1 --color '#5aa83e'
px 6 4 '#a6e87a'; px 10 5 '#a6e87a'

# ============================================================================
# ICONS — 16x16 HUD & tool glyphs
# ============================================================================

# --- oxygen: rising bubble + up arrow -----------------------------------------
newsprite 16 16 'transparent' "$ICONS/oxygen.png"
d line --x0 8 --y0 1 --x1 3 --y1 6 --color '#47e0c8'
d line --x0 8 --y0 1 --x1 13 --y1 6 --color '#47e0c8'
d line --x0 8 --y0 2 --x1 4 --y1 6 --color '#47e0c8'
d line --x0 8 --y0 2 --x1 12 --y1 6 --color '#47e0c8'
d fill-rect --x 7 --y 3 --width 2 --height 6 --color '#47e0c8'
d fill-circle --cx 8 --cy 12 --r 3 --color '#47e0c8'
d fill-circle --cx 8 --cy 12 --r 1 --color '#a6f0e4'
px 7 4 '#a6f0e4'

# --- co2: settling molecule (low) ---------------------------------------------
newsprite 16 16 'transparent' "$ICONS/co2.png"
d fill-circle --cx 8 --cy 6 --r 3 --color '#b6c24a'
d fill-circle --cx 4 --cy 10 --r 2 --color '#b6c24a'
d fill-circle --cx 12 --cy 10 --r 2 --color '#b6c24a'
d line --x0 6 --y0 8 --x1 5 --y1 9 --color '#8f9a30'
d line --x0 10 --y0 8 --x1 11 --y1 9 --color '#8f9a30'
px 7 5 '#d0d97a'; px 4 9 '#d0d97a'; px 12 9 '#d0d97a'
# settle hint: base shadow
d fill-rect --x 3 --y 13 --width 10 --height 1 --color '#8f9a30'

# --- power: lightning bolt ----------------------------------------------------
newsprite 16 16 'transparent' "$ICONS/power.png"
d fill-rect --x 8 --y 1 --width 3 --height 3 --color '#ffcb52'
d fill-rect --x 7 --y 4 --width 3 --height 2 --color '#ffcb52'
d fill-rect --x 6 --y 6 --width 3 --height 2 --color '#ffcb52'
d fill-rect --x 5 --y 7 --width 6 --height 2 --color '#ffcb52'
d fill-rect --x 7 --y 9 --width 3 --height 2 --color '#ffcb52'
d fill-rect --x 6 --y 11 --width 3 --height 2 --color '#ffcb52'
d fill-rect --x 5 --y 13 --width 3 --height 2 --color '#ffcb52'
px 9 2 '#fff0c0'; px 7 7 '#fff0c0'; px 6 12 '#fff0c0'

# --- food: fungus cap glyph ---------------------------------------------------
newsprite 16 16 'transparent' "$ICONS/food.png"
d fill-rect --x 6 --y 9 --width 4 --height 5 --color '#5aa83e'
d fill-circle --cx 8 --cy 8 --r 5 --color '#7cd45a'
d fill-rect --x 3 --y 9 --width 10 --height 1 --color '#5aa83e'
px 6 5 '#a6e87a'; px 10 6 '#a6e87a'; px 8 4 '#a6e87a'

# --- alert: warning triangle + bang -------------------------------------------
newsprite 16 16 'transparent' "$ICONS/alert.png"
declare -a HW=(0 0 1 1 2 2 3 4 4 5 6)   # half-width per row from apex (y=3) to base (y=13)
y=3
for hw in "${HW[@]}"; do
  d fill-rect --x $((8-hw)) --y "$y" --width $((2*hw+1)) --height 1 --color '#ff5a52'
  y=$((y+1))
done
d fill-rect --x 7 --y 6 --width 2 --height 4 --color '#12100c'
d fill-rect --x 7 --y 11 --width 2 --height 2 --color '#12100c'

# --- dig: pickaxe (pick head + handle) ----------------------------------------
newsprite 16 16 'transparent' "$ICONS/dig.png"
# arced steel pick head across the top
d line --x0 2 --y0 5 --x1 8 --y1 2 --color '#a89e8d'
d line --x0 8 --y0 2 --x1 14 --y1 5 --color '#a89e8d'
d line --x0 2 --y0 6 --x1 8 --y1 3 --color '#6b6355'
d line --x0 8 --y0 3 --x1 14 --y1 6 --color '#6b6355'
# wooden handle
d fill-rect --x 7 --y 3 --width 2 --height 11 --color '#c9862f'
d fill-rect --x 7 --y 3 --width 1 --height 11 --color '#e0a24a'
px 8 2 '#c9c3b6'

# --- cancel: crossed X --------------------------------------------------------
newsprite 16 16 'transparent' "$ICONS/cancel.png"
d line --x0 3 --y0 3 --x1 12 --y1 12 --color '#ff5a52'
d line --x0 4 --y0 3 --x1 13 --y1 12 --color '#ff5a52'
d line --x0 3 --y0 4 --x1 12 --y1 13 --color '#ff5a52'
d line --x0 12 --y0 3 --x1 3 --y1 12 --color '#ff5a52'
d line --x0 13 --y0 3 --x1 4 --y1 12 --color '#ff5a52'
d line --x0 12 --y0 4 --x1 3 --y1 13 --color '#ff5a52'
px 8 8 '#ff8a84'

# --- priority: double up-chevron ----------------------------------------------
newsprite 16 16 'transparent' "$ICONS/priority.png"
for oy in 0 5; do
  d line --x0 8 --y0 $((3+oy)) --x1 3 --y1 $((8+oy)) --color '#ffcb52'
  d line --x0 8 --y0 $((3+oy)) --x1 13 --y1 $((8+oy)) --color '#ffcb52'
  d line --x0 8 --y0 $((4+oy)) --x1 4 --y1 $((8+oy)) --color '#ffcb52'
  d line --x0 8 --y0 $((4+oy)) --x1 12 --y1 $((8+oy)) --color '#ffcb52'
done
px 8 3 '#fff0c0'; px 8 8 '#fff0c0'

echo "produced 26 sprites: 9 tiles, 6 machines, 3 items, 8 icons"
