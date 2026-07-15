#!/usr/bin/env bash
# Deepcore — produce the WORLD sprites with the on-PATH `draw` (+ `draw-sheet` for the
# lava shimmer) tools (specs/assets.md, "Environment sprites"; ASSET-LAYOUT.md). This
# script owns the environment the mine is built from — everything the vertical camera
# scrolls past as the miner digs down through the four depth bands (specs/world.md):
#
#   • the 48x48 band TILES the bands and their bounds are drawn from — THREE tileable
#     variants per band ("<band>-0/1/2.png") so a wall of the same band does not visibly
#     repeat one texture (topsoil earth, rockbed grey stone, deepstone near-black,
#     coreshell red-glowing; the renderer picks a variant per cell — specs/world.md),
#     plus the unminable BEDROCK border, the carved TUNNEL cell, and a TUNNEL-EDGE rubble
#     trim (specs/world.md tile kinds);
#   • the six 48x48 ORE VEINS (Ferron, Cuprite, Argenite, Voltite, Pyronium, Adamite)
#     as transparent overlays the renderer lays over the band rock — each an embedded
#     SMEAR spread through the dirt (not a discrete dot) that reads clearly as its ore by
#     colour and glint so a vein stands out from plain rock (specs/mining.md);
#   • the MATERIAL NODES — the Resonite (blue crystal) and Cryenite (violet crystal)
#     buried nodes, the glowing CORE in its chamber, and the extracted, unstable CORE
#     SAMPLE icon it yields (specs/mining.md, specs/hazards.md);
#   • the HAZARD tiles — the faintly glowing green GAS pocket (`draw`) and the looping
#     molten LAVA shimmer sheet (`draw-sheet`, one PNG per frame) (specs/hazards.md).
#
# Every colour matches the palette in specs/overview.md. The miner cycles, the surface
# buildings, the rocket stages, the HUD icons, the particle systems and the audio are
# produced by their own gen scripts; this one produces ONLY the world sprites above.
#
# The build itself is SELF-CONTAINED — it loads these committed PNGs and never invokes
# the tools. Re-run this once to regenerate them. The tools' scratch (the intermediate
# action logs and previews) is written to a temp dir and never committed; only the
# finished PNGs under assets/ are kept (.gitignore also drops any *.config.json /
# *.actions.json / *.preview.* left beside an asset).
#
# Usage:  bash scripts/gen-world.sh   (draw / draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tools: prefer PATH, else the cargo target release dir. ----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw       >/dev/null 2>&1 || { echo "draw not found on PATH"       >&2; exit 1; }
command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILES="$ROOT/assets/tiles"
ORE="$ROOT/assets/ore"
MAT="$ROOT/assets/materials"
HAZ="$ROOT/assets/hazards"
LAVA="$HAZ/lava"
mkdir -p "$TILES" "$ORE" "$MAT" "$HAZ" "$LAVA"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers (draw) -----------------------------------------------
# newsprite <w> <h> <out.png> : fresh transparent canvas that renders straight to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# --- sheet helpers (draw-sheet) --------------------------------------------------
# newsheet <w> <h> <framecount> <dir> : an N-frame cycle rendered to <dir>/frame{n}.png.
# (frames 0..N-1 render as frame0.png…; a rename pass below zero-pads to frame00.png…
#  so the engine's glob sorts them correctly, per ASSET-LAYOUT.md.)
newsheet() {
  local frames="" i
  for (( i=0; i<$3; i++ )); do frames+="${frames:+,}$i"; done
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [%s], "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$frames" "$TMP/f_{frame}.json" "$4/frame{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ================================================================================
# BAND ROCK TILES (48x48, tileable) — the depth must read at a glance (specs/world.md).
# Each band ships THREE interchangeable variants ("<band>-0/1/2.png") so a wall of the
# same band does NOT visibly repeat a single texture: the renderer picks a variant per
# cell by a stable hash of its (row, col) (specs/world.md, specs/assets.md). All three
# share the band's fill + palette so they read as the same depth; only the clump/crack/
# fleck layout differs. Each is a full opaque tile: flood the band fill, then texture the
# INTERIOR so neighbouring tiles still seam acceptably across the mine.
# ================================================================================

# -------- Topsoil (band 1) — warm brown earth, #3a2c1f -----------------------
# 3 variants: darker soil clumps + lighter grit/pebbles, laid out differently each.
band_topsoil() {
  newsprite 48 48 "$1"
  d fill-background --color '#3a2c1f'
  case "$2" in
    0)
      d fill-circle --cx 14 --cy 16 --r 6 --color '#2f2318'
      d fill-circle --cx 34 --cy 30 --r 7 --color '#2f2318'
      d fill-circle --cx 34 --cy 30 --r 3 --color '#241a11'
      d fill-circle --cx 24 --cy 40 --r 5 --color '#2f2318'
      d fill-circle --cx 10 --cy 36 --r 3 --color '#241a11'
      d fill-circle --cx 20 --cy 12 --r 2 --color '#4a3a28'
      d fill-circle --cx 38 --cy 14 --r 2 --color '#574530'
      d fill-circle --cx 30 --cy 22 --r 2 --color '#4a3a28'
      d set-pixel --x 16 --y 26 --color '#574530'
      d set-pixel --x 27 --y 33 --color '#4a3a28'
      d set-pixel --x 40 --y 38 --color '#574530'
      d set-pixel --x 12 --y 44 --color '#4a3a28'
      d set-pixel --x 8  --y 20 --color '#241a11'
      d set-pixel --x 44 --y 26 --color '#241a11'
      d set-pixel --x 22 --y 8  --color '#241a11'
      d set-pixel --x 33 --y 44 --color '#241a11'
      ;;
    1)
      d fill-circle --cx 32 --cy 14 --r 7 --color '#2f2318'
      d fill-circle --cx 12 --cy 28 --r 6 --color '#2f2318'
      d fill-circle --cx 12 --cy 28 --r 3 --color '#241a11'
      d fill-circle --cx 38 --cy 40 --r 5 --color '#2f2318'
      d fill-circle --cx 26 --cy 38 --r 3 --color '#241a11'
      d fill-circle --cx 40 --cy 22 --r 2 --color '#4a3a28'
      d fill-circle --cx 18 --cy 12 --r 2 --color '#574530'
      d fill-circle --cx 24 --cy 24 --r 2 --color '#4a3a28'
      d set-pixel --x 34 --y 30 --color '#574530'
      d set-pixel --x 20 --y 42 --color '#4a3a28'
      d set-pixel --x 8  --y 40 --color '#574530'
      d set-pixel --x 44 --y 34 --color '#4a3a28'
      d set-pixel --x 30 --y 8  --color '#241a11'
      d set-pixel --x 6  --y 16 --color '#241a11'
      d set-pixel --x 44 --y 12 --color '#241a11'
      d set-pixel --x 16 --y 44 --color '#241a11'
      ;;
    2)
      d fill-circle --cx 22 --cy 20 --r 8 --color '#2f2318'
      d fill-circle --cx 22 --cy 20 --r 4 --color '#241a11'
      d fill-circle --cx 40 --cy 32 --r 5 --color '#2f2318'
      d fill-circle --cx 10 --cy 42 --r 4 --color '#2f2318'
      d fill-circle --cx 36 --cy 10 --r 3 --color '#241a11'
      d fill-circle --cx 14 --cy 10 --r 2 --color '#4a3a28'
      d fill-circle --cx 32 --cy 36 --r 2 --color '#574530'
      d fill-circle --cx 44 --cy 18 --r 2 --color '#4a3a28'
      d set-pixel --x 26 --y 30 --color '#574530'
      d set-pixel --x 18 --y 36 --color '#4a3a28'
      d set-pixel --x 8  --y 26 --color '#574530'
      d set-pixel --x 40 --y 44 --color '#4a3a28'
      d set-pixel --x 30 --y 44 --color '#241a11'
      d set-pixel --x 44 --y 40 --color '#241a11'
      d set-pixel --x 6  --y 8  --color '#241a11'
      d set-pixel --x 18 --y 24 --color '#574530'
      ;;
  esac
}
band_topsoil "$TILES/topsoil-0.png" 0
band_topsoil "$TILES/topsoil-1.png" 1
band_topsoil "$TILES/topsoil-2.png" 2

# -------- Rockbed (band 2) — grey stone, #3a3d44 -----------------------------
# 3 variants: angular dark cracks + lighter facets catching the lamp, re-routed each.
band_rockbed() {
  newsprite 48 48 "$1"
  d fill-background --color '#3a3d44'
  case "$2" in
    0)
      d line --x0 8  --y0 6  --x1 20 --y1 18 --color '#2a2d33'
      d line --x0 20 --y0 18 --x1 16 --y1 34 --color '#2a2d33'
      d line --x0 30 --y0 8  --x1 38 --y1 22 --color '#23262c'
      d line --x0 38 --y0 22 --x1 42 --y1 40 --color '#2a2d33'
      d line --x0 22 --y0 30 --x1 34 --y1 42 --color '#23262c'
      d line --x0 6  --y0 40 --x1 18 --y1 38 --color '#2a2d33'
      d fill-circle --cx 26 --cy 14 --r 4 --color '#464b53'
      d fill-circle --cx 12 --cy 24 --r 3 --color '#464b53'
      d fill-circle --cx 40 --cy 30 --r 3 --color '#545a63'
      d set-pixel --x 30 --y 26 --color '#545a63'
      d set-pixel --x 18 --y 42 --color '#545a63'
      d set-pixel --x 44 --y 12 --color '#464b53'
      d set-pixel --x 24 --y 44 --color '#2a2d33'
      ;;
    1)
      d line --x0 40 --y0 6  --x1 28 --y1 18 --color '#2a2d33'
      d line --x0 28 --y0 18 --x1 32 --y1 34 --color '#2a2d33'
      d line --x0 18 --y0 8  --x1 10 --y1 22 --color '#23262c'
      d line --x0 10 --y0 22 --x1 6  --y1 40 --color '#2a2d33'
      d line --x0 26 --y0 30 --x1 14 --y1 42 --color '#23262c'
      d line --x0 42 --y0 40 --x1 30 --y1 38 --color '#2a2d33'
      d fill-circle --cx 22 --cy 14 --r 4 --color '#464b53'
      d fill-circle --cx 36 --cy 24 --r 3 --color '#464b53'
      d fill-circle --cx 8  --cy 30 --r 3 --color '#545a63'
      d set-pixel --x 18 --y 26 --color '#545a63'
      d set-pixel --x 30 --y 42 --color '#545a63'
      d set-pixel --x 4  --y 12 --color '#464b53'
      d set-pixel --x 24 --y 44 --color '#2a2d33'
      ;;
    2)
      d line --x0 6  --y0 14 --x1 22 --y1 12 --color '#2a2d33'
      d line --x0 22 --y0 12 --x1 40 --y1 18 --color '#23262c'
      d line --x0 14 --y0 24 --x1 26 --y1 30 --color '#2a2d33'
      d line --x0 26 --y0 30 --x1 20 --y1 44 --color '#23262c'
      d line --x0 34 --y0 28 --x1 44 --y1 36 --color '#2a2d33'
      d line --x0 8  --y0 36 --x1 16 --y1 44 --color '#2a2d33'
      d fill-circle --cx 34 --cy 12 --r 4 --color '#464b53'
      d fill-circle --cx 16 --cy 34 --r 3 --color '#464b53'
      d fill-circle --cx 40 --cy 42 --r 3 --color '#545a63'
      d set-pixel --x 24 --y 20 --color '#545a63'
      d set-pixel --x 10 --y 42 --color '#545a63'
      d set-pixel --x 42 --y 24 --color '#464b53'
      d set-pixel --x 30 --y 40 --color '#2a2d33'
      ;;
  esac
}
band_rockbed "$TILES/rockbed-0.png" 0
band_rockbed "$TILES/rockbed-1.png" 1
band_rockbed "$TILES/rockbed-2.png" 2

# -------- Deepstone (band 3) — near-black rock, #20242c ----------------------
# 3 variants: tight dark fractures + sparse cold highlights (band reads dark).
band_deepstone() {
  newsprite 48 48 "$1"
  d fill-background --color '#20242c'
  case "$2" in
    0)
      d line --x0 10 --y0 8  --x1 22 --y1 20 --color '#14171d'
      d line --x0 22 --y0 20 --x1 20 --y1 36 --color '#14171d'
      d line --x0 32 --y0 10 --x1 40 --y1 26 --color '#0e1015'
      d line --x0 12 --y0 40 --x1 30 --y1 38 --color '#14171d'
      d line --x0 38 --y0 30 --x1 36 --y1 44 --color '#0e1015'
      d fill-circle --cx 28 --cy 16 --r 2 --color '#2c313a'
      d set-pixel --x 14 --y 28 --color '#2c313a'
      d set-pixel --x 40 --y 20 --color '#2c313a'
      d set-pixel --x 24 --y 42 --color '#2c313a'
      d set-pixel --x 8  --y 16 --color '#0e1015'
      d set-pixel --x 44 --y 40 --color '#0e1015'
      ;;
    1)
      d line --x0 38 --y0 8  --x1 26 --y1 20 --color '#14171d'
      d line --x0 26 --y0 20 --x1 28 --y1 36 --color '#14171d'
      d line --x0 16 --y0 10 --x1 8  --y1 26 --color '#0e1015'
      d line --x0 36 --y0 40 --x1 18 --y1 38 --color '#14171d'
      d line --x0 10 --y0 30 --x1 12 --y1 44 --color '#0e1015'
      d fill-circle --cx 20 --cy 16 --r 2 --color '#2c313a'
      d set-pixel --x 34 --y 28 --color '#2c313a'
      d set-pixel --x 8  --y 20 --color '#2c313a'
      d set-pixel --x 24 --y 42 --color '#2c313a'
      d set-pixel --x 40 --y 16 --color '#0e1015'
      d set-pixel --x 6  --y 40 --color '#0e1015'
      ;;
    2)
      d line --x0 8  --y0 12 --x1 24 --y1 16 --color '#14171d'
      d line --x0 24 --y0 16 --x1 22 --y1 34 --color '#14171d'
      d line --x0 30 --y0 12 --x1 42 --y1 22 --color '#0e1015'
      d line --x0 14 --y0 38 --x1 32 --y1 40 --color '#14171d'
      d line --x0 40 --y0 32 --x1 44 --y1 44 --color '#0e1015'
      d fill-circle --cx 34 --cy 26 --r 2 --color '#2c313a'
      d set-pixel --x 18 --y 24 --color '#2c313a'
      d set-pixel --x 12 --y 40 --color '#2c313a'
      d set-pixel --x 40 --y 14 --color '#2c313a'
      d set-pixel --x 26 --y 44 --color '#0e1015'
      d set-pixel --x 6  --y 30 --color '#0e1015'
      ;;
  esac
}
band_deepstone "$TILES/deepstone-0.png" 0
band_deepstone "$TILES/deepstone-1.png" 1
band_deepstone "$TILES/deepstone-2.png" 2

# -------- Coreshell (band 4) — red-glowing rock, #3a1512 + #ff6a2a glow ------
# 3 variants: dark crust patches + hot fissures glowing up + molten hot-spots.
band_coreshell() {
  newsprite 48 48 "$1"
  d fill-background --color '#3a1512'
  case "$2" in
    0)
      d fill-circle --cx 14 --cy 14 --r 6 --color '#2a0f0c'
      d fill-circle --cx 36 --cy 34 --r 7 --color '#2a0f0c'
      d fill-circle --cx 30 --cy 12 --r 3 --color '#2a0f0c'
      d line --x0 8  --y0 30 --x1 22 --y1 24 --color '#c4451f'
      d line --x0 22 --y0 24 --x1 26 --y1 40 --color '#ff6a2a'
      d line --x0 30 --y0 20 --x1 42 --y1 28 --color '#c4451f'
      d line --x0 12 --y0 40 --x1 20 --y1 44 --color '#ff6a2a'
      d line --x0 38 --y0 8  --x1 44 --y1 18 --color '#c4451f'
      d fill-circle --cx 24 --cy 30 --r 2 --color '#ff8a3a'
      d set-pixel --x 24 --y 30 --color '#ffb347'
      d fill-circle --cx 40 --cy 24 --r 1 --color '#ff8a3a'
      d set-pixel --x 16 --y 42 --color '#ffb347'
      d set-pixel --x 34 --y 18 --color '#ff8a3a'
      ;;
    1)
      d fill-circle --cx 34 --cy 14 --r 6 --color '#2a0f0c'
      d fill-circle --cx 12 --cy 34 --r 7 --color '#2a0f0c'
      d fill-circle --cx 18 --cy 12 --r 3 --color '#2a0f0c'
      d line --x0 40 --y0 30 --x1 26 --y1 24 --color '#c4451f'
      d line --x0 26 --y0 24 --x1 22 --y1 40 --color '#ff6a2a'
      d line --x0 18 --y0 20 --x1 6  --y1 28 --color '#c4451f'
      d line --x0 36 --y0 40 --x1 28 --y1 44 --color '#ff6a2a'
      d line --x0 10 --y0 8  --x1 4  --y1 18 --color '#c4451f'
      d fill-circle --cx 24 --cy 30 --r 2 --color '#ff8a3a'
      d set-pixel --x 24 --y 30 --color '#ffb347'
      d fill-circle --cx 8  --cy 24 --r 1 --color '#ff8a3a'
      d set-pixel --x 32 --y 42 --color '#ffb347'
      d set-pixel --x 14 --y 18 --color '#ff8a3a'
      ;;
    2)
      d fill-circle --cx 22 --cy 16 --r 6 --color '#2a0f0c'
      d fill-circle --cx 40 --cy 40 --r 6 --color '#2a0f0c'
      d fill-circle --cx 8  --cy 40 --r 3 --color '#2a0f0c'
      d line --x0 6  --y0 22 --x1 20 --y1 30 --color '#c4451f'
      d line --x0 20 --y0 30 --x1 34 --y1 26 --color '#ff6a2a'
      d line --x0 34 --y0 12 --x1 44 --y1 20 --color '#c4451f'
      d line --x0 14 --y0 42 --x1 26 --y1 44 --color '#ff6a2a'
      d line --x0 36 --y0 34 --x1 42 --y1 44 --color '#c4451f'
      d fill-circle --cx 22 --cy 30 --r 2 --color '#ff8a3a'
      d set-pixel --x 22 --y 30 --color '#ffb347'
      d fill-circle --cx 38 --cy 18 --r 1 --color '#ff8a3a'
      d set-pixel --x 12 --y 38 --color '#ffb347'
      d set-pixel --x 30 --y 40 --color '#ff8a3a'
      ;;
  esac
}
band_coreshell "$TILES/coreshell-0.png" 0
band_coreshell "$TILES/coreshell-1.png" 1
band_coreshell "$TILES/coreshell-2.png" 2

# -------- Bedrock border — unminable, near-black, #0c0f14 --------------------
# The hard, impassable bound of the playable space (columns 0/23, the floor, the
# chamber walls). Reads clearly denser & inert vs the minable rock — flat dark with
# a few hard beveled facets and pits, no glow.
newsprite 48 48 "$TILES/bedrock.png"
d fill-background --color '#0c0f14'
# hard angular facets (slightly lit) — a blocky, solid read
d fill-rect --x 4  --y 4  --width 16 --height 14 --color '#141821'
d fill-rect --x 4  --y 4  --width 16 --height 1  --color '#1a1f28'
d fill-rect --x 26 --y 8  --width 16 --height 18 --color '#111620'
d fill-rect --x 26 --y 8  --width 1  --height 18 --color '#1a1f28'
d fill-rect --x 8  --y 26 --width 14 --height 16 --color '#141821'
d fill-rect --x 28 --y 30 --width 14 --height 12 --color '#111620'
# recessed seams between the blocks
d line --x0 22 --y0 2  --x1 24 --y1 46 --color '#06080b'
d line --x0 2  --y0 24 --x1 46 --y1 26 --color '#06080b'
# pits + a couple of flecks
d set-pixel --x 12 --y 12 --color '#1a1f28'
d set-pixel --x 34 --y 16 --color '#1a1f28'
d set-pixel --x 14 --y 34 --color '#1a1f28'
d set-pixel --x 36 --y 36 --color '#06080b'
d set-pixel --x 30 --y 20 --color '#06080b'

# -------- Tunnel — the carved-out empty cell, #0a0d12 -----------------------
# Open space the miner falls / thrusts through. Near-flat dark with a faint vignette
# and a little settled grit so a dug shaft reads as carved, not a void.
newsprite 48 48 "$TILES/tunnel.png"
d fill-background --color '#0a0d12'
# faint darker vignette toward the corners
d fill-circle --cx 4  --cy 4  --r 4 --color '#070a0e'
d fill-circle --cx 44 --cy 4  --r 4 --color '#070a0e'
d fill-circle --cx 4  --cy 44 --r 4 --color '#070a0e'
d fill-circle --cx 44 --cy 44 --r 4 --color '#070a0e'
# a little settled grit / faint depth specks
d set-pixel --x 18 --y 40 --color '#10141a'
d set-pixel --x 30 --y 42 --color '#10141a'
d set-pixel --x 24 --y 44 --color '#10141a'
d set-pixel --x 14 --y 22 --color '#070a0e'
d set-pixel --x 36 --y 26 --color '#070a0e'

# -------- Tunnel edge — rubble trim, #171b22 --------------------------------
# A transparent overlay the renderer lays where rock meets a tunnel, so a carved edge
# reads as broken rubble rather than a clean line. Rubble settles along the bottom.
newsprite 48 48 "$TILES/tunnel-edge.png"
# scattered broken chunks (transparent gaps between them)
d fill-rect --x 6  --y 40 --width 7 --height 5 --color '#171b22'
d fill-rect --x 6  --y 40 --width 7 --height 1 --color '#232830'
d fill-rect --x 18 --y 42 --width 6 --height 4 --color '#171b22'
d fill-rect --x 28 --y 41 --width 8 --height 5 --color '#171b22'
d fill-rect --x 28 --y 41 --width 8 --height 1 --color '#232830'
d fill-rect --x 39 --y 43 --width 5 --height 3 --color '#171b22'
# a few chunks clinging to the side walls
d fill-rect --x 2 --y 20 --width 3 --height 5 --color '#171b22'
d fill-rect --x 43 --y 26 --width 3 --height 6 --color '#171b22'
d fill-rect --x 2 --y 32 --width 2 --height 4 --color '#232830'
# loose pebbles + highlights so the rubble catches the lamp
d set-pixel --x 14 --y 38 --color '#2e3540'
d set-pixel --x 33 --y 39 --color '#2e3540'
d set-pixel --x 9  --y 43 --color '#2e3540'
d set-pixel --x 22 --y 45 --color '#0c0f14'
d set-pixel --x 41 --y 45 --color '#0c0f14'

# ================================================================================
# ORE VEINS (48x48, transparent overlays laid over the band rock) — each must read
# clearly as its ore vs plain rock (specs/mining.md). These are SMEARS, not dots: in
# Motherload an ore vein is a mineral streak run THROUGH the dirt, so each is a broad
# diagonal smear that spreads across most of the tile and FEATHERS into the rock at the
# edges (transparent gaps let the band rock show through, so the ore reads as mixed into
# the dirt rather than a discrete nugget sitting on top). Because the smear reaches the
# tile edges, adjacent ore cells read as one continuous vein. Each keeps its ore's own
# character on top of the shared smear (Ferron flecky, Cuprite nodular, Argenite seamy,
# Voltite crystalline, Pyronium glowing, Adamite a rare bright gem).
# ================================================================================

# smear <base> <hi> <dk> : the shared ore-vein body — a diagonal streak of overlapping
# soft lobes with a couple of offshoots, darker grain threaded through so it isn't a flat
# blob, and a spray of feathered specks bleeding the ore out into the surrounding rock.
smear() {
  local base="$1" hi="$2" dk="$3"
  # main diagonal streak (upper-left -> lower-right), overlapping lobes
  d fill-circle --cx 13 --cy 15 --r 5 --color "$base"
  d fill-circle --cx 20 --cy 20 --r 6 --color "$base"
  d fill-circle --cx 28 --cy 27 --r 6 --color "$base"
  d fill-circle --cx 35 --cy 33 --r 5 --color "$base"
  # short offshoots so the smear branches like a real vein
  d fill-circle --cx 33 --cy 16 --r 3 --color "$base"
  d fill-circle --cx 11 --cy 30 --r 3 --color "$base"
  # darker rock grain threaded through the mass (breaks up the solid blob)
  d line --x0 14 --y0 16 --x1 22 --y1 22 --color "$dk"
  d line --x0 24 --y0 24 --x1 34 --y1 32 --color "$dk"
  d fill-circle --cx 22 --cy 21 --r 2 --color "$dk"
  d fill-circle --cx 30 --cy 28 --r 1 --color "$dk"
  # feathered specks bleeding the ore out toward the tile edges (continuous vein)
  d set-pixel --x 7  --y 12 --color "$base"
  d set-pixel --x 40 --y 38 --color "$base"
  d set-pixel --x 42 --y 22 --color "$base"
  d set-pixel --x 9  --y 38 --color "$base"
  d set-pixel --x 38 --y 10 --color "$base"
  d set-pixel --x 5  --y 24 --color "$base"
  d set-pixel --x 24 --y 42 --color "$base"
  d set-pixel --x 44 --y 30 --color "$base"
  # bright specular glints on the ore
  d set-pixel --x 16 --y 16 --color "$hi"
  d set-pixel --x 26 --y 25 --color "$hi"
  d set-pixel --x 34 --y 32 --color "$hi"
  d set-pixel --x 12 --y 29 --color "$hi"
}

# -------- Ferron — dull rust-brown flecks, #b8794a (common) -----------------
newsprite 48 48 "$ORE/ferron.png"
smear '#b8794a' '#e0b488' '#6e4123'
# extra rust flecks for the "flecky" read
d set-pixel --x 18 --y 24 --color '#a86a3e'
d set-pixel --x 30 --y 20 --color '#a86a3e'
d set-pixel --x 36 --y 26 --color '#cf9968'
d set-pixel --x 14 --y 34 --color '#cf9968'

# -------- Cuprite — teal-green nodules, #4fb0a0 -----------------------------
newsprite 48 48 "$ORE/cuprite.png"
smear '#4fb0a0' '#9ce6d8' '#235f56'
# rounder bright nodules riding the smear
d fill-circle --cx 20 --cy 20 --r 2 --color '#7fd6c6'
d fill-circle --cx 30 --cy 28 --r 2 --color '#7fd6c6'
d set-pixel --x 20 --y 20 --color '#c4f4ec'
d set-pixel --x 30 --y 28 --color '#c4f4ec'

# -------- Argenite — bright silver seams, #cdd6e0 ---------------------------
newsprite 48 48 "$ORE/argenite.png"
smear '#cdd6e0' '#f2f6fb' '#7a828e'
# bright metallic seams threading along the smear (the "seamy" read)
d line --x0 10 --y0 16 --x1 24 --y1 22 --color '#eef2f7'
d line --x0 24 --y0 22 --x1 36 --y1 32 --color '#eef2f7'
d line --x0 14 --y0 30 --x1 30 --y1 24 --color '#eef2f7'
d set-pixel --x 24 --y 22 --color '#ffffff'
d set-pixel --x 34 --y 30 --color '#ffffff'

# -------- Voltite — electric-blue crystals, #5a8cff -------------------------
newsprite 48 48 "$ORE/voltite.png"
smear '#5a8cff' '#b8d0ff' '#2a4488'
# a small angular crystal glint riding the smear (drawn as a tiny diamond)
d line --x0 20 --y0 15 --x1 24 --y1 20 --color '#a8c4ff'
d line --x0 24 --y0 20 --x1 20 --y1 25 --color '#a8c4ff'
d line --x0 20 --y0 25 --x1 16 --y1 20 --color '#a8c4ff'
d line --x0 16 --y0 20 --x1 20 --y1 15 --color '#a8c4ff'
d set-pixel --x 20 --y 20 --color '#e8f0ff'
d set-pixel --x 30 --y 28 --color '#e8f0ff'

# -------- Pyronium — glowing orange ore, #ff8a3a (deep) ---------------------
newsprite 48 48 "$ORE/pyronium.png"
smear '#ff8a3a' '#ffd98a' '#a3491a'
# a glowing hot core welling up through the smear (bright core + halo)
d fill-circle --cx 24 --cy 23 --r 3 --color '#ffb347'
d fill-circle --cx 24 --cy 23 --r 1 --color '#ffcf4a'
d set-pixel --x 24 --y 23 --color '#fff2d6'
d set-pixel --x 33 --y 31 --color '#ffcf4a'

# -------- Adamite — rare aquamarine gem, #8affda ----------------------------
newsprite 48 48 "$ORE/adamite.png"
# rarest ore: the smear plus one bright faceted gem glint at its heart
smear '#8affda' '#e8fff4' '#3f8f76'
d fill-circle --cx 24 --cy 23 --r 3 --color '#8affda'
d line --x0 24 --y0 18 --x1 29 --y1 23 --color '#c4ffe8'
d line --x0 29 --y0 23 --x1 24 --y1 28 --color '#c4ffe8'
d line --x0 24 --y0 28 --x1 19 --y1 23 --color '#c4ffe8'
d line --x0 19 --y0 23 --x1 24 --y1 18 --color '#c4ffe8'
d set-pixel --x 23 --y 22 --color '#ffffff'

# ================================================================================
# MATERIAL NODES — richer & rarer than an ore vein (specs/mining.md). Resonite and
# Cryenite are crystal clusters embedded in rock; the Core glows in its chamber; the
# Core Sample is the small unstable icon it yields.
# ================================================================================

# crystal_node <out> <socket> <glow> <body> <shadow> <hi> <tip> : a big crystal cluster.
crystal_node() {
  newsprite 48 48 "$1"
  d fill-circle --cx 24 --cy 26 --r 15 --color "$2"   # dark rock socket
  d fill-circle --cx 24 --cy 26 --r 13 --color "$3"   # faint glow halo
  d fill-circle --cx 24 --cy 26 --r 7  --color "$2"
  # three angular crystals pointing up out of the socket
  # centre crystal
  d fill-rect --x 22 --y 10 --width 5 --height 22 --color "$4"
  d fill-rect --x 22 --y 10 --width 2 --height 22 --color "$6"
  d fill-rect --x 25 --y 10 --width 2 --height 22 --color "$5"
  d line --x0 22 --y0 10 --x1 24 --y1 5  --color "$4"
  d line --x0 26 --y0 10 --x1 24 --y1 5  --color "$4"
  d set-pixel --x 24 --y 6 --color "$7"
  # left crystal
  d fill-rect --x 13 --y 20 --width 4 --height 16 --color "$4"
  d fill-rect --x 13 --y 20 --width 1 --height 16 --color "$6"
  d fill-rect --x 16 --y 20 --width 1 --height 16 --color "$5"
  d line --x0 13 --y0 20 --x1 15 --y1 15 --color "$4"
  d line --x0 16 --y0 20 --x1 15 --y1 15 --color "$4"
  d set-pixel --x 15 --y 16 --color "$7"
  # right crystal
  d fill-rect --x 31 --y 22 --width 4 --height 14 --color "$4"
  d fill-rect --x 31 --y 22 --width 1 --height 14 --color "$6"
  d fill-rect --x 34 --y 22 --width 1 --height 14 --color "$5"
  d line --x0 31 --y0 22 --x1 33 --y1 18 --color "$4"
  d line --x0 34 --y0 22 --x1 33 --y1 18 --color "$4"
  d set-pixel --x 33 --y 19 --color "$7"
  # inner glints
  d set-pixel --x 24 --y 16 --color "$7"
  d set-pixel --x 24 --y 24 --color "$6"
}

# -------- Resonite — blue crystal (rockbed) ---------------------------------
crystal_node "$MAT/resonite.png" '#0e2230' '#1d5a72' '#4ad0ff' '#1d6a8c' '#a8ecff' '#eaf9ff'

# -------- Cryenite — violet crystal (deepstone) -----------------------------
crystal_node "$MAT/cryenite.png" '#1a1430' '#4a2f7a' '#b98cff' '#6a4aa0' '#e0ccff' '#f2e8ff'

# -------- Core — the glowing molten Core in its chamber (48x48) --------------
newsprite 48 48 "$MAT/core.png"
d fill-circle --cx 24 --cy 24 --r 22 --color '#3a0f08'   # outer heat bloom
d fill-circle --cx 24 --cy 24 --r 18 --color '#6a1a0c'
d fill-circle --cx 24 --cy 24 --r 14 --color '#a82a12'
d fill-circle --cx 24 --cy 24 --r 11 --color '#ff4a2a'
d fill-circle --cx 24 --cy 24 --r 8  --color '#ff6a2a'
d fill-circle --cx 24 --cy 24 --r 5  --color '#ff8a3a'
d fill-circle --cx 24 --cy 24 --r 3  --color '#ffcf4a'
d fill-circle --cx 24 --cy 24 --r 1  --color '#fff2d6'
# radiating fissures cracking out of the molten core
d line --x0 24 --y0 24 --x1 10 --y1 12 --color '#ffcf4a'
d line --x0 24 --y0 24 --x1 40 --y1 14 --color '#ff8a3a'
d line --x0 24 --y0 24 --x1 12 --y1 38 --color '#ff8a3a'
d line --x0 24 --y0 24 --x1 38 --y1 36 --color '#ffcf4a'
d set-pixel --x 10 --y 12 --color '#fff2d6'
d set-pixel --x 40 --y 14 --color '#fff2d6'

# -------- Core Sample — the extracted, unstable icon (32x32) ----------------
newsprite 32 32 "$MAT/core-sample.png"
d fill-circle --cx 16 --cy 16 --r 12 --color '#3a0f08'   # unstable heat halo
d fill-circle --cx 16 --cy 16 --r 9  --color '#6a1a0c'
# jagged unstable shard
d line --x0 16 --y0 3  --x1 24 --y1 16 --color '#ff4a2a'
d line --x0 24 --y0 16 --x1 16 --y1 29 --color '#ff4a2a'
d line --x0 16 --y0 29 --x1 8  --y1 16 --color '#ff4a2a'
d line --x0 8  --y0 16 --x1 16 --y1 3  --color '#ff4a2a'
d fill-circle --cx 16 --cy 16 --r 5 --color '#ff4a2a'
d fill-circle --cx 16 --cy 16 --r 3 --color '#ff8a3a'
d fill-circle --cx 16 --cy 16 --r 1 --color '#ffcf4a'
# energy cracks arcing across the shard (the "unstable" read)
d line --x0 16 --y0 16 --x1 22 --y1 8  --color '#fff2d6'
d line --x0 16 --y0 16 --x1 10 --y1 22 --color '#fff2d6'
d set-pixel --x 16 --y 3  --color '#ffcf4a'
d set-pixel --x 16 --y 29 --color '#ffcf4a'

# ================================================================================
# HAZARDS — must read as danger at a glance (specs/hazards.md).
# ================================================================================

# -------- Gas pocket (48x48) — faintly glowing green, #9ad24a ---------------
# A minable-looking tile with volatile gas glowing green through its cracks.
newsprite 48 48 "$HAZ/gas.png"
d fill-background --color '#1a1f22'                       # dark, faintly green-tinted rock
d fill-circle --cx 20 --cy 24 --r 12 --color '#243026'
# green gas glow welling up through fissures
d fill-circle --cx 20 --cy 24 --r 9 --color '#3a5a24'
d fill-circle --cx 20 --cy 24 --r 6 --color '#6aa838'
d fill-circle --cx 20 --cy 24 --r 3 --color '#9ad24a'
d set-pixel   --x 20 --y 24 --color '#c4e87a'
# secondary gas bubbles
d fill-circle --cx 34 --cy 16 --r 4 --color '#3a5a24'
d fill-circle --cx 34 --cy 16 --r 2 --color '#9ad24a'
d fill-circle --cx 32 --cy 36 --r 3 --color '#3a5a24'
d fill-circle --cx 32 --cy 36 --r 1 --color '#9ad24a'
# glowing fissure lines + drifting motes
d line --x0 12 --y0 12 --x1 20 --y1 24 --color '#6aa838'
d line --x0 20 --y0 24 --x1 34 --y1 30 --color '#6aa838'
d line --x0 20 --y0 24 --x1 30 --y1 12 --color '#9ad24a'
d set-pixel --x 40 --y 40 --color '#9ad24a'
d set-pixel --x 10 --y 38 --color '#c4e87a'
d set-pixel --x 42 --y 26 --color '#6aa838'

# -------- Lava shimmer sheet (48x48, looping) — molten orange, #ff5220 ------
# `draw-sheet`: one PNG per frame. The molten rock churns — dark crust islands drift
# and hot pools brighten/fade — on a ping-pong phase so frame 5 loops back to 0
# seamlessly. Frames render as frame{n}.png, then get zero-padded to frameNN.png.
LAVA_FRAMES=6
newsheet 48 48 "$LAVA_FRAMES" "$LAVA"
# ping-pong phase per frame (0..3..0) so the loop reads continuous
phase=(0 1 2 3 2 1)
for (( f=0; f<LAVA_FRAMES; f++ )); do
  ph=${phase[$f]}
  # molten base
  s fill-background --frame "$f" --color '#ff5220'
  # cooler flowing sheet
  s fill-circle --frame "$f" --cx 24 --cy 24 --r 22 --color '#e0451c'
  # drifting dark crust islands (y drifts with the phase)
  s fill-circle --frame "$f" --cx 14 --cy $(( 12 + ph * 3 )) --r 6 --color '#8a2a12'
  s fill-circle --frame "$f" --cx 14 --cy $(( 12 + ph * 3 )) --r 3 --color '#6a1a0c'
  s fill-circle --frame "$f" --cx 36 --cy $(( 36 - ph * 3 )) --r 7 --color '#8a2a12'
  s fill-circle --frame "$f" --cx 36 --cy $(( 36 - ph * 3 )) --r 4 --color '#6a1a0c'
  s fill-circle --frame "$f" --cx $(( 30 + ph )) --cy 14 --r 4 --color '#8a2a12'
  # hot pools welling up (brightness/position shift with the phase)
  s fill-circle --frame "$f" --cx $(( 22 + ph )) --cy $(( 28 - ph )) --r 5 --color '#ff8a3a'
  s fill-circle --frame "$f" --cx $(( 22 + ph )) --cy $(( 28 - ph )) --r 3 --color '#ffb347'
  s fill-circle --frame "$f" --cx $(( 22 + ph )) --cy $(( 28 - ph )) --r 1 --color '#ffcf4a'
  s fill-circle --frame "$f" --cx $(( 34 - ph )) --cy $(( 22 + ph )) --r 3 --color '#ff8a3a'
  s fill-circle --frame "$f" --cx $(( 34 - ph )) --cy $(( 22 + ph )) --r 1 --color '#ffcf4a'
  # rising sparks (drift up as the phase advances)
  s set-pixel --frame "$f" --x 18 --y $(( 40 - ph * 4 )) --color '#fff2d6'
  s set-pixel --frame "$f" --x 40 --y $(( 30 - ph * 3 )) --color '#ffcf4a'
  s set-pixel --frame "$f" --x 28 --y $(( 36 - ph * 5 )) --color '#ffb347'
done
# zero-pad frame{n}.png -> frameNN.png (ASSET-LAYOUT.md: frame00.png, frame01.png, …)
for (( f=0; f<LAVA_FRAMES; f++ )); do
  mv "$LAVA/frame$f.png" "$LAVA/$(printf 'frame%02d.png' "$f")"
done

echo "produced Deepcore world assets:"
echo "  tiles/     {topsoil,rockbed,deepstone,coreshell}-{0,1,2} bedrock tunnel tunnel-edge"
echo "  ore/       ferron cuprite argenite voltite pyronium adamite (embedded smears)"
echo "  materials/ resonite cryenite core core-sample"
echo "  hazards/   gas + lava/frame00..$(printf '%02d' $(( LAVA_FRAMES - 1 )))"
