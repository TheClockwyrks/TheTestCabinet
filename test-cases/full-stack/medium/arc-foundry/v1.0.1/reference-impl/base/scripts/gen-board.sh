#!/usr/bin/env bash
# Arc Foundry — produce the BOARD assets with the on-PATH `draw` tool (specs/assets.md §11.1).
#
# This script authors everything the yard is laid out from (specs/board.md): the tileable
# concrete SUBSTRATE (the faint tile grid is drawn in code over it), the glowing feeder-vent
# ENTRY and hazard-marked grounding COLLECTOR, the small waypoint PYLON stud the code places
# at each map's waypoint tiles, the steel transformer HOUSING panel that fills Map C's
# fixed-blocked tiles, the inert BLOCKER ROCK an unkept rock hardens into (specs/build.md),
# and a small set of TRACK/DECOR sprites (cable run, floor grate, oil stain, anchor stud,
# flow chevron) the renderer can scatter across the yard. Electro-industrial, oil-dark: the
# palette matches specs/overview.md and src/constants.ts (COL).
#
# The build is self-contained — it loads these committed PNGs and never invokes `draw`.
# Re-run this once to regenerate them:
#
# Usage:  bash scripts/gen-board.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir (mirrors gen-assets.sh).
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOARD="$ROOT/assets/board"
DECOR="$BOARD/decor"
BLOCKER="$ROOT/assets/components/blocker"
mkdir -p "$BOARD" "$DECOR" "$BLOCKER"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsprite <w> <h> <out.png> : start a fresh transparent canvas that renders straight to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# ============================ SUBSTRATE (tileable oil-dark concrete) ===========
# An 80x80 (4x4 tile) seamless patch the board is tiled from; the faint 20px grid is drawn
# in code over it (specs/board.md). Edges are left as flat base so the tile seams cleanly;
# all texture sits in the interior. A regular 4-bolt anchor grid reads as substation floor.
newsprite 80 80 "$BOARD/substrate.png"
d fill-background --color '#0d141b'
# low-contrast concrete blotches (interior only, so the tile wraps seamlessly)
d fill-circle --cx 28 --cy 30 --r 12 --color '#0b1119'
d fill-circle --cx 28 --cy 30 --r 6  --color '#0a1017'
d fill-circle --cx 58 --cy 56 --r 11 --color '#0b1119'
d fill-circle --cx 58 --cy 56 --r 5  --color '#0a1017'
d fill-circle --cx 52 --cy 20 --r 8  --color '#0e1720'
d fill-circle --cx 18 --cy 58 --r 7  --color '#0e1720'
# aggregate flecks (lighter) and pits (darker), kept off the 4px border
d set-pixel --x 22 --y 18 --color '#16212b'
d set-pixel --x 40 --y 14 --color '#16212b'
d set-pixel --x 63 --y 26 --color '#16212b'
d set-pixel --x 15 --y 40 --color '#16212b'
d set-pixel --x 47 --y 47 --color '#16212b'
d set-pixel --x 68 --y 66 --color '#16212b'
d set-pixel --x 33 --y 63 --color '#16212b'
d set-pixel --x 10 --y 24 --color '#101a23'
d set-pixel --x 55 --y 38 --color '#101a23'
d set-pixel --x 24 --y 50 --color '#101a23'
d set-pixel --x 36 --y 34 --color '#090e15'
d set-pixel --x 60 --y 44 --color '#090e15'
d set-pixel --x 20 --y 66 --color '#090e15'
d set-pixel --x 66 --y 12 --color '#090e15'
# regular anchor-bolt grid (studs at the four tile-quarter centers → a clean tiled read)
for xy in "20 20" "60 20" "20 60" "60 60"; do
  set -- $xy
  d fill-circle --cx "$1" --cy "$2" --r 2 --color '#1d2b38'
  d set-pixel --x "$1" --y "$2" --color '#263a4a'
  d set-pixel --x $(( $1 + 1 )) --y $(( $2 + 1 )) --color '#0a0f15'
done

# ============================ ENTRY (blown feeder vent, glowing) ===============
# Where the Load spills in (specs/board.md). A round steel vent housing with a blown-out
# grille and a hot cyan throat; radially symmetric so it reads on any board edge.
newsprite 40 40 "$BOARD/entry.png"
d fill-circle --cx 20 --cy 20 --r 19 --color '#141d26'   # outer shadow ring
d fill-circle --cx 20 --cy 20 --r 18 --color '#232f3c'   # steel rim
d fill-circle --cx 20 --cy 20 --r 16 --color '#37485a'   # housing
d stroke-circle --cx 20 --cy 20 --r 16 --color '#4a5f74' # rim bevel highlight
d fill-circle --cx 20 --cy 20 --r 13 --color '#0a1017'   # dark throat
# hot cyan feeder glow spilling out of the throat
d fill-circle --cx 20 --cy 20 --r 11 --color '#1d4a63'
d fill-circle --cx 20 --cy 20 --r 9  --color '#2f6d92'
d fill-circle --cx 20 --cy 20 --r 6  --color '#4ac6ff'
d fill-circle --cx 20 --cy 20 --r 3  --color '#8fdcff'
d fill-circle --cx 20 --cy 20 --r 1  --color '#eaf6ff'
# blown grille bars (broken across the throat, gaps where it burst)
d fill-rect --x 18 --y 8  --width 3 --height 6  --color '#1a222c'
d fill-rect --x 18 --y 26 --width 3 --height 6  --color '#1a222c'
d fill-rect --x 8  --y 18 --width 6 --height 3  --color '#1a222c'
d fill-rect --x 26 --y 18 --width 6 --height 3  --color '#1a222c'
# housing rivets at the diagonals
d fill-circle --cx 9  --cy 9  --r 1 --color '#5a708a'
d fill-circle --cx 31 --cy 9  --r 1 --color '#5a708a'
d fill-circle --cx 9  --cy 31 --r 1 --color '#5a708a'
d fill-circle --cx 31 --cy 31 --r 1 --color '#5a708a'
# escaping sparks
d set-pixel --x 30 --y 14 --color '#eaf6ff'
d set-pixel --x 12 --y 28 --color '#8fdcff'
d set-pixel --x 26 --y 30 --color '#4ac6ff'

# ============================ COLLECTOR (grounding sink, hazard) ===============
# Where units ground out and cost Grid Integrity (specs/flow.md). A square hazard-taped
# housing around a red grounding pit with concentric discharge rings and a grate.
newsprite 40 40 "$BOARD/collector.png"
d fill-rect --x 2 --y 2 --width 36 --height 36 --color '#141d26'   # dark housing
d stroke-rect --x 2 --y 2 --width 36 --height 36 --color '#37485a' # steel bevel
d fill-rect --x 5 --y 5 --width 30 --height 30 --color '#101820'   # recessed field
# hazard tape bands (top + bottom), alternating charge-yellow and dark
for x in 5 13 21 29; do
  d fill-rect --x "$x" --y 5  --width 4 --height 3 --color '#ffcf4a'
  d fill-rect --x "$x" --y 32 --width 4 --height 3 --color '#ffcf4a'
done
# the grounding pit + concentric discharge rings (hazard red)
d fill-circle --cx 20 --cy 20 --r 13 --color '#14171b'
d stroke-circle --cx 20 --cy 20 --r 12 --color '#ff6a4a'
d stroke-circle --cx 20 --cy 20 --r 9  --color '#ff5a52'
d stroke-circle --cx 20 --cy 20 --r 6  --color '#ff8a6a'
d fill-circle --cx 20 --cy 20 --r 3 --color '#3a0f0c'   # drain
d fill-circle --cx 20 --cy 20 --r 1 --color '#ff6a4a'
# grate bars across the pit
d fill-rect --x 8 --y 15 --width 24 --height 1 --color '#232f3c'
d fill-rect --x 8 --y 20 --width 24 --height 1 --color '#232f3c'
d fill-rect --x 8 --y 25 --width 24 --height 1 --color '#232f3c'
# corner mounting bolts
d fill-circle --cx 6  --cy 6  --r 1 --color '#4a5f74'
d fill-circle --cx 34 --cy 6  --r 1 --color '#4a5f74'
d fill-circle --cx 6  --cy 34 --r 1 --color '#4a5f74'
d fill-circle --cx 34 --cy 34 --r 1 --color '#4a5f74'

# ============================ PYLON (waypoint checkpoint stud) =================
# A small pylon the code stamps on each map's waypoint tiles so the ordered chain reads
# at a glance (specs/board.md). A bolted base plate, a short post, a glowing cyan beacon.
newsprite 20 20 "$BOARD/pylon.png"
d fill-rect --x 4 --y 14 --width 12 --height 4 --color '#232f3c'   # base plate
d fill-rect --x 4 --y 14 --width 12 --height 1 --color '#4a5f74'   # plate highlight
d set-pixel --x 5  --y 16 --color '#5a708a'                        # foot bolts
d set-pixel --x 14 --y 16 --color '#5a708a'
d fill-rect --x 8 --y 6 --width 4 --height 9 --color '#37485a'     # post
d fill-rect --x 8 --y 6 --width 1 --height 9 --color '#4a5f74'     # post edge light
d fill-rect --x 11 --y 6 --width 1 --height 9 --color '#232f3c'    # post edge shadow
d fill-circle --cx 10 --cy 5 --r 3 --color '#1d4a63'              # beacon glow
d fill-circle --cx 10 --cy 5 --r 2 --color '#4ac6ff'
d fill-circle --cx 10 --cy 4 --r 1 --color '#eaf6ff'

# ============================ HOUSING (Map C transformer steel) ================
# A 40x40 (2x2 tile) tileable riveted steel panel that fills Map C's fixed-blocked housings
# (specs/board.md §4.3) — reads as impassable transformer steel when tiled across the block.
# Beveled edges make each tile a raised panel; a finned core reads as a transformer.
newsprite 40 40 "$BOARD/housing.png"
d fill-background --color '#37485a'
d fill-rect --x 0 --y 0 --width 40 --height 2 --color '#4a5f74'    # top bevel (light)
d fill-rect --x 0 --y 0 --width 2 --height 40 --color '#4a5f74'    # left bevel (light)
d fill-rect --x 0 --y 38 --width 40 --height 2 --color '#232f3c'   # bottom bevel (dark)
d fill-rect --x 38 --y 0 --width 2 --height 40 --color '#232f3c'   # right bevel (dark)
d fill-rect --x 5 --y 5 --width 30 --height 30 --color '#313f4e'   # recessed field
# cooling fins (transformer read)
for x in 11 15 19 23 27; do
  d fill-rect --x "$x" --y 9 --width 1 --height 22 --color '#2b333c'
  d fill-rect --x $(( x + 1 )) --y 9 --width 1 --height 22 --color '#41556a'
done
# corner rivets
for xy in "6 6" "34 6" "6 34" "34 34"; do
  set -- $xy
  d fill-circle --cx "$1" --cy "$2" --r 2 --color '#2b333c'
  d set-pixel --x $(( $1 - 1 )) --y $(( $2 - 1 )) --color '#5a708a'
done
# warning stud (high-voltage yellow) at the panel center
d fill-rect --x 18 --y 18 --width 4 --height 4 --color '#232f3c'
d set-pixel --x 19 --y 19 --color '#ffcf4a'
d set-pixel --x 20 --y 20 --color '#ffcf4a'

# ============================ BLOCKER ROCK (inert fused scrap) =================
# The dead lump an unkept rock hardens into (specs/build.md): a 2x2 (40x40) fused-scrap
# rock — NO head, NO glow — that must never be mistaken for a firing component.
newsprite 40 40 "$BLOCKER/rock.png"
# irregular fused lump (stacked rects → a blobby, un-square silhouette)
d fill-rect --x 6  --y 8  --width 28 --height 26 --color '#3a4351'
d fill-rect --x 4  --y 12 --width 32 --height 18 --color '#3a4351'
d fill-rect --x 10 --y 5  --width 20 --height 30 --color '#3a4351'
d fill-rect --x 8  --y 34 --width 26 --height 3  --color '#2f3744'
# top-left facets catch dull light
d fill-rect --x 10 --y 7  --width 12 --height 3 --color '#4a5560'
d fill-rect --x 8  --y 12 --width 4  --height 8 --color '#4a5560'
d set-pixel --x 14 --y 10 --color '#55606e'
d set-pixel --x 20 --y 9  --color '#55606e'
# bottom-right shadow
d fill-rect --x 26 --y 26 --width 8 --height 8 --color '#23282f'
d fill-rect --x 30 --y 18 --width 4 --height 12 --color '#2b313b'
# embedded scrap chunks
d fill-rect --x 15 --y 16 --width 6 --height 5 --color '#2b333c'
d fill-rect --x 22 --y 20 --width 5 --height 6 --color '#444d5a'
d fill-rect --x 12 --y 24 --width 5 --height 4 --color '#333b47'
# rust streaks + pitting (dead, weathered, no glow)
d set-pixel --x 18 --y 14 --color '#5a4636'
d set-pixel --x 18 --y 15 --color '#6a4a2a'
d set-pixel --x 25 --y 12 --color '#5a4636'
d set-pixel --x 25 --y 13 --color '#6a4a2a'
d set-pixel --x 29 --y 27 --color '#4a3a2a'
d set-pixel --x 13 --y 20 --color '#23282f'
d set-pixel --x 27 --y 16 --color '#23282f'
d set-pixel --x 21 --y 30 --color '#23282f'
d set-pixel --x 16 --y 28 --color '#55606e'

# ============================ TRACK / DECOR ===================================
# Extra industrial dressing the renderer may scatter across the yard (specs/assets.md invites
# track/decor). Each is small and neutral so it reads on the oil-dark substrate.

# cable run — a conduit with two cables and end connectors (drawn +x; the game rotates it)
newsprite 40 12 "$DECOR/cable.png"
d fill-rect --x 2 --y 3 --width 36 --height 6 --color '#1a222c'   # conduit body
d fill-rect --x 2 --y 3 --width 36 --height 1 --color '#2b3a4a'   # top highlight
d fill-rect --x 2 --y 5 --width 36 --height 1 --color '#2b333c'   # cable 1
d fill-rect --x 2 --y 7 --width 36 --height 1 --color '#232f3c'   # cable 2
d fill-rect --x 1 --y 2 --width 4 --height 8 --color '#313f4e'    # left connector
d fill-rect --x 35 --y 2 --width 4 --height 8 --color '#313f4e'   # right connector
d set-pixel --x 2 --y 3 --color '#5a708a'
d set-pixel --x 37 --y 3 --color '#5a708a'

# floor grate — a drain the Load crosses
newsprite 20 20 "$DECOR/grate.png"
d fill-rect --x 2 --y 2 --width 16 --height 16 --color '#0f1620'
d stroke-rect --x 2 --y 2 --width 16 --height 16 --color '#232f3c'
for y in 5 8 11 14; do
  d fill-rect --x 4 --y "$y" --width 12 --height 1 --color '#313f4e'
done
d set-pixel --x 3 --y 3 --color '#3a4a5c'

# oil stain — an irregular dark blotch (transparent field, layered dark discs)
newsprite 24 24 "$DECOR/stain.png"
d fill-circle --cx 11 --cy 12 --r 9 --color '#0a0f16'
d fill-circle --cx 14 --cy 10 --r 5 --color '#080d13'
d fill-circle --cx 9  --cy 15 --r 4 --color '#080d13'
d fill-circle --cx 12 --cy 12 --r 3 --color '#05080c'
d set-pixel --x 18 --y 8 --color '#0a0f16'
d set-pixel --x 6  --y 18 --color '#0a0f16'

# anchor stud — a small floor bolt the renderer can dot around
newsprite 8 8 "$DECOR/stud.png"
d fill-circle --cx 4 --cy 4 --r 3 --color '#232f3c'
d fill-circle --cx 4 --cy 4 --r 2 --color '#313f4e'
d set-pixel --x 3 --y 3 --color '#5a708a'
d set-pixel --x 5 --y 5 --color '#141d26'

# flow chevron — a cyan direction arrow (drawn pointing +x; the game rotates it toward the
# Collector for the flow-direction read, specs/board.md)
newsprite 16 16 "$DECOR/flow.png"
d line --x0 3 --y0 3 --x1 11 --y1 8 --color '#2f6d92'
d line --x0 3 --y0 13 --x1 11 --y1 8 --color '#2f6d92'
d line --x0 4 --y0 4 --x1 10 --y1 8 --color '#4ac6ff'
d line --x0 4 --y0 12 --x1 10 --y1 8 --color '#4ac6ff'
d set-pixel --x 11 --y 8 --color '#eaf6ff'

echo "produced Arc Foundry board assets:"
echo "  $BOARD/{substrate,entry,collector,pylon,housing}.png"
echo "  $BLOCKER/rock.png"
echo "  $DECOR/{cable,grate,stain,stud,flow}.png"
