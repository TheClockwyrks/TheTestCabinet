#!/usr/bin/env bash
# Deepcore — produce the WORLD sprites with the on-PATH `draw` (+ `draw-sheet` for the
# lava shimmer) tools (specs/assets.md, "Environment sprites"; ASSET-LAYOUT.md). This
# script owns the environment the mine is built from — everything the vertical camera
# scrolls past as the miner digs down through the four depth bands (specs/world.md):
#
#   • the five 48x48 TILES the bands and their bounds are drawn from — a tileable rock
#     tile per band so the depth reads at a glance (topsoil earth, rockbed grey stone,
#     deepstone near-black, coreshell red-glowing), plus the unminable BEDROCK border,
#     the carved TUNNEL cell, and a TUNNEL-EDGE rubble trim (specs/world.md tile kinds);
#   • the six 48x48 ORE VEINS (Ferron, Cuprite, Argenite, Voltite, Pyronium, Adamite)
#     as transparent overlays the renderer lays over the band rock — each reading clearly
#     as its ore by colour and glint so a vein stands out from plain rock (specs/mining.md);
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
# Each is a full opaque tile: flood the band fill, then texture the INTERIOR (kept off
# the 0/1 outer rows) so neighbouring tiles seam cleanly across the mine.
# ================================================================================

# -------- Topsoil (band 1) — warm brown earth, #3a2c1f -----------------------
newsprite 48 48 "$TILES/topsoil.png"
d fill-background --color '#3a2c1f'
# darker soil clumps
d fill-circle --cx 14 --cy 16 --r 6 --color '#2f2318'
d fill-circle --cx 34 --cy 30 --r 7 --color '#2f2318'
d fill-circle --cx 34 --cy 30 --r 3 --color '#241a11'
d fill-circle --cx 24 --cy 40 --r 5 --color '#2f2318'
d fill-circle --cx 10 --cy 36 --r 3 --color '#241a11'
# lighter grit + pebbles
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

# -------- Rockbed (band 2) — grey stone, #3a3d44 -----------------------------
newsprite 48 48 "$TILES/rockbed.png"
d fill-background --color '#3a3d44'
# angular cracks (darker)
d line --x0 8  --y0 6  --x1 20 --y1 18 --color '#2a2d33'
d line --x0 20 --y0 18 --x1 16 --y1 34 --color '#2a2d33'
d line --x0 30 --y0 8  --x1 38 --y1 22 --color '#23262c'
d line --x0 38 --y0 22 --x1 42 --y1 40 --color '#2a2d33'
d line --x0 22 --y0 30 --x1 34 --y1 42 --color '#23262c'
d line --x0 6  --y0 40 --x1 18 --y1 38 --color '#2a2d33'
# lighter facets catching the suit lamp
d fill-circle --cx 26 --cy 14 --r 4 --color '#464b53'
d fill-circle --cx 12 --cy 24 --r 3 --color '#464b53'
d fill-circle --cx 40 --cy 30 --r 3 --color '#545a63'
d set-pixel --x 30 --y 26 --color '#545a63'
d set-pixel --x 18 --y 42 --color '#545a63'
d set-pixel --x 44 --y 12 --color '#464b53'
d set-pixel --x 24 --y 44 --color '#2a2d33'

# -------- Deepstone (band 3) — near-black rock, #20242c ----------------------
newsprite 48 48 "$TILES/deepstone.png"
d fill-background --color '#20242c'
# tight, dark fractures
d line --x0 10 --y0 8  --x1 22 --y1 20 --color '#14171d'
d line --x0 22 --y0 20 --x1 20 --y1 36 --color '#14171d'
d line --x0 32 --y0 10 --x1 40 --y1 26 --color '#0e1015'
d line --x0 12 --y0 40 --x1 30 --y1 38 --color '#14171d'
d line --x0 38 --y0 30 --x1 36 --y1 44 --color '#0e1015'
# faint cold highlights (sparse — the band is meant to read dark)
d fill-circle --cx 28 --cy 16 --r 2 --color '#2c313a'
d set-pixel --x 14 --y 28 --color '#2c313a'
d set-pixel --x 40 --y 20 --color '#2c313a'
d set-pixel --x 24 --y 42 --color '#2c313a'
d set-pixel --x 8  --y 16 --color '#0e1015'
d set-pixel --x 44 --y 40 --color '#0e1015'

# -------- Coreshell (band 4) — red-glowing rock, #3a1512 + #ff6a2a glow ------
newsprite 48 48 "$TILES/coreshell.png"
d fill-background --color '#3a1512'
# darkened crust patches
d fill-circle --cx 14 --cy 14 --r 6 --color '#2a0f0c'
d fill-circle --cx 36 --cy 34 --r 7 --color '#2a0f0c'
d fill-circle --cx 30 --cy 12 --r 3 --color '#2a0f0c'
# hot fissures glowing up through the rock (the rising orange glow read)
d line --x0 8  --y0 30 --x1 22 --y1 24 --color '#c4451f'
d line --x0 22 --y0 24 --x1 26 --y1 40 --color '#ff6a2a'
d line --x0 30 --y0 20 --x1 42 --y1 28 --color '#c4451f'
d line --x0 12 --y0 40 --x1 20 --y1 44 --color '#ff6a2a'
d line --x0 38 --y0 8  --x1 44 --y1 18 --color '#c4451f'
# molten hot-spots
d fill-circle --cx 24 --cy 30 --r 2 --color '#ff8a3a'
d set-pixel --x 24 --y 30 --color '#ffb347'
d fill-circle --cx 40 --cy 24 --r 1 --color '#ff8a3a'
d set-pixel --x 16 --y 42 --color '#ffb347'
d set-pixel --x 34 --y 18 --color '#ff8a3a'

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
# clearly as its ore vs plain rock (specs/mining.md). Each nugget sits in a dark
# "socket" so it reads as embedded in rock over any band fill.
# ================================================================================

# nugget <cx> <cy> <r> <socket> <ore> <glint> : an ore lump in a dark rock socket.
nugget() {
  d fill-circle --cx "$1" --cy "$2" --r $(( $3 + 1 )) --color "$4"
  d fill-circle --cx "$1" --cy "$2" --r "$3"          --color "$5"
  d set-pixel   --x  "$1" --y  "$2" --color "$6"
}

# -------- Ferron — dull rust-brown flecks, #b8794a (common) -----------------
newsprite 48 48 "$ORE/ferron.png"
nugget 16 18 3 '#1c140d' '#b8794a' '#cf9968'
nugget 30 14 2 '#1c140d' '#b8794a' '#cf9968'
nugget 34 30 3 '#1c140d' '#b8794a' '#cf9968'
nugget 20 34 2 '#1c140d' '#b8794a' '#cf9968'
nugget 12 30 2 '#1c140d' '#a86a3e' '#cf9968'
d set-pixel --x 40 --y 20 --color '#b8794a'
d set-pixel --x 26 --y 26 --color '#a86a3e'
d set-pixel --x 24 --y 42 --color '#b8794a'

# -------- Cuprite — teal-green nodules, #4fb0a0 -----------------------------
newsprite 48 48 "$ORE/cuprite.png"
d fill-circle --cx 18 --cy 20 --r 6 --color '#10201d'
d fill-circle --cx 18 --cy 20 --r 5 --color '#4fb0a0'
d fill-circle --cx 16 --cy 18 --r 2 --color '#7fd6c6'
d fill-circle --cx 32 --cy 30 --r 5 --color '#10201d'
d fill-circle --cx 32 --cy 30 --r 4 --color '#4fb0a0'
d fill-circle --cx 30 --cy 28 --r 1 --color '#7fd6c6'
d fill-circle --cx 33 --cy 15 --r 3 --color '#10201d'
d fill-circle --cx 33 --cy 15 --r 2 --color '#4fb0a0'
d set-pixel --x 12 --y 32 --color '#4fb0a0'
d set-pixel --x 24 --y 38 --color '#7fd6c6'

# -------- Argenite — bright silver seams, #cdd6e0 ---------------------------
newsprite 48 48 "$ORE/argenite.png"
# veiny metallic seams threading the rock
d line --x0 8  --y0 14 --x1 22 --y1 20 --color '#8a94a0'
d line --x0 8  --y0 13 --x1 22 --y1 19 --color '#cdd6e0'
d line --x0 22 --y0 19 --x1 34 --y1 16 --color '#cdd6e0'
d line --x0 34 --y0 16 --x1 42 --y1 24 --color '#cdd6e0'
d line --x0 14 --y0 34 --x1 28 --y1 30 --color '#8a94a0'
d line --x0 14 --y0 33 --x1 28 --y1 29 --color '#cdd6e0'
d line --x0 28 --y0 29 --x1 38 --y1 36 --color '#cdd6e0'
d line --x0 20 --y0 22 --x1 24 --y1 30 --color '#cdd6e0'
# bright glints along the seams
d set-pixel --x 22 --y 19 --color '#eef2f7'
d set-pixel --x 34 --y 16 --color '#eef2f7'
d set-pixel --x 28 --y 29 --color '#eef2f7'
d set-pixel --x 14 --y 16 --color '#eef2f7'

# -------- Voltite — electric-blue crystals, #5a8cff -------------------------
newsprite 48 48 "$ORE/voltite.png"
# angular crystal shards with a glowing core (drawn as stacked diamonds)
d fill-circle --cx 18 --cy 22 --r 6 --color '#10182c'
d line --x0 18 --y0 12 --x1 24 --y1 22 --color '#5a8cff'
d line --x0 24 --y0 22 --x1 18 --y1 32 --color '#5a8cff'
d line --x0 18 --y0 32 --x1 12 --y1 22 --color '#5a8cff'
d line --x0 12 --y0 22 --x1 18 --y1 12 --color '#5a8cff'
d fill-circle --cx 18 --cy 22 --r 2 --color '#a8c4ff'
d set-pixel --x 18 --y 22 --color '#e8f0ff'
d fill-circle --cx 33 --cy 30 --r 4 --color '#10182c'
d line --x0 33 --y0 24 --x1 37 --y1 30 --color '#5a8cff'
d line --x0 37 --y0 30 --x1 33 --y1 36 --color '#5a8cff'
d line --x0 33 --y0 36 --x1 29 --y1 30 --color '#5a8cff'
d line --x0 29 --y0 30 --x1 33 --y1 24 --color '#5a8cff'
d set-pixel --x 33 --y 30 --color '#a8c4ff'
d set-pixel --x 38 --y 16 --color '#5a8cff'

# -------- Pyronium — glowing orange ore, #ff8a3a (deep) ---------------------
newsprite 48 48 "$ORE/pyronium.png"
# hot glowing nuggets with a bright core + soft halo
d fill-circle --cx 20 --cy 20 --r 8 --color '#3a1c0a'
d fill-circle --cx 20 --cy 20 --r 6 --color '#c4551f'
d fill-circle --cx 20 --cy 20 --r 4 --color '#ff8a3a'
d fill-circle --cx 20 --cy 20 --r 2 --color '#ffcf4a'
d set-pixel   --x 20 --y 20 --color '#fff2d6'
d fill-circle --cx 33 --cy 32 --r 5 --color '#3a1c0a'
d fill-circle --cx 33 --cy 32 --r 3 --color '#ff8a3a'
d fill-circle --cx 33 --cy 32 --r 1 --color '#ffcf4a'
d set-pixel --x 30 --y 14 --color '#ff8a3a'
d set-pixel --x 12 --y 34 --color '#ff8a3a'

# -------- Adamite — rare aquamarine gem, #8affda ----------------------------
newsprite 48 48 "$ORE/adamite.png"
# ONE brilliant faceted gem (rare read) + a faint glow halo + a lone fleck
d fill-circle --cx 24 --cy 24 --r 11 --color '#123a30'
d fill-circle --cx 24 --cy 24 --r 9  --color '#1f5a4a'
# faceted gem body
d line --x0 24 --y0 12 --x1 34 --y1 24 --color '#8affda'
d line --x0 34 --y0 24 --x1 24 --y1 36 --color '#8affda'
d line --x0 24 --y0 36 --x1 14 --y1 24 --color '#8affda'
d line --x0 14 --y0 24 --x1 24 --y1 12 --color '#8affda'
d line --x0 24 --y0 12 --x1 24 --y1 36 --color '#5fd6b0'
d line --x0 14 --y0 24 --x1 34 --y1 24 --color '#5fd6b0'
d fill-circle --cx 24 --cy 24 --r 3 --color '#8affda'
d fill-circle --cx 22 --cy 22 --r 1 --color '#e8fff4'
# facet edge shadows + a stray fleck
d line --x0 24 --y0 12 --x1 34 --y1 24 --color '#c4ffe8'
d set-pixel --x 24 --y 12 --color '#e8fff4'
d set-pixel --x 38 --y 38 --color '#8affda'
d set-pixel --x 10 --y 12 --color '#8affda'

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
echo "  tiles/     topsoil rockbed deepstone coreshell bedrock tunnel tunnel-edge"
echo "  ore/       ferron cuprite argenite voltite pyronium adamite"
echo "  materials/ resonite cryenite core core-sample"
echo "  hazards/   gas + lava/frame00..$(printf '%02d' $(( LAVA_FRAMES - 1 )))"
