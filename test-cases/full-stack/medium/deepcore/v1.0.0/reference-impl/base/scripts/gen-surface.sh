#!/usr/bin/env bash
# Deepcore — produce the SURFACE, ESCAPE ROCKET, and HUD-ICON sprites with the on-PATH
# `draw` (single sprites) and `draw-sheet` (the rocket-assembly stages) tools
# (specs/assets.md — "Surface buildings", "The escape rocket", "HUD icons";
# ASSET-LAYOUT.md — the canonical paths). This script owns three asset categories:
#
#   • assets/surface/  — the camp the miner returns to between digs (specs/world.md):
#       sky.png          the dim DUSK-sky backdrop (#1b2536), horizontally tileable
#       ground.png       the scrapped surface / camp ground strip, horizontally tileable
#       cave-mouth.png   the shored opening down into row 1 (the way into the mine)
#       fuel-depot.png   REFUEL/REPAIR — a fuel tank + pump, reads as a fuel depot
#       ore-market.png   SELL ore — a trading stall with ore crates + a balance scale
#       upgrade-shop.png BUY upgrades — a fabricator hut with a gear + crossed wrench
#       launch-pad.png   the derelict launch platform (base only; the rocket is separate)
#
#   • assets/rocket/stage0..stage5.png — the escape rocket as a 6-frame `draw-sheet`
#     assembly ladder (specs/rocket.md): bare pad → +Hull Frame → +Fuel Cells →
#     +Guidance Unit → +Thruster Assembly → +Ignition Core (lit, launch-ready). The
#     rocket VISIBLY gains each installed component; the engine selects the stage by how
#     many of the five components are installed. Every stage is the SAME 64×128 canvas so
#     the renderer stacks it over launch-pad.png at a fixed offset.
#
#   • assets/icons/  — the small HUD status-bar glyphs (specs/flow.md), 20×20 each:
#       fuel hull cargo credits depth resonite cryenite
#
# The palette is specs/overview.md / src/constants.ts (COL). The build itself is
# SELF-CONTAINED: it loads these committed PNGs via Vite globs and never invokes `draw`.
# Re-run this once to regenerate them. Only the finished PNGs under assets/ are committed;
# the tools' *.config.json / *.actions.json / *.preview.* scratch is written to a temp dir
# and gitignored.
#
# Usage:  bash scripts/gen-surface.sh   (draw/draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir (works both here and
# on the run image, where the six tools ARE on PATH).
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw       >/dev/null 2>&1 || { echo "draw not found on PATH"       >&2; exit 1; }
command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SURF="$ROOT/assets/surface"
ROCK="$ROOT/assets/rocket"
ICON="$ROOT/assets/icons"
mkdir -p "$SURF" "$ROCK" "$ICON"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers (draw) -----------------------------------------------
# newsprite <w> <h> <out.png> : fresh transparent (straight-alpha) canvas -> <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# --- sheet helpers (draw-sheet, the 6 rocket stages) ----------------------------
# newsheet <w> <h> <dir> <name> : 6-frame set -> <dir>/<name>0.png .. <name>5.png
newsheet() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [0,1,2,3,4,5], "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/f_{frame}.json" "$3/$4{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# ============================ PALETTE (specs/overview.md) =======================
DUSK='#1b2536'; GROUND='#2c2620'
GROUND_D='#211c17'; GROUND_L='#3a332a'; GRAVEL='#463c30'
BEDROCK='#0c0f14'; TUNNEL='#0a0d12'
# Invented steel ramp (subterranean-industrial), consistent with the dark palette.
MET_XD='#141a20'   # panel / deepest shadow
MET_D='#1c242e'    # dark steel
MET_M='#33414f'    # mid steel (body)
MET_L='#55697c'    # light steel
MET_HL='#7d93a6'   # steel highlight / rivet catch
RUST_D='#5c3a20'; RUST_L='#7a4a28'
# Accents (COL)
FUEL='#ffcf4a'; HULL='#46d6e6'; CARGO='#c48a52'; CREDITS='#ffd23a'
FERRON='#b8794a'; RESONITE='#4ad0ff'; CRYENITE='#b98cff'
CORE='#ff4a2a'; COREGLOW='#ff6a2a'; FLAME='#ffa63a'; ALERT='#ff5a52'
TXT2='#93a2b2'; TXT3='#5d6b7a'; WHITE='#e8eef5'

# =========================================================================================
#  SURFACE — sky, ground, cave-mouth, and the four buildings (specs/world.md)
# =========================================================================================

# ---------------------------------- SKY (dusk backdrop) --------------------------
# A dim dusk sky (#1b2536): a vertical gradient from near-black overhead down to a faintly
# warmer horizon, a scatter of cold stars, a dim moon, and a jagged distant ridge along the
# bottom. 192 wide so it tiles horizontally across the 1280 viewport; the camp/ground sit
# in front of it. (No gradient op — banded fill-rects fake the dusk falloff.)
newsprite 192 128 "$SURF/sky.png"
d fill-rect --x 0 --y 0   --width 192 --height 128 --color "$DUSK"   # base
d fill-rect --x 0 --y 0   --width 192 --height 18 --color '#0d1420'  # darkest overhead
d fill-rect --x 0 --y 18  --width 192 --height 14 --color '#121b2b'
d fill-rect --x 0 --y 32  --width 192 --height 14 --color '#16202f'
d fill-rect --x 0 --y 46  --width 192 --height 16 --color "$DUSK"
d fill-rect --x 0 --y 62  --width 192 --height 14 --color '#1f2a3e'  # horizon warms
d fill-rect --x 0 --y 76  --width 192 --height 14 --color '#243046'
d fill-rect --x 0 --y 90  --width 192 --height 12 --color '#283650'
d fill-rect --x 0 --y 102 --width 192 --height 12 --color '#2c3a56'
# dim moon (low, hazy — a soft disc with a cool highlight)
d fill-circle --cx 150 --cy 30 --r 11 --color '#2a3550'
d fill-circle --cx 150 --cy 30 --r 9  --color '#37456a'
d fill-circle --cx 150 --cy 30 --r 6  --color '#46587f'
d fill-circle --cx 148 --cy 28 --r 3  --color '#5d709a'
# cold stars, upper field
for xy in "14 12" "34 22" "58 9" "72 30" "96 16" "110 26" "126 11" "170 40" "182 20" \
          "24 40" "48 46" "84 44" "118 48" "8 28" "64 18" "100 8" "138 34"; do
  set -- $xy
  d set-pixel --x "$1" --y "$2" --color "$TXT2"
done
d set-pixel --x 34  --y 22 --color "$WHITE"
d set-pixel --x 110 --y 26 --color "$WHITE"
d set-pixel --x 8   --y 28 --color '#c6d2e0'
# distant ridge silhouette (jagged mountains) along the bottom
for col in "0 6" "8 10" "18 5" "26 14" "40 8" "50 18" "66 11" "78 20" "92 9" "104 15" \
           "118 7" "128 22" "146 12" "158 8" "170 17" "182 10"; do
  set -- $col
  d fill-rect --x "$1" --y $(( 128 - $2 )) --width 12 --height "$2" --color '#10161f'
done
d fill-rect --x 0 --y 122 --width 192 --height 6 --color "$BEDROCK"  # solid base skirt

# ---------------------------------- GROUND (scrapped camp) -----------------------
# A horizontally-tileable strip of the surface camp (specs/world.md, COL.surfaceGround
# #2c2620): a packed ground band, scattered gravel + scrap plates, anchor bolts, cracks,
# and an oil stain. The buildings and the miner stand on this; row 1 begins just below.
newsprite 96 48 "$SURF/ground.png"
d fill-rect --x 0 --y 0  --width 96 --height 48 --color "$GROUND"
d fill-rect --x 0 --y 0  --width 96 --height 3  --color "$GROUND_L"   # sunlit top lip
d fill-rect --x 0 --y 3  --width 96 --height 2  --color '#332c24'
d fill-rect --x 0 --y 40 --width 96 --height 8  --color "$GROUND_D"   # packed base shadow
# scrap plates half-buried in the dirt
d fill-rect --x 8  --y 14 --width 20 --height 6 --color "$MET_D"
d fill-rect --x 8  --y 14 --width 20 --height 1 --color "$MET_M"
d fill-rect --x 58 --y 22 --width 16 --height 5 --color "$MET_D"
d fill-rect --x 58 --y 22 --width 16 --height 1 --color "$MET_M"
d fill-rect --x 36 --y 30 --width 14 --height 4 --color "$MET_XD"
# anchor bolts studded across the packed ground
for xy in "6 10" "22 26" "44 12" "70 16" "86 32" "52 8" "30 20" "78 26"; do
  set -- $xy
  d set-pixel --x "$1" --y "$2" --color "$MET_L"
  d set-pixel --x $(( $1 + 1 )) --y $(( $2 + 1 )) --color "$GROUND_D"
done
# gravel flecks + darker pits
for xy in "12 34" "40 18" "62 34" "88 12" "20 8" "72 38" "50 26" "4 30" "94 22"; do
  set -- $xy; d set-pixel --x "$1" --y "$2" --color "$GRAVEL"
done
for xy in "16 24" "48 36" "66 10" "82 20" "28 38"; do
  set -- $xy; d set-pixel --x "$1" --y "$2" --color "$GROUND_D"
done
# hairline cracks + an oil stain
d line --x0 30 --y0 6 --x1 38 --y1 16 --color "$GROUND_D"
d line --x0 74 --y0 4 --x1 68 --y1 14 --color "$GROUND_D"
d fill-circle --cx 20 --cy 40 --r 5 --color '#191510'
d fill-circle --cx 22 --cy 41 --r 2 --color '#0f0c09'

# ---------------------------------- CAVE MOUTH (the way down) ---------------------
# The shored opening in the camp floor down into row 1 (specs/world.md). A dark descending
# shaft framed by steel headgear + timber shoring, rubble at the lip, a ladder into the
# dark, and a fade to tunnel-black so it clearly reads "down". Straight alpha above the lip.
newsprite 96 72 "$SURF/cave-mouth.png"
# ground shoulders on each side of the mouth
d fill-rect --x 0  --y 0 --width 22 --height 72 --color "$GROUND"
d fill-rect --x 74 --y 0 --width 22 --height 72 --color "$GROUND"
d fill-rect --x 0  --y 0 --width 22 --height 3  --color "$GROUND_L"
d fill-rect --x 74 --y 0 --width 22 --height 3  --color "$GROUND_L"
# the shaft: dark throat fading down
d fill-rect --x 20 --y 8  --width 56 --height 64 --color "$TUNNEL"
d fill-rect --x 24 --y 6  --width 48 --height 8  --color '#241d16'   # earthy lip
d fill-rect --x 26 --y 22 --width 44 --height 20 --color '#0c0f13'
d fill-rect --x 28 --y 40 --width 40 --height 32 --color '#05070a'   # deepening black
# steel headframe (a small pit-head gantry over the mouth)
d fill-rect --x 18 --y 4 --width 6  --height 66 --color "$MET_M"     # left post
d fill-rect --x 72 --y 4 --width 6  --height 66 --color "$MET_M"     # right post
d fill-rect --x 18 --y 4 --width 6  --height 2  --color "$MET_L"
d fill-rect --x 72 --y 4 --width 6  --height 2  --color "$MET_L"
d fill-rect --x 16 --y 0 --width 64 --height 6  --color "$MET_D"     # head beam
d fill-rect --x 16 --y 0 --width 64 --height 2  --color "$MET_M"
d fill-rect --x 16 --y 5 --width 64 --height 1  --color "$MET_XD"
# cross-bracing on the posts
d line --x0 20 --y0 12 --x1 22 --y1 30 --color "$MET_L"
d line --x0 76 --y0 12 --x1 74 --y1 30 --color "$MET_L"
# hazard chevrons on the head beam
for x in 22 34 46 58 70; do d fill-rect --x "$x" --y 1 --width 5 --height 3 --color "$FUEL"; done
# a ladder descending into the dark (rails + rungs)
d fill-rect --x 40 --y 10 --width 2 --height 60 --color "$MET_L"
d fill-rect --x 54 --y 10 --width 2 --height 60 --color "$MET_L"
for y in 16 24 32 40 48 56; do d fill-rect --x 40 --y "$y" --width 16 --height 2 --color "$MET_D"; done
# rubble at the lip
for xy in "24 10" "68 10" "30 12 " "62 14" "48 8"; do
  set -- $xy; d fill-rect --x "$1" --y "$2" --width 3 --height 2 --color "$GROUND_D"
done

# ============================ FUEL DEPOT (refuel / repair) ======================
# REFUEL + REPAIR, free (specs/world.md/flow.md). A squat fuel tank with a fuel-yellow band
# and a level gauge, a pump housing with a coiled hose + nozzle, and a fuel-drop emblem — it
# should read "fuel" at a glance. 72×88, standing on the ground at the bottom.
newsprite 72 88 "$SURF/fuel-depot.png"
d fill-rect --x 4 --y 82 --width 64 --height 6 --color "$MET_XD"     # concrete footing
# --- the storage tank (left) ---
d fill-rect --x 8  --y 20 --width 34 --height 62 --color "$MET_M"    # tank body
d fill-rect --x 8  --y 20 --width 4  --height 62 --color "$MET_L"    # left sheen
d fill-rect --x 38 --y 20 --width 4  --height 62 --color "$MET_D"    # right shade
d fill-circle --cx 25 --cy 20 --r 17 --color "$MET_M"               # domed top
d fill-circle --cx 20 --cy 15 --r 8  --color "$MET_L"               # dome sheen
d fill-rect --x 8 --y 20 --width 34 --height 2 --color "$MET_HL"     # top rim
d fill-rect --x 22 --y 4 --width 6 --height 8 --color "$MET_D"       # fill cap / vent
d fill-rect --x 22 --y 4 --width 6 --height 2 --color "$MET_L"
# fuel-yellow hazard band + level gauge
d fill-rect --x 8 --y 40 --width 34 --height 8 --color "$FUEL"
d fill-rect --x 8 --y 40 --width 34 --height 1 --color '#fff0b0'
d fill-rect --x 8 --y 47 --width 34 --height 1 --color "$RUST_L"
d fill-rect --x 12 --y 54 --width 6 --height 22 --color "$MET_XD"    # gauge tube
d fill-rect --x 13 --y 62 --width 4 --height 13 --color "$FUEL"      # fuel level
d fill-rect --x 13 --y 62 --width 4 --height 1  --color '#fff0b0'
# fuel-drop emblem on the tank
d fill-circle --cx 31 --cy 66 --r 5 --color "$FUEL"
d fill-rect   --x 30 --y 57 --width 2 --height 6 --color "$FUEL"
d fill-circle --cx 29 --cy 64 --r 1 --color '#fff0b0'
# rivets down the seam
for y in 26 38 54 70; do d set-pixel --x 40 --y "$y" --color "$MET_HL"; done
# --- the pump housing (right) ---
d fill-rect --x 46 --y 44 --width 22 --height 38 --color "$MET_D"    # pump body
d fill-rect --x 46 --y 44 --width 22 --height 3  --color "$MET_M"
d fill-rect --x 49 --y 48 --width 16 --height 10 --color "$MET_XD"   # display recess
d fill-rect --x 51 --y 50 --width 12 --height 6  --color "$FUEL"     # lit readout
d fill-rect --x 52 --y 52 --width 3 --height 2 --color "$MET_XD"
d fill-rect --x 57 --y 52 --width 3 --height 2 --color "$MET_XD"
# coiled hose + nozzle hung on the pump
d line --x0 46 --y0 64 --x1 40 --y1 68 --color "$MET_XD"
d line --x0 40 --y0 68 --x1 44 --y1 74 --color "$MET_XD"
d line --x0 44 --y0 74 --x1 50 --y1 72 --color "$MET_XD"
d fill-rect --x 62 --y 62 --width 4 --height 10 --color "$MET_L"     # nozzle holster
d fill-rect --x 63 --y 60 --width 2 --height 4  --color "$FUEL"

# ============================ ORE MARKET (sell ore) ============================
# SELL cargo for Credits (specs/flow.md/mining.md). A trading stall: a slanted awning on
# posts, a counter, crates of ore (ferron-brown with a glint), a balance scale, and a stack
# of Credits — reads as "sell your ore here". 80×88.
newsprite 80 88 "$SURF/ore-market.png"
d fill-rect --x 6 --y 82 --width 68 --height 6 --color "$MET_XD"     # footing
# support posts
d fill-rect --x 8  --y 24 --width 5 --height 58 --color "$MET_D"
d fill-rect --x 67 --y 24 --width 5 --height 58 --color "$MET_D"
d fill-rect --x 8  --y 24 --width 5 --height 2  --color "$MET_M"
d fill-rect --x 67 --y 24 --width 5 --height 2  --color "$MET_M"
# slanted awning (a lean-to roof, ferron-brown canvas over a steel ridge)
d fill-rect --x 4 --y 18 --width 72 --height 6 --color "$MET_M"      # ridge beam
d fill-rect --x 4 --y 18 --width 72 --height 2 --color "$MET_L"
for i in 0 1 2 3 4 5; do                                              # striped awning
  x=$(( 6 + i * 12 ))
  d fill-rect --x "$x" --y 24 --width 6 --height 5 --color "$FERRON"
  d fill-rect --x $(( x + 6 )) --y 24 --width 6 --height 5 --color '#8a5a34'
done
d fill-rect --x 4 --y 28 --width 72 --height 2 --color "$RUST_D"     # awning fringe
# the counter
d fill-rect --x 10 --y 60 --width 60 --height 8 --color "$MET_D"
d fill-rect --x 10 --y 60 --width 60 --height 2 --color "$MET_L"
d fill-rect --x 10 --y 68 --width 60 --height 4 --color "$MET_XD"
# ore crates on the counter (ferron ore with glints)
d fill-rect --x 14 --y 44 --width 16 --height 16 --color "$RUST_D"   # crate 1
d fill-rect --x 14 --y 44 --width 16 --height 2  --color '#6a4526'
d fill-rect --x 16 --y 46 --width 12 --height 12 --color "$FERRON"
d set-pixel --x 20 --y 49 --color '#e0a878'
d set-pixel --x 24 --y 53 --color '#e0a878'
d fill-rect --x 34 --y 50 --width 12 --height 10 --color "$RUST_D"   # crate 2 (smaller)
d fill-rect --x 36 --y 52 --width 8  --height 6  --color "$FERRON"
d set-pixel --x 39 --y 54 --color '#e0a878'
# a balance scale on the right of the counter
d fill-rect --x 56 --y 40 --width 2 --height 20 --color "$MET_L"     # scale post
d fill-rect --x 50 --y 40 --width 14 --height 2 --color "$MET_L"     # beam
d line --x0 51 --y0 41 --x1 51 --y1 47 --color "$TXT3"               # left chains
d line --x0 62 --y0 41 --x1 62 --y1 47 --color "$TXT3"
d fill-rect --x 48 --y 47 --width 7 --height 2 --color "$MET_M"      # left pan
d fill-rect --x 59 --y 45 --width 7 --height 2 --color "$MET_M"      # right pan (higher)
# a small stack of Credits by the scale
d fill-circle --cx 40 --cy 74 --r 3 --color "$CREDITS"
d fill-circle --cx 45 --cy 75 --r 3 --color "$CREDITS"
d set-pixel --x 39 --y 73 --color '#fff0b0'

# ============================ UPGRADE SHOP (buy upgrades) ======================
# BUY upgrade tiers (specs/upgrades.md). A fabricator hut: a peaked steel roof, a lit
# workbench window, and a big gear crossed with a wrench — the universal "upgrades / repairs"
# read — with a spark of hull-cyan tech light. 80×88.
newsprite 80 88 "$SURF/upgrade-shop.png"
d fill-rect --x 6 --y 82 --width 68 --height 6 --color "$MET_XD"     # footing
# hut walls
d fill-rect --x 10 --y 34 --width 60 --height 48 --color "$MET_D"
d fill-rect --x 10 --y 34 --width 4  --height 48 --color "$MET_M"    # left sheen
d fill-rect --x 66 --y 34 --width 4  --height 48 --color "$MET_XD"   # right shade
# peaked roof
d line --x0 8  --y0 34 --x1 40 --y1 12 --color "$MET_L"
d line --x0 72 --y0 34 --x1 40 --y1 12 --color "$MET_L"
d fill-rect --x 8 --y 32 --width 64 --height 4 --color "$MET_M"      # eave beam
d fill-rect --x 8 --y 32 --width 64 --height 1 --color "$MET_HL"
d fill-circle --cx 40 --cy 14 --r 2 --color "$HULL"                  # ridge lamp
# lit workbench window
d fill-rect --x 16 --y 40 --width 18 --height 14 --color "$MET_XD"
d fill-rect --x 18 --y 42 --width 14 --height 10 --color '#243038'
d fill-rect --x 18 --y 42 --width 14 --height 4  --color "$HULL"     # cyan work-glow
d set-pixel --x 20 --y 44 --color "$WHITE"
d set-pixel --x 27 --y 45 --color "$WHITE"
# the big gear (right)
d fill-circle --cx 54 --cy 56 --r 12 --color "$MET_M"
d fill-circle --cx 54 --cy 56 --r 12 --color "$MET_M"
for t in "54 42" "54 70" "42 56" "66 56" "45 47" "63 47" "45 65" "63 65"; do
  set -- $t; d fill-rect --x $(( $1 - 2 )) --y $(( $2 - 2 )) --width 4 --height 4 --color "$MET_M"
done
d fill-circle --cx 54 --cy 56 --r 9 --color "$MET_L"
d fill-circle --cx 54 --cy 56 --r 4 --color "$MET_XD"                # hub bore
d fill-circle --cx 54 --cy 56 --r 2 --color "$HULL"
# crossed wrench over the gear
d line --x0 44 --y0 66 --x1 64 --y1 46 --color "$MET_HL"
d line --x0 44 --y0 65 --x1 63 --y1 46 --color "$MET_L"
d fill-circle --cx 44 --cy 66 --r 2 --color "$MET_HL"                # wrench jaw
d fill-rect   --x 43 --y 64 --width 2 --height 2 --color "$MET_XD"
d fill-circle --cx 64 --cy 46 --r 2 --color "$MET_HL"
# tool rack on the left wall
for x in 16 20 24; do d fill-rect --x "$x" --y 60 --width 1 --height 16 --color "$MET_L"; done
d fill-rect --x 15 --y 60 --width 11 --height 2 --color "$MET_M"

# ============================ LAUNCH PAD (the rocket base) =====================
# The derelict launch platform the escape rocket is built on (specs/world.md/rocket.md).
# This is the BASE structure only — a raised octagonal pad with a flame trench, a lattice
# gantry tower, cabling and hazard stripes, and an empty central cradle. The rocket stages
# (below) are drawn as a SEPARATE sprite stacked over this cradle. 96×96.
newsprite 96 96 "$SURF/launch-pad.png"
d fill-rect --x 2 --y 88 --width 92 --height 8 --color "$MET_XD"     # ground apron
# raised pad deck (trapezoid: wide base, narrower top → reads as a raised platform)
d fill-rect --x 10 --y 76 --width 76 --height 14 --color "$MET_D"    # pad skirt
d fill-rect --x 16 --y 68 --width 64 --height 10 --color "$MET_M"    # deck
d fill-rect --x 16 --y 68 --width 64 --height 2  --color "$MET_L"    # deck lip
d fill-rect --x 10 --y 88 --width 76 --height 2  --color "$MET_XD"
# flame trench (dark slot under the cradle)
d fill-rect --x 38 --y 78 --width 20 --height 10 --color "$TUNNEL"
d fill-rect --x 40 --y 80 --width 16 --height 6  --color '#05070a'
# central cradle / hold-down clamps (where the rocket sits)
d fill-rect --x 34 --y 64 --width 6 --height 8 --color "$MET_L"
d fill-rect --x 56 --y 64 --width 6 --height 8 --color "$MET_L"
d fill-rect --x 34 --y 64 --width 6 --height 2 --color "$MET_HL"
d fill-rect --x 56 --y 64 --width 6 --height 2 --color "$MET_HL"
# hazard stripes on the deck edge
for x in 18 26 34 62 70 78; do d fill-rect --x "$x" --y 70 --width 4 --height 3 --color "$FUEL"; done
# lattice gantry tower (right side)
d fill-rect --x 74 --y 8  --width 4 --height 68 --color "$MET_M"     # tower spine
d fill-rect --x 88 --y 8  --width 4 --height 68 --color "$MET_M"
d fill-rect --x 74 --y 8  --width 18 --height 3 --color "$MET_L"     # tower cap
for y in 16 26 36 46 56 66; do                                       # cross braces
  d line --x0 78 --y0 "$y" --x1 88 --y1 $(( y + 8 )) --color "$MET_D"
  d line --x0 88 --y0 "$y" --x1 78 --y1 $(( y + 8 )) --color "$MET_D"
  d fill-rect --x 74 --y "$y" --width 18 --height 1 --color "$MET_D"
done
d fill-circle --cx 83 --cy 6 --r 2 --color "$ALERT"                  # warning beacon
# swing-arm reaching toward the cradle + cabling to the deck
d fill-rect --x 62 --y 30 --width 14 --height 3 --color "$MET_L"
d line --x0 76 --y0 40 --x1 82 --y1 60 --color "$MET_XD"
d line --x0 82 --y0 60 --x1 78 --y1 74 --color "$MET_XD"
# a couple of ground cables snaking off the pad
d line --x0 16 --y0 82 --x1 6 --y1 88 --color "$MET_XD"
d line --x0 20 --y0 84 --x1 10 --y1 90 --color "$MET_XD"

# =========================================================================================
#  ESCAPE ROCKET — assembly stages 0..5 (draw-sheet; specs/rocket.md, ASSET-LAYOUT.md)
# =========================================================================================
# 64×128, symmetric about x=32. Every stage is drawn as its cumulative LEFT half (cols 0..31)
# and then `mirror-horizontal --axis-x 32` reflects it to a whole rocket — so a component
# added at stage N is present in every stage >= N. The engine stacks this over the launch
# pad's cradle; stage0 is the bare pad, stage5 is the lit, launch-ready rocket.
#
# The five installed components (build order, specs/rocket.md):
#   stage1  Hull Frame        — the skeletal steel body (struts, no skin)
#   stage2  Fuel Cells        — the body skinned + fuel-yellow tank cells fill the midriff
#   stage3  Guidance Unit     — the nose cone + guidance fins, resonite-blue avionics light
#   stage4  Thruster Assembly — the engine bell/nozzle cluster at the base, cryenite-violet
#   stage5  Ignition Core     — the core installed + lit: hot core-glow, launch-ready lamps
#
# Left-half layer helpers (each takes the frame index; draw only cols 0..32, mirror does 32..63).
newsheet 64 128 "$ROCK" "stage"

rk_pad() {   # the mounting deck + hold-down clamps every stage stands on (left half)
  local f=$1
  s fill-rect --frame "$f" --x 6  --y 116 --width 26 --height 8 --color "$MET_D"   # deck
  s fill-rect --frame "$f" --x 6  --y 116 --width 26 --height 2 --color "$MET_M"
  s fill-rect --frame "$f" --x 6  --y 122 --width 26 --height 4 --color "$MET_XD"
  s fill-rect --frame "$f" --x 18 --y 108 --width 6  --height 10 --color "$MET_L"  # clamp arm
  s fill-rect --frame "$f" --x 18 --y 108 --width 6  --height 2  --color "$MET_HL"
}
rk_frame() { # Hull Frame — the skeletal body outline: nose-to-base struts, ribs (left half)
  local f=$1
  s line --frame "$f" --x0 32 --y0 14 --x1 20 --y1 44 --color "$MET_L"    # nose taper strut
  s fill-rect --frame "$f" --x 18 --y 44 --width 3 --height 66 --color "$MET_M"  # outer longeron
  s fill-rect --frame "$f" --x 18 --y 44 --width 1 --height 66 --color "$MET_L"
  s fill-rect --frame "$f" --x 28 --y 14 --width 4 --height 96 --color "$MET_M"  # spine (at axis)
  s fill-rect --frame "$f" --x 28 --y 14 --width 1 --height 96 --color "$MET_L"
  for y in 52 62 72 82 92 102; do                                        # ladder ribs
    s fill-rect --frame "$f" --x 18 --y "$y" --width 14 --height 2 --color "$MET_D"
  done
  s fill-rect --frame "$f" --x 18 --y 108 --width 14 --height 3 --color "$MET_D"  # base ring
}
rk_fuelcells() { # Fuel Cells — skin the body + fuel-yellow tank cells fill the midriff (left)
  local f=$1
  s fill-rect --frame "$f" --x 20 --y 46 --width 12 --height 62 --color "$MET_M" # skinned hull
  s fill-rect --frame "$f" --x 20 --y 46 --width 3  --height 62 --color "$MET_L" # left sheen
  s fill-rect --frame "$f" --x 20 --y 46 --width 12 --height 2  --color "$MET_HL"
  s fill-rect --frame "$f" --x 22 --y 60 --width 8 --height 34 --color "$MET_XD" # cell recess
  for y in 62 74 86; do                                                  # stacked fuel cells
    s fill-rect --frame "$f" --x 23 --y "$y" --width 6 --height 8 --color "$FUEL"
    s fill-rect --frame "$f" --x 23 --y "$y" --width 6 --height 1 --color '#fff0b0'
    s fill-rect --frame "$f" --x 23 --y $(( y + 7 )) --width 6 --height 1 --color "$RUST_L"
  done
  s fill-rect --frame "$f" --x 20 --y 104 --width 12 --height 4 --color "$MET_D" # base band
}
rk_guidance() { # Guidance Unit — pointed nose cone + upper guidance fin, avionics light (left)
  local f=$1
  s fill-rect --frame "$f" --x 26 --y 30 --width 6 --height 18 --color "$MET_L" # nose base
  s line --frame "$f" --x0 32 --y0 12 --x1 26 --y1 34 --color "$MET_HL"         # cone edge
  s fill-rect --frame "$f" --x 28 --y 20 --width 4 --height 24 --color "$MET_M" # cone body
  s fill-rect --frame "$f" --x 30 --y 14 --width 2 --height 8  --color "$MET_L" # cone tip
  s fill-circle --frame "$f" --cx 29 --cy 40 --r 2 --color "$RESONITE"          # avionics lamp
  s set-pixel --frame "$f" --x 29 --y 39 --color "$WHITE"
  # upper guidance canard fin
  s line --frame "$f" --x0 20 --y0 50 --x1 12 --y1 46 --color "$MET_L"
  s line --frame "$f" --x0 20 --y0 58 --x1 12 --y1 46 --color "$MET_M"
  s fill-rect --frame "$f" --x 14 --y 46 --width 6 --height 12 --color "$MET_M"
  s fill-rect --frame "$f" --x 14 --y 46 --width 6 --height 2  --color "$MET_L"
}
rk_thruster() { # Thruster Assembly — engine bell + lower fin at the base, cryenite accent (left)
  local f=$1
  s fill-rect --frame "$f" --x 22 --y 108 --width 10 --height 6 --color "$MET_D"  # engine mount
  s line --frame "$f" --x0 22 --y0 114 --x1 18 --y1 122 --color "$MET_M"          # bell flare
  s fill-rect --frame "$f" --x 18 --y 114 --width 14 --height 8 --color "$MET_M"  # bell body
  s fill-rect --frame "$f" --x 18 --y 114 --width 14 --height 2 --color "$MET_L"
  s fill-rect --frame "$f" --x 20 --y 120 --width 12 --height 3 --color "$MET_XD" # bell throat
  s fill-rect --frame "$f" --x 25 --y 110 --width 4 --height 12 --color "$CRYENITE" # plasma core
  s fill-rect --frame "$f" --x 26 --y 110 --width 2 --height 12 --color '#d6bcff'
  # lower stabilizer fin
  s line --frame "$f" --x0 20 --y0 96  --x1 10 --y1 110 --color "$MET_L"
  s line --frame "$f" --x0 20 --y0 108 --x1 10 --y1 110 --color "$MET_M"
  s fill-rect --frame "$f" --x 12 --y 100 --width 8 --height 12 --color "$MET_M"
  s fill-rect --frame "$f" --x 12 --y 100 --width 8 --height 2  --color "$MET_L"
}
rk_ignition() { # Ignition Core — the lit, launch-ready rocket: core glow + running lamps (left)
  local f=$1
  # hot core-glow up the spine (the installed, live Ignition Core)
  s fill-rect --frame "$f" --x 27 --y 48 --width 5 --height 58 --color "$COREGLOW"
  s fill-rect --frame "$f" --x 29 --y 48 --width 3 --height 58 --color "$CORE"
  s fill-rect --frame "$f" --x 30 --y 50 --width 2 --height 54 --color '#ffd9a0'
  s fill-circle --frame "$f" --cx 30 --cy 74 --r 4 --color "$FLAME"                # core heart
  s fill-circle --frame "$f" --cx 30 --cy 74 --r 2 --color '#ffe6c0'
  # engine ignition flare peeking from the bell
  s fill-circle --frame "$f" --cx 26 --cy 124 --r 5 --color "$FLAME"
  s fill-circle --frame "$f" --cx 27 --cy 123 --r 3 --color "$FUEL"
  s fill-circle --frame "$f" --cx 28 --cy 122 --r 1 --color '#fff0d0'
  # launch-ready running lamps up the hull
  for y in 56 72 88; do s set-pixel --frame "$f" --x 21 --y "$y" --color "$FUEL"; done
  s set-pixel --frame "$f" --x 30 --y 18 --color "$WHITE"                          # nose beacon
}

# stage0 = bare pad; each later stage is the cumulative left-half, then mirror to whole.
for f in 0 1 2 3 4 5; do
  rk_pad "$f"
  [ "$f" -ge 1 ] && rk_frame "$f"
  [ "$f" -ge 2 ] && rk_fuelcells "$f"
  [ "$f" -ge 3 ] && rk_guidance "$f"
  [ "$f" -ge 4 ] && rk_thruster "$f"
  [ "$f" -ge 5 ] && rk_ignition "$f"
  s mirror-horizontal --frame "$f" --axis-x 32
done

# =========================================================================================
#  HUD ICONS — 20×20 status-bar glyphs (specs/flow.md, ASSET-LAYOUT.md)
# =========================================================================================
# Small, high-contrast marks the in-code status bar draws beside its gauges/readouts. Each
# is a single `draw` sprite on a transparent canvas in its gauge's palette colour.
newicon() { newsprite 20 20 "$1"; }

# FUEL — a fuel drop / flame (fuel-yellow #ffcf4a)
newicon "$ICON/fuel.png"
d fill-circle --cx 10 --cy 13 --r 6 --color "$FUEL"        # drop bowl
d fill-rect   --x 9 --y 3 --width 2 --height 7 --color "$FUEL"  # drop tail
d line --x0 10 --y0 3 --x1 6 --y1 9 --color "$FUEL"
d line --x0 10 --y0 3 --x1 14 --y1 9 --color "$FUEL"
d flood-fill --x 10 --y 7 --color "$FUEL"
d fill-circle --cx 8 --cy 12 --r 2 --color '#fff0b0'       # highlight
d fill-circle --cx 11 --cy 14 --r 2 --color "$FLAME"       # inner flame

# HULL — a shield (hull-cyan #46d6e6)
newicon "$ICON/hull.png"
d fill-rect --x 4 --y 3 --width 12 --height 8 --color "$HULL"
d line --x0 4  --y0 11 --x1 10 --y1 17 --color "$HULL"
d line --x0 16 --y0 11 --x1 10 --y1 17 --color "$HULL"
d flood-fill --x 10 --y 9 --color "$HULL"
d fill-rect --x 9 --y 5 --width 2 --height 9 --color '#bff2f8'  # crest bar
d fill-rect --x 6 --y 8 --width 8 --height 2 --color '#bff2f8'  # crest cross
d fill-rect --x 4 --y 3 --width 12 --height 1 --color '#2a9aa8' # rim shade

# CARGO — a crate/box (cargo-brown #c48a52)
newicon "$ICON/cargo.png"
d fill-rect   --x 3 --y 5 --width 14 --height 12 --color "$CARGO"
d stroke-rect --x 3 --y 5 --width 14 --height 12 --color '#8a5f38'
d line --x0 3 --y0 5  --x1 17 --y1 17 --color '#e0aa74'    # cross-slat (bright)
d line --x0 17 --y0 5 --x1 3  --y1 17 --color '#8a5f38'    # cross-slat (shade)
d fill-rect --x 3 --y 5 --width 14 --height 2 --color '#e0aa74'  # lid highlight

# CREDITS — a coin (credits-gold #ffd23a)
newicon "$ICON/credits.png"
d fill-circle --cx 10 --cy 10 --r 8 --color '#b8901f'
d fill-circle --cx 10 --cy 10 --r 7 --color "$CREDITS"
d fill-circle --cx 8 --cy 8 --r 3 --color '#fff0b0'       # sheen
d fill-rect --x 9 --y 6 --width 2 --height 8 --color '#8a6a14'  # engraved mark
d fill-rect --x 7 --y 9 --width 6 --height 2 --color '#8a6a14'

# DEPTH — a solid downward arrow (secondary grey with a hull-cyan core), meaning "down"
newicon "$ICON/depth.png"
d fill-rect --x 8 --y 2 --width 4 --height 8 --color "$TXT2"    # shaft
# filled arrowhead: stacked shrinking rows → a clean solid triangle pointing DOWN (no flood)
d fill-rect --x 4  --y 10 --width 13 --height 1 --color "$TXT2"
d fill-rect --x 5  --y 11 --width 11 --height 1 --color "$TXT2"
d fill-rect --x 6  --y 12 --width 9  --height 1 --color "$TXT2"
d fill-rect --x 7  --y 13 --width 7  --height 1 --color "$TXT2"
d fill-rect --x 8  --y 14 --width 5  --height 1 --color "$TXT2"
d fill-rect --x 9  --y 15 --width 3  --height 1 --color "$TXT2"
d set-pixel --x 10 --y 16 --color "$TXT2"
d fill-rect --x 9 --y 2 --width 2 --height 8 --color "$HULL"    # cyan core line on the shaft
d fill-rect --x 9 --y 10 --width 2 --height 3 --color '#bff2f8' # bright head core
for y in 4 7; do d set-pixel --x 3 --y "$y" --color "$TXT3"; d set-pixel --x 16 --y "$y" --color "$TXT3"; done  # depth ticks

# RESONITE — a blue crystal shard (#4ad0ff)
newicon "$ICON/resonite.png"
d line --x0 10 --y0 2  --x1 4  --y1 9  --color "$RESONITE"      # facet outline
d line --x0 10 --y0 2  --x1 16 --y1 9  --color "$RESONITE"
d line --x0 4  --y0 9  --x1 10 --y1 18 --color "$RESONITE"
d line --x0 16 --y0 9  --x1 10 --y1 18 --color "$RESONITE"
d flood-fill --x 10 --y 9 --color "$RESONITE"
d line --x0 10 --y0 2 --x1 10 --y1 18 --color '#bff0ff'        # centre ridge (bright)
d line --x0 4 --y0 9 --x1 16 --y1 9 --color '#2f9fd0'          # facet break (shade)
d set-pixel --x 8 --y 6 --color "$WHITE"                        # glint

# CRYENITE — a violet crystal shard (#b98cff)
newicon "$ICON/cryenite.png"
d line --x0 10 --y0 2  --x1 4  --y1 9  --color "$CRYENITE"
d line --x0 10 --y0 2  --x1 16 --y1 9  --color "$CRYENITE"
d line --x0 4  --y0 9  --x1 10 --y1 18 --color "$CRYENITE"
d line --x0 16 --y0 9  --x1 10 --y1 18 --color "$CRYENITE"
d flood-fill --x 10 --y 9 --color "$CRYENITE"
d line --x0 10 --y0 2 --x1 10 --y1 18 --color '#e0ccff'
d line --x0 4 --y0 9 --x1 16 --y1 9 --color '#8a5cd0'
d set-pixel --x 8 --y 6 --color "$WHITE"

echo "produced Deepcore surface + rocket + HUD-icon assets:"
echo "  $SURF/{sky,ground,cave-mouth,fuel-depot,ore-market,upgrade-shop,launch-pad}.png"
echo "  $ROCK/stage0..stage5.png"
echo "  $ICON/{fuel,hull,cargo,credits,depth,resonite,cryenite}.png"
