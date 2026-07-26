#!/usr/bin/env bash
# Locomotivation — produce the YARD TILESET with the on-PATH `draw` tool
# (specs/assets.md §3, specs/world.md "Tile kinds", ASSET-MANIFEST.md §3).
#
# Every tile is 40x40 (the world grid — specs/world.md), authored to tile without an
# obvious single-texture repeat: ground ships THREE interchangeable variants and the
# gap/water ships two, so a field of the same kind does not visibly loop. Colours are
# the canonical palette in specs/overview.md. This script produces ONLY the tiles:
#
#   ground-0/1/2  — gravel yard floor (0,1) + gravel-with-grass accent (2)
#   track-h       — horizontal rail lane: ballast + timber sleepers + steel rails
#   bridge-h      — timber bridge deck (a crossing) with rails over the planks
#   refuge        — a clearly-marked safe pocket / platform
#   gap-0/1       — impassable water/void (two shimmer variants)
#   wall          — a ¾ building/scenery side body (impassable)
#   roof          — a ¾ building roof top for wall footprints
#
# The worker/trains/cargo/elements/fx/audio are produced by their own gen scripts.
# The build is SELF-CONTAINED: it loads these committed PNGs and never runs the tools.
# Re-run this once to regenerate. The tools' scratch (action logs / previews) goes to a
# temp dir and is never committed; only the finished PNGs under assets/tiles/ are kept.
#
# Usage:  bash scripts/gen-tiles.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tool: prefer PATH, else the cargo target release dir. -----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw >/dev/null 2>&1 || { echo "draw not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILES="$ROOT/assets/tiles"
mkdir -p "$TILES"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsprite <w> <h> <out.png> : a fresh transparent canvas that renders to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# ================================================================================
# GROUND — gravel yard floor (opaque, tileable). Base #6b6357 with darker clumps and
# lighter grit; variant 2 mixes in a grass patch (#5f7048). Three variants so a wide
# floor does not visibly repeat; the renderer picks one per cell by a stable hash.
# ================================================================================
ground_base() {           # $1 out   $2 gravel-fill   $3 dark   $4 grit-light
  newsprite 40 40 "$1"
  d fill-background --color "$2"
}

# scatter darker clumps + lighter grit at a variant-specific layout
ground_0() {
  ground_base "$1" '#6b6357' '#585044' '#7d7568'
  d fill-circle --cx 9  --cy 11 --r 4 --color '#585044'
  d fill-circle --cx 28 --cy 8  --r 3 --color '#585044'
  d fill-circle --cx 31 --cy 27 --r 5 --color '#524a3f'
  d fill-circle --cx 13 --cy 30 --r 4 --color '#585044'
  d fill-circle --cx 22 --cy 19 --r 2 --color '#4f473c'
  d fill-circle --cx 33 --cy 30 --r 2 --color '#4f473c'
  # lighter grit specks
  d set-pixel --x 6  --y 20 --color '#7d7568'; d set-pixel --x 7  --y 21 --color '#8a8175'
  d set-pixel --x 18 --y 6  --color '#7d7568'; d set-pixel --x 25 --y 14 --color '#8a8175'
  d set-pixel --x 15 --y 24 --color '#7d7568'; d set-pixel --x 36 --y 17 --color '#8a8175'
  d set-pixel --x 11 --y 36 --color '#7d7568'; d set-pixel --x 30 --y 36 --color '#8a8175'
  d set-pixel --x 20 --y 33 --color '#7d7568'; d set-pixel --x 3  --y 6  --color '#8a8175'
  d set-pixel --x 26 --y 22 --color '#4f473c'; d set-pixel --x 9  --y 25 --color '#4f473c'
}

ground_1() {
  ground_base "$1" '#6b6357' '#585044' '#7d7568'
  d fill-circle --cx 30 --cy 12 --r 5 --color '#585044'
  d fill-circle --cx 10 --cy 20 --r 4 --color '#524a3f'
  d fill-circle --cx 20 --cy 32 --r 4 --color '#585044'
  d fill-circle --cx 8  --cy 34 --r 2 --color '#4f473c'
  d fill-circle --cx 24 --cy 7  --r 2 --color '#585044'
  d fill-circle --cx 35 --cy 26 --r 3 --color '#524a3f'
  d set-pixel --x 14 --y 9  --color '#7d7568'; d set-pixel --x 15 --y 8  --color '#8a8175'
  d set-pixel --x 27 --y 21 --color '#7d7568'; d set-pixel --x 4  --y 14 --color '#8a8175'
  d set-pixel --x 33 --y 34 --color '#7d7568'; d set-pixel --x 19 --y 17 --color '#8a8175'
  d set-pixel --x 6  --y 28 --color '#7d7568'; d set-pixel --x 37 --y 8  --color '#8a8175'
  d set-pixel --x 23 --y 27 --color '#7d7568'; d set-pixel --x 12 --y 15 --color '#4f473c'
  d set-pixel --x 29 --y 30 --color '#4f473c'; d set-pixel --x 17 --y 37 --color '#8a8175'
}

# variant 2 — gravel with a grass patch encroaching from a corner
ground_2() {
  ground_base "$1" '#6b6357' '#585044' '#7d7568'
  # grass clump bottom-left, irregular
  d fill-circle --cx 6  --cy 33 --r 8 --color '#5f7048'
  d fill-circle --cx 14 --cy 36 --r 6 --color '#5f7048'
  d fill-circle --cx 3  --cy 25 --r 4 --color '#5f7048'
  d fill-circle --cx 18 --cy 31 --r 3 --color '#4e5d3b'
  # a few grass tufts / blades (lighter green)
  d line --x0 5  --y0 30 --x1 5  --y1 26 --color '#6d8052'
  d line --x0 9  --y0 34 --x1 9  --y1 29 --color '#6d8052'
  d line --x0 13 --y0 37 --x1 13 --y1 32 --color '#6d8052'
  d set-pixel --x 7 --y 27 --color '#6d8052'; d set-pixel --x 11 --y 31 --color '#4e5d3b'
  # gravel clumps on the dry side
  d fill-circle --cx 29 --cy 11 --r 5 --color '#585044'
  d fill-circle --cx 33 --cy 25 --r 4 --color '#524a3f'
  d fill-circle --cx 22 --cy 16 --r 2 --color '#4f473c'
  d set-pixel --x 26 --y 6  --color '#7d7568'; d set-pixel --x 34 --y 14 --color '#8a8175'
  d set-pixel --x 20 --y 8  --color '#7d7568'; d set-pixel --x 30 --y 33 --color '#8a8175'
  d set-pixel --x 24 --y 23 --color '#7d7568'; d set-pixel --x 37 --y 30 --color '#8a8175'
}

# ================================================================================
# TRACK (horizontal) — ballast bed + vertical timber sleepers + two steel rails.
# Sleepers repeat with period 10 (x = 2,12,22,32; width 5) so tiles seam across a
# lane; rails run the full width and continue tile-to-tile. Reads as a LIVE rail lane.
# ================================================================================
track_h() {
  newsprite 40 40 "$1"
  d fill-background --color '#463d34'                       # ballast bed
  # ballast stone flecks (both lighter and darker) so the bed reads as crushed stone
  for xy in "5 6" "17 4" "27 7" "37 9" "8 34" "21 36" "33 33" "3 20" "39 22"; do
    set -- $xy; d set-pixel --x "$1" --y "$2" --color '#554a3e'
  done
  for xy in "12 8" "24 34" "35 5" "2 32" "30 20" "9 3"; do
    set -- $xy; d set-pixel --x "$1" --y "$2" --color '#3a332b'
  done
  # timber sleepers (vertical bars, full height) — period 10, so they tile
  for sx in 2 12 22 32; do
    d fill-rect --x "$sx" --y 0 --width 5 --height 40 --color '#3c2f26'
    d fill-rect --x "$sx" --y 0 --width 1 --height 40 --color '#4a3a2d'   # lit left edge
    d fill-rect --x $((sx+4)) --y 0 --width 1 --height 40 --color '#2f251e' # shadowed right edge
    # grain nicks
    d set-pixel --x $((sx+2)) --y 7  --color '#2f251e'
    d set-pixel --x $((sx+2)) --y 24 --color '#2f251e'
    d set-pixel --x $((sx+1)) --y 33 --color '#4a3a2d'
  done
  # two steel rails (horizontal), drawn OVER the sleepers with a top highlight + shadow
  for ry in 12 26; do
    d fill-rect --x 0 --y "$ry" --width 40 --height 4 --color '#8f949c'   # rail body/shadow
    d fill-rect --x 0 --y "$ry" --width 40 --height 2 --color '#b9bec6'   # rail crown
    d fill-rect --x 0 --y "$ry" --width 40 --height 1 --color '#d6dae0'   # bright top glint
  done
}

# ================================================================================
# BRIDGE (horizontal) — timber deck over the gap (a crossing). Planked deck (#6a4a33)
# with horizontal plank seams and heavy edge beams top & bottom, rails over the planks
# in the same gauge as track-h. Must read as an obvious walkway across water.
# ================================================================================
bridge_h() {
  newsprite 40 40 "$1"
  d fill-background --color '#6a4a33'                       # timber deck
  # horizontal plank seams (darker grooves) every ~7px so boards read
  for py in 6 13 20 27 34; do
    d fill-rect --x 0 --y "$py" --width 40 --height 1 --color '#553b28'
  done
  # plank highlights just under each seam
  for py in 3 10 17 24 31; do
    d fill-rect --x 0 --y "$py" --width 40 --height 1 --color '#7d5940'
  done
  # heavy edge beams (top & bottom) — the bridge's structural rails
  d fill-rect --x 0 --y 0 --width 40 --height 3 --color '#4a3220'
  d fill-rect --x 0 --y 37 --width 40 --height 3 --color '#4a3220'
  d fill-rect --x 0 --y 0 --width 40 --height 1 --color '#8a6144'
  d fill-rect --x 0 --y 39 --width 40 --height 1 --color '#3a271a'
  # bolt heads along the beams (period 10 → seams)
  for bx in 4 14 24 34; do
    d set-pixel --x "$bx" --y 1  --color '#2f2015'
    d set-pixel --x "$bx" --y 38 --color '#2f2015'
  done
  # two steel rails over the deck (same gauge as track-h so a bridge continues a lane)
  for ry in 12 26; do
    d fill-rect --x 0 --y "$ry" --width 40 --height 4 --color '#8f949c'
    d fill-rect --x 0 --y "$ry" --width 40 --height 2 --color '#b9bec6'
    d fill-rect --x 0 --y "$ry" --width 40 --height 1 --color '#d6dae0'
  done
}

# ================================================================================
# REFUGE — a clearly-marked safe pocket / platform. A raised concrete pad (#8a8f98)
# with a darker inset border, corner bolts, a faint seam grid, and a caution-striped
# lip (worker-accent yellow) so it reads UNMISTAKABLY as a place to duck out of a lane.
# ================================================================================
refuge() {
  newsprite 40 40 "$1"
  d fill-background --color '#8a8f98'                       # platform slab
  # raised-edge shading: light top/left, dark bottom/right (¾ volume)
  d fill-rect --x 0 --y 0 --width 40 --height 2 --color '#a0a5ae'
  d fill-rect --x 0 --y 0 --width 2 --height 40 --color '#a0a5ae'
  d fill-rect --x 0 --y 38 --width 40 --height 2 --color '#70757e'
  d fill-rect --x 38 --y 0 --width 2 --height 40 --color '#70757e'
  # inset border groove
  d stroke-rect --x 4 --y 4 --width 32 --height 32 --color '#70757e'
  d stroke-rect --x 5 --y 5 --width 30 --height 30 --color '#9aa0a8'
  # faint expansion-joint cross
  d line --x0 20 --y0 6 --x1 20 --y1 34 --color '#7c828b'
  d line --x0 6  --y0 20 --x1 34 --y1 20 --color '#7c828b'
  # corner anchor bolts
  for xy in "8 8" "32 8" "8 32" "32 32"; do
    set -- $xy; d fill-circle --cx "$1" --cy "$2" --r 1 --color '#5c616a'
  done
  # caution-stripe lip across the top (safe-zone marking)
  for sx in 6 12 18 24 30; do
    d line --x0 "$sx" --y0 2 --x1 $((sx+3)) --y1 2 --color '#ffd23a'
  done
}

# ================================================================================
# GAP — impassable water/void (#24384a). Darker depths + lighter ripple crests so it
# reads unmistakably as NOT walkable. Two variants for shimmer variety (the renderer
# alternates them so a wide channel doesn't repeat one ripple).
# ================================================================================
gap_0() {
  newsprite 40 40 "$1"
  d fill-background --color '#24384a'
  # deep pools (darker)
  d fill-circle --cx 12 --cy 14 --r 7 --color '#1b2c3b'
  d fill-circle --cx 30 --cy 28 --r 8 --color '#1b2c3b'
  # ripple crests (staggered horizontal dashes, lighter)
  d line --x0 3  --y0 8  --x1 11 --y1 8  --color '#365068'
  d line --x0 20 --y0 12 --x1 28 --y1 12 --color '#365068'
  d line --x0 8  --y0 22 --x1 15 --y1 22 --color '#365068'
  d line --x0 24 --y0 20 --x1 33 --y1 20 --color '#47637d'
  d line --x0 14 --y0 31 --x1 22 --y1 31 --color '#365068'
  d line --x0 30 --y0 35 --x1 37 --y1 35 --color '#47637d'
  d line --x0 5  --y0 34 --x1 10 --y1 34 --color '#365068'
  # sparkle highlights
  d set-pixel --x 22 --y 12 --color '#5f7d97'; d set-pixel --x 9 --y 8 --color '#5f7d97'
  d set-pixel --x 33 --y 20 --color '#5f7d97'; d set-pixel --x 18 --y 31 --color '#5f7d97'
}

gap_1() {
  newsprite 40 40 "$1"
  d fill-background --color '#24384a'
  d fill-circle --cx 28 --cy 12 --r 8 --color '#1b2c3b'
  d fill-circle --cx 11 --cy 30 --r 7 --color '#1b2c3b'
  d line --x0 6  --y0 6  --x1 14 --y1 6  --color '#365068'
  d line --x0 22 --y0 9  --x1 31 --y1 9  --color '#47637d'
  d line --x0 3  --y0 18 --x1 10 --y1 18 --color '#365068'
  d line --x0 26 --y0 24 --x1 34 --y1 24 --color '#365068'
  d line --x0 15 --y0 26 --x1 23 --y1 26 --color '#47637d'
  d line --x0 30 --y0 33 --x1 37 --y1 33 --color '#365068'
  d line --x0 7  --y0 37 --x1 15 --y1 37 --color '#365068'
  d set-pixel --x 30 --y 9  --color '#5f7d97'; d set-pixel --x 8 --y 18 --color '#5f7d97'
  d set-pixel --x 21 --y 26 --color '#5f7d97'; d set-pixel --x 34 --y 33 --color '#5f7d97'
}

# ================================================================================
# WALL — a ¾ building/scenery SIDE body (impassable). Corrugated steel siding: a dark
# base (#3a3f47) with alternating lit/shadow vertical ribs, a lit top cap and a heavy
# ground-shadow at the base so it reads as a standing wall footprint the worker bumps.
# ================================================================================
wall() {
  newsprite 40 40 "$1"
  d fill-background --color '#3a3f47'
  # corrugated vertical ribs — lit face + shadow groove, period 5 (seams across walls)
  for rx in 0 5 10 15 20 25 30 35; do
    d fill-rect --x "$rx" --y 0 --width 1 --height 40 --color '#474d56'   # rib highlight
    d fill-rect --x $((rx+3)) --y 0 --width 1 --height 40 --color '#2d323a' # rib shadow
  done
  # lit top cap + a couple of panel seams
  d fill-rect --x 0 --y 0 --width 40 --height 2 --color '#525863'
  d fill-rect --x 0 --y 20 --width 40 --height 1 --color '#2d323a'
  # rivet line along a mid seam
  for bx in 3 11 19 27 35; do d set-pixel --x "$bx" --y 20 --color '#565c66'; done
  # heavy contact shadow at the base
  d fill-rect --x 0 --y 37 --width 40 --height 3 --color '#23272d'
}

# ================================================================================
# ROOF — the ¾ TOP for a wall footprint (#4b525b). A lit ridge across the top, panel
# seams, and a darker eave at the bottom edge so a stacked wall+roof reads as a solid
# building volume from the ¾ camera.
# ================================================================================
roof() {
  newsprite 40 40 "$1"
  d fill-background --color '#4b525b'
  # sheet-metal panel seams (horizontal), lighter above / darker below each
  for py in 9 19 29; do
    d fill-rect --x 0 --y "$py" --width 40 --height 1 --color '#3e444c'
    d fill-rect --x 0 --y $((py+1)) --width 40 --height 1 --color '#59616b'
  done
  # lit ridge along the top edge, darker eave along the bottom
  d fill-rect --x 0 --y 0 --width 40 --height 2 --color '#626b76'
  d fill-rect --x 0 --y 38 --width 40 --height 2 --color '#363b42'
  # a few vent / bolt specks so the roof isn't flat
  for xy in "10 5" "26 14" "16 24" "32 33" "6 33"; do
    set -- $xy; d set-pixel --x "$1" --y "$2" --color '#59616b'
  done
  for xy in "22 6" "12 15" "30 25" "8 25"; do
    set -- $xy; d set-pixel --x "$1" --y "$2" --color '#3e444c'
  done
}

# --- produce every tile ----------------------------------------------------------
ground_0 "$TILES/ground-0.png"
ground_1 "$TILES/ground-1.png"
ground_2 "$TILES/ground-2.png"
track_h  "$TILES/track-h.png"
bridge_h "$TILES/bridge-h.png"
refuge   "$TILES/refuge.png"
gap_0    "$TILES/gap-0.png"
gap_1    "$TILES/gap-1.png"
wall     "$TILES/wall.png"
roof     "$TILES/roof.png"

echo "tiles written to $TILES:"
ls -1 "$TILES"
