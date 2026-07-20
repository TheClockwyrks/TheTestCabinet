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
#       save-pad.png     a lit checkpoint dais the miner stands on to save the expedition
#       upgrade-shop.png BUY upgrades — a fabricator hut with a gear + crossed wrench
#       supply-depot.png BUY field supplies — a supply container w/ explosives + med/fuel crate
#       launch-pad.png   the derelict launch platform (base only; the rocket is separate)
#
#   • assets/rocket/stage0..stage5.png — the escape rocket as a 6-frame `draw-sheet`
#     assembly ladder (specs/rocket.md): bare pad → +Hull Frame → +Fuel Cells →
#     +Guidance Unit → +Thruster Assembly → +Ignition Core (lit, launch-ready). The
#     rocket VISIBLY gains each installed component; the engine selects the stage by how
#     many of the five components are installed. Every stage is the SAME 96×160 canvas so
#     the renderer stacks it over launch-pad.png at a fixed offset.
#
# NATIVE SIZES (tile size is 80px): the six buildings are 112×132, the cave mouth is a
# wide, short 120×48 opening in the camp floor, and each rocket-assembly stage is 96×160.
# These are authored crisp at native size (no upscaling). The HUD icons stay 20×20 and the
# unused sky/ground strips are left as-is.
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
# The shored opening in the camp floor down into row 1 (specs/world.md). NATIVE 120×48 —
# a WIDE, SHORT cave opening: ground shoulders left/right, a dark maw fading to tunnel-black
# framed by a steel headbeam + side posts with hazard chevrons, a short ladder-top peeking
# into the dark, and rubble at the lip so it clearly reads "down". Straight alpha above.
newsprite 120 48 "$SURF/cave-mouth.png"
# ground shoulders on each side of the mouth
d fill-rect --x 0  --y 0 --width 28 --height 48 --color "$GROUND"
d fill-rect --x 92 --y 0 --width 28 --height 48 --color "$GROUND"
d fill-rect --x 0  --y 0 --width 28 --height 3  --color "$GROUND_L"
d fill-rect --x 92 --y 0 --width 28 --height 3  --color "$GROUND_L"
# the wide maw: dark throat fading down
d fill-rect --x 30 --y 2  --width 60 --height 8  --color '#241d16'   # earthy lip
d fill-rect --x 30 --y 8  --width 60 --height 40 --color "$TUNNEL"
d fill-rect --x 36 --y 16 --width 48 --height 32 --color '#0c0f13'
d fill-rect --x 44 --y 26 --width 32 --height 22 --color '#05070a'   # deepening black
# steel headframe (a wide pit-head beam + side posts over the mouth)
d fill-rect --x 26 --y 4 --width 5  --height 44 --color "$MET_M"     # left post
d fill-rect --x 89 --y 4 --width 5  --height 44 --color "$MET_M"     # right post
d fill-rect --x 26 --y 4 --width 5  --height 2  --color "$MET_L"
d fill-rect --x 89 --y 4 --width 5  --height 2  --color "$MET_L"
d fill-rect --x 24 --y 0 --width 72 --height 7  --color "$MET_D"     # head beam
d fill-rect --x 24 --y 0 --width 72 --height 2  --color "$MET_M"
d fill-rect --x 24 --y 6 --width 72 --height 1  --color "$MET_XD"
# cross-bracing angling in from the posts
d line --x0 30 --y0 10 --x1 34 --y1 30 --color "$MET_L"
d line --x0 90 --y0 10 --x1 86 --y1 30 --color "$MET_L"
# hazard chevrons on the head beam
for x in 28 40 52 64 76 88; do d fill-rect --x "$x" --y 1 --width 6 --height 4 --color "$FUEL"; done
# a short ladder-top descending into the dark (rails + rungs)
d fill-rect --x 56 --y 10 --width 2 --height 34 --color "$MET_L"
d fill-rect --x 64 --y 10 --width 2 --height 34 --color "$MET_L"
for y in 16 24 32 40; do d fill-rect --x 56 --y "$y" --width 10 --height 2 --color "$MET_D"; done
# rubble at the lip
for xy in "30 8" "84 8" "38 12" "80 14" "60 6"; do
  set -- $xy; d fill-rect --x "$1" --y "$2" --width 4 --height 3 --color "$GROUND_D"
done

# ============================ FUEL DEPOT (refuel / repair) ======================
# REFUEL + REPAIR, free (specs/world.md/flow.md). A squat fuel tank with a fuel-yellow band
# and a level gauge, a pump housing with a coiled hose + nozzle, and a fuel-drop emblem — it
# should read "fuel" at a glance. 112×132, standing on the ground at the bottom.
newsprite 112 132 "$SURF/fuel-depot.png"
d fill-rect --x 6 --y 123 --width 100 --height 9 --color "$MET_XD"   # concrete footing
# --- the storage tank (left) ---
d fill-rect --x 12 --y 30 --width 53 --height 93 --color "$MET_M"    # tank body
d fill-rect --x 12 --y 30 --width 6  --height 93 --color "$MET_L"    # left sheen
d fill-rect --x 59 --y 30 --width 6  --height 93 --color "$MET_D"    # right shade
d fill-circle --cx 39 --cy 30 --r 26 --color "$MET_M"               # domed top
d fill-circle --cx 31 --cy 22 --r 12 --color "$MET_L"               # dome sheen
d fill-rect --x 12 --y 30 --width 53 --height 3 --color "$MET_HL"    # top rim
d fill-rect --x 34 --y 6 --width 9 --height 12 --color "$MET_D"      # fill cap / vent
d fill-rect --x 34 --y 6 --width 9 --height 3 --color "$MET_L"
# fuel-yellow hazard band + level gauge
d fill-rect --x 12 --y 60 --width 53 --height 12 --color "$FUEL"
d fill-rect --x 12 --y 60 --width 53 --height 2 --color '#fff0b0'
d fill-rect --x 12 --y 70 --width 53 --height 2 --color "$RUST_L"
d fill-rect --x 19 --y 81 --width 9 --height 33 --color "$MET_XD"    # gauge tube
d fill-rect --x 20 --y 93 --width 6 --height 20 --color "$FUEL"      # fuel level
d fill-rect --x 20 --y 93 --width 6 --height 2  --color '#fff0b0'
# fuel-drop emblem on the tank
d fill-circle --cx 48 --cy 99 --r 8 --color "$FUEL"
d fill-rect   --x 47 --y 85 --width 3 --height 9 --color "$FUEL"
d fill-circle --cx 45 --cy 96 --r 2 --color '#fff0b0'
# rivets down the seam
for y in 39 57 81 105; do d fill-rect --x 61 --y "$y" --width 2 --height 2 --color "$MET_HL"; done
# --- the pump housing (right) ---
d fill-rect --x 72 --y 66 --width 34 --height 57 --color "$MET_D"    # pump body
d fill-rect --x 72 --y 66 --width 34 --height 5  --color "$MET_M"
d fill-rect --x 76 --y 72 --width 25 --height 15 --color "$MET_XD"   # display recess
d fill-rect --x 79 --y 75 --width 19 --height 9  --color "$FUEL"     # lit readout
d fill-rect --x 81 --y 78 --width 5 --height 3 --color "$MET_XD"
d fill-rect --x 89 --y 78 --width 5 --height 3 --color "$MET_XD"
# coiled hose + nozzle hung on the pump
d line --x0 72 --y0 96  --x1 62 --y1 102 --color "$MET_XD"
d line --x0 72 --y0 97  --x1 62 --y1 103 --color "$MET_XD"
d line --x0 62 --y0 102 --x1 68 --y1 111 --color "$MET_XD"
d line --x0 63 --y0 102 --x1 69 --y1 111 --color "$MET_XD"
d line --x0 68 --y0 111 --x1 78 --y1 108 --color "$MET_XD"
d fill-rect --x 96 --y 93 --width 6 --height 15 --color "$MET_L"     # nozzle holster
d fill-rect --x 98 --y 90 --width 3 --height 6  --color "$FUEL"

# ============================ ORE MARKET (sell ore) ============================
# SELL cargo for Credits (specs/flow.md/mining.md). A trading stall: a slanted awning on
# posts, a counter, crates of ore (ferron-brown with a glint), a balance scale, and a stack
# of Credits — reads as "sell your ore here". 112×132.
newsprite 112 132 "$SURF/ore-market.png"
d fill-rect --x 8 --y 123 --width 95 --height 9 --color "$MET_XD"    # footing
# support posts
d fill-rect --x 11 --y 36 --width 7 --height 87 --color "$MET_D"
d fill-rect --x 94 --y 36 --width 7 --height 87 --color "$MET_D"
d fill-rect --x 11 --y 36 --width 7 --height 3  --color "$MET_M"
d fill-rect --x 94 --y 36 --width 7 --height 3  --color "$MET_M"
# slanted awning (a lean-to roof, ferron-brown canvas over a steel ridge)
d fill-rect --x 6 --y 27 --width 101 --height 9 --color "$MET_M"     # ridge beam
d fill-rect --x 6 --y 27 --width 101 --height 3 --color "$MET_L"
for i in 0 1 2 3 4 5; do                                              # striped awning
  x=$(( 8 + i * 16 ))
  d fill-rect --x "$x" --y 36 --width 8 --height 8 --color "$FERRON"
  d fill-rect --x $(( x + 8 )) --y 36 --width 8 --height 8 --color '#8a5a34'
done
d fill-rect --x 6 --y 42 --width 101 --height 3 --color "$RUST_D"    # awning fringe
# the counter
d fill-rect --x 14 --y 90 --width 84 --height 12 --color "$MET_D"
d fill-rect --x 14 --y 90 --width 84 --height 3  --color "$MET_L"
d fill-rect --x 14 --y 102 --width 84 --height 6 --color "$MET_XD"
# ore crates on the counter (ferron ore with glints)
d fill-rect --x 20 --y 66 --width 22 --height 24 --color "$RUST_D"   # crate 1
d fill-rect --x 20 --y 66 --width 22 --height 3  --color '#6a4526'
d fill-rect --x 22 --y 69 --width 17 --height 18 --color "$FERRON"
d fill-rect --x 28 --y 73 --width 2 --height 2 --color '#e0a878'
d fill-rect --x 34 --y 79 --width 2 --height 2 --color '#e0a878'
d fill-rect --x 48 --y 75 --width 17 --height 15 --color "$RUST_D"   # crate 2 (smaller)
d fill-rect --x 50 --y 78 --width 11 --height 9  --color "$FERRON"
d fill-rect --x 55 --y 81 --width 2 --height 2 --color '#e0a878'
# a balance scale on the right of the counter
d fill-rect --x 78 --y 60 --width 3 --height 30 --color "$MET_L"     # scale post
d fill-rect --x 70 --y 60 --width 20 --height 3 --color "$MET_L"     # beam
d line --x0 71 --y0 61 --x1 71 --y1 70 --color "$TXT3"               # left chains
d line --x0 87 --y0 61 --x1 87 --y1 70 --color "$TXT3"
d fill-rect --x 67 --y 70 --width 10 --height 3 --color "$MET_M"     # left pan
d fill-rect --x 83 --y 67 --width 10 --height 3 --color "$MET_M"     # right pan (higher)
# a small stack of Credits by the scale
d fill-circle --cx 56 --cy 111 --r 4 --color "$CREDITS"
d fill-circle --cx 63 --cy 112 --r 4 --color "$CREDITS"
d fill-rect --x 54 --y 109 --width 2 --height 2 --color '#fff0b0'

# ============================ UPGRADE SHOP (buy upgrades) ======================
# BUY upgrade tiers (specs/upgrades.md). A fabricator hut: a peaked steel roof, a lit
# workbench window, and a big gear crossed with a wrench — the universal "upgrades / repairs"
# read — with a spark of hull-cyan tech light. 112×132.
newsprite 112 132 "$SURF/upgrade-shop.png"
d fill-rect --x 8 --y 123 --width 95 --height 9 --color "$MET_XD"    # footing
# hut walls
d fill-rect --x 14 --y 51 --width 84 --height 72 --color "$MET_D"
d fill-rect --x 14 --y 51 --width 6  --height 72 --color "$MET_M"    # left sheen
d fill-rect --x 92 --y 51 --width 6  --height 72 --color "$MET_XD"   # right shade
# peaked roof
d line --x0 11  --y0 51 --x1 56 --y1 18 --color "$MET_L"
d line --x0 101 --y0 51 --x1 56 --y1 18 --color "$MET_L"
d fill-rect --x 11 --y 48 --width 90 --height 6 --color "$MET_M"     # eave beam
d fill-rect --x 11 --y 48 --width 90 --height 2 --color "$MET_HL"
d fill-circle --cx 56 --cy 21 --r 3 --color "$HULL"                  # ridge lamp
# lit workbench window
d fill-rect --x 22 --y 60 --width 25 --height 21 --color "$MET_XD"
d fill-rect --x 25 --y 63 --width 20 --height 15 --color '#243038'
d fill-rect --x 25 --y 63 --width 20 --height 6  --color "$HULL"     # cyan work-glow
d fill-rect --x 28 --y 66 --width 2 --height 2 --color "$WHITE"
d fill-rect --x 38 --y 68 --width 2 --height 2 --color "$WHITE"
# the big gear (right)
d fill-circle --cx 76 --cy 84 --r 17 --color "$MET_M"
for t in "76 63" "76 105" "59 84" "92 84" "63 71" "88 71" "63 98" "88 98"; do
  set -- $t; d fill-rect --x $(( $1 - 3 )) --y $(( $2 - 3 )) --width 6 --height 6 --color "$MET_M"
done
d fill-circle --cx 76 --cy 84 --r 13 --color "$MET_L"
d fill-circle --cx 76 --cy 84 --r 6 --color "$MET_XD"                # hub bore
d fill-circle --cx 76 --cy 84 --r 3 --color "$HULL"
# crossed wrench over the gear
d line --x0 62 --y0 99 --x1 90 --y1 69 --color "$MET_HL"
d line --x0 62 --y0 98 --x1 88 --y1 69 --color "$MET_L"
d fill-circle --cx 62 --cy 99 --r 3 --color "$MET_HL"                # wrench jaw
d fill-rect   --x 60 --y 96 --width 3 --height 3 --color "$MET_XD"
d fill-circle --cx 90 --cy 69 --r 3 --color "$MET_HL"
# tool rack on the left wall
for x in 22 28 34; do d fill-rect --x "$x" --y 90 --width 2 --height 24 --color "$MET_L"; done
d fill-rect --x 21 --y 90 --width 15 --height 3 --color "$MET_M"

# ============================ LAUNCH PAD (the rocket base) =====================
# The derelict launch platform the escape rocket is built on (specs/world.md/rocket.md).
# This is the BASE structure only — a raised octagonal pad with a flame trench, a lattice
# gantry tower, cabling and hazard stripes, and an empty central cradle. The rocket stages
# (below) are drawn as a SEPARATE sprite stacked over this cradle. 112×132.
newsprite 112 132 "$SURF/launch-pad.png"
d fill-rect --x 2 --y 121 --width 107 --height 11 --color "$MET_XD"  # ground apron
# raised pad deck (trapezoid: wide base, narrower top → reads as a raised platform)
d fill-rect --x 12 --y 105 --width 89 --height 19 --color "$MET_D"   # pad skirt
d fill-rect --x 19 --y 94  --width 75 --height 14 --color "$MET_M"   # deck
d fill-rect --x 19 --y 94  --width 75 --height 3  --color "$MET_L"   # deck lip
d fill-rect --x 12 --y 121 --width 89 --height 3  --color "$MET_XD"
# flame trench (dark slot under the cradle)
d fill-rect --x 44 --y 107 --width 23 --height 14 --color "$TUNNEL"
d fill-rect --x 47 --y 110 --width 19 --height 8  --color '#05070a'
# central cradle / hold-down clamps (where the rocket sits)
d fill-rect --x 40 --y 88 --width 7 --height 11 --color "$MET_L"
d fill-rect --x 65 --y 88 --width 7 --height 11 --color "$MET_L"
d fill-rect --x 40 --y 88 --width 7 --height 3 --color "$MET_HL"
d fill-rect --x 65 --y 88 --width 7 --height 3 --color "$MET_HL"
# hazard stripes on the deck edge
for x in 21 30 40 72 82 91; do d fill-rect --x "$x" --y 96 --width 5 --height 4 --color "$FUEL"; done
# lattice gantry tower (right side)
d fill-rect --x 86  --y 11 --width 5 --height 94 --color "$MET_M"    # tower spine
d fill-rect --x 103 --y 11 --width 5 --height 94 --color "$MET_M"
d fill-rect --x 86  --y 11 --width 22 --height 4 --color "$MET_L"    # tower cap
for y in 22 36 50 63 77 91; do                                       # cross braces
  d line --x0 91 --y0 "$y" --x1 103 --y1 $(( y + 11 )) --color "$MET_D"
  d line --x0 103 --y0 "$y" --x1 91 --y1 $(( y + 11 )) --color "$MET_D"
  d fill-rect --x 86 --y "$y" --width 22 --height 2 --color "$MET_D"
done
d fill-circle --cx 97 --cy 8 --r 3 --color "$ALERT"                  # warning beacon
# swing-arm reaching toward the cradle + cabling to the deck
d fill-rect --x 72 --y 41 --width 16 --height 4 --color "$MET_L"
d line --x0 89 --y0 55 --x1 96 --y1 83 --color "$MET_XD"
d line --x0 96 --y0 83 --x1 91 --y1 102 --color "$MET_XD"
# a couple of ground cables snaking off the pad
d line --x0 19 --y0 113 --x1 7  --y1 121 --color "$MET_XD"
d line --x0 23 --y0 116 --x1 12 --y1 124 --color "$MET_XD"

# ============================ SAVE PAD (bank the expedition) ===================
# The surface SAVE PAD (specs/flow.md): the only place the expedition can be saved. A raised
# checkpoint dais with a glowing resonite-cyan ring inset in it, a central data pylon carrying
# a lit save-disc emblem, and a beacon lamp — reads clearly as "stand here to save". 112×132.
newsprite 112 132 "$SURF/save-pad.png"
d fill-rect --x 8 --y 123 --width 95 --height 9 --color "$MET_XD"    # footing
# raised dais (a low stacked platform)
d fill-rect --x 16 --y 110 --width 80 --height 14 --color "$MET_D"
d fill-rect --x 22 --y 102 --width 68 --height 10 --color "$MET_M"
d fill-rect --x 22 --y 102 --width 68 --height 3  --color "$MET_L"   # deck lip
# glowing checkpoint ring set into the dais
d fill-circle --cx 56 --cy 106 --r 26 --color "$MET_XD"
d fill-circle --cx 56 --cy 106 --r 22 --color '#0e2733'
d fill-circle --cx 56 --cy 106 --r 18 --color "$RESONITE"
d fill-circle --cx 56 --cy 106 --r 13 --color '#0e2733'
d fill-circle --cx 56 --cy 106 --r 4  --color '#bff0ff'             # ring core glint
# central data pylon rising from the ring
d fill-rect --x 44 --y 40 --width 24 --height 66 --color "$MET_M"
d fill-rect --x 44 --y 40 --width 6  --height 66 --color "$MET_L"    # left sheen
d fill-rect --x 62 --y 40 --width 6  --height 66 --color "$MET_D"    # right shade
d fill-rect --x 44 --y 40 --width 24 --height 3  --color "$MET_HL"   # top rim
# lit save-disc emblem on the pylon (a floppy disk: body + shutter + label)
d fill-rect --x 47 --y 58 --width 18 --height 20 --color "$MET_XD"
d fill-rect --x 49 --y 60 --width 14 --height 16 --color "$RESONITE"
d fill-rect --x 52 --y 60 --width 8  --height 6  --color "$MET_XD"   # shutter
d fill-rect --x 54 --y 60 --width 2  --height 6  --color "$MET_L"
d fill-rect --x 50 --y 69 --width 12 --height 6  --color '#0e2733'   # label
d fill-rect --x 51 --y 71 --width 10 --height 1  --color "$RESONITE"
d fill-rect --x 51 --y 73 --width 7  --height 1  --color "$RESONITE"
# beacon lamp on top of the pylon
d fill-rect --x 52 --y 30 --width 8 --height 10 --color "$MET_D"
d fill-circle --cx 56 --cy 27 --r 6 --color "$RESONITE"
d fill-circle --cx 56 --cy 27 --r 3 --color '#bff0ff'
# faint uplight lines catching the beacon
d line --x0 40 --y0 96 --x1 34 --y1 82 --color "$RESONITE"
d line --x0 72 --y0 96 --x1 78 --y1 82 --color "$RESONITE"

# ============================ SUPPLY DEPOT (single-use field supplies) =========
# The surface SUPPLY DEPOT (specs/world.md, specs/items.md): where the miner buys the six
# single-use field supplies (explosives, teleporters, nanobots, emergency fuel). A reinforced
# supply container with a hazard banner, a warning-marked explosives crate, and a med/fuel
# canister — reads clearly as "expendable supplies for sale". 112×132.
newsprite 112 132 "$SURF/supply-depot.png"
d fill-rect --x 8 --y 123 --width 95 --height 9 --color "$MET_XD"    # footing
# container body
d fill-rect --x 12 --y 44 --width 88 --height 79 --color "$MET_D"
d fill-rect --x 12 --y 44 --width 6  --height 79 --color "$MET_M"    # left sheen
d fill-rect --x 94 --y 44 --width 6  --height 79 --color "$MET_XD"   # right shade
# corrugated roof lid + vertical ribs
d fill-rect --x 9 --y 38 --width 94 --height 9 --color "$MET_M"
d fill-rect --x 9 --y 38 --width 94 --height 2 --color "$MET_HL"
d fill-circle --cx 56 --cy 34 --r 3 --color "$FLAME"                 # depot sign lamp
for x in 18 30 42 54 66 78 90; do d fill-rect --x "$x" --y 47 --width 2 --height 76 --color "$MET_XD"; done
# hazard banner across the top
d fill-rect --x 16 --y 52 --width 80 --height 12 --color "$MET_XD"
for x in 18 28 38 48 58 68 78 88; do d fill-rect --x "$x" --y 52 --width 5 --height 12 --color "$FLAME"; done
# explosives crate (left) with a warning triangle
d fill-rect --x 20 --y 88 --width 32 --height 30 --color "$RUST_L"
d fill-rect --x 20 --y 88 --width 32 --height 4  --color "$RUST_D"
d line --x0 36 --y0 93 --x1 25 --y1 113 --color "$ALERT"
d line --x0 36 --y0 93 --x1 47 --y1 113 --color "$ALERT"
d line --x0 25 --y0 113 --x1 47 --y1 113 --color "$ALERT"
d fill-rect --x 35 --y 100 --width 2 --height 6 --color "$ALERT"
d fill-rect --x 35 --y 108 --width 2 --height 2 --color "$ALERT"
# supply canister (right) with a med/fuel cross
d fill-rect --x 62 --y 90 --width 28 --height 28 --color "$MET_M"
d fill-rect --x 62 --y 90 --width 6  --height 28 --color "$MET_L"    # neck sheen
d fill-rect --x 62 --y 90 --width 28 --height 4  --color "$MET_L"
d fill-rect --x 74 --y 96  --width 4  --height 16 --color "$WHITE"   # cross vertical
d fill-rect --x 68 --y 102 --width 16 --height 4  --color "$WHITE"   # cross horizontal

# =========================================================================================
#  ESCAPE ROCKET — assembly stages 0..5 (draw-sheet; specs/rocket.md, ASSET-LAYOUT.md)
# =========================================================================================
# NATIVE 96×160, symmetric about x=48. Every stage is drawn as its cumulative LEFT half
# (cols 0..48) and then `mirror-horizontal --axis-x 48` reflects it to a whole rocket — so a
# component added at stage N is present in every stage >= N. The engine stacks this over the
# launch pad's cradle; stage0 is the bare pad, stage5 is the lit, launch-ready rocket.
#
# The five installed components (build order, specs/rocket.md):
#   stage1  Hull Frame        — the skeletal steel body (struts, no skin)
#   stage2  Fuel Cells        — the body skinned + fuel-yellow tank cells fill the midriff
#   stage3  Guidance Unit     — the nose cone + guidance fins, resonite-blue avionics light
#   stage4  Thruster Assembly — the engine bell/nozzle cluster at the base, cryenite-violet
#   stage5  Ignition Core     — the core installed + lit: hot core-glow, launch-ready lamps
#
# Left-half layer helpers (each takes the frame index; draw only cols 0..48, mirror does 48..95).
newsheet 96 160 "$ROCK" "stage"

rk_pad() {   # the mounting deck + hold-down clamps every stage stands on (left half)
  local f=$1
  s fill-rect --frame "$f" --x 9  --y 145 --width 39 --height 10 --color "$MET_D"  # deck
  s fill-rect --frame "$f" --x 9  --y 145 --width 39 --height 3  --color "$MET_M"
  s fill-rect --frame "$f" --x 9  --y 153 --width 39 --height 5  --color "$MET_XD"
  s fill-rect --frame "$f" --x 27 --y 135 --width 9  --height 13 --color "$MET_L"  # clamp arm
  s fill-rect --frame "$f" --x 27 --y 135 --width 9  --height 3  --color "$MET_HL"
}
rk_frame() { # Hull Frame — the skeletal body outline: nose-to-base struts, ribs (left half)
  local f=$1
  s line --frame "$f" --x0 48 --y0 18 --x1 30 --y1 55 --color "$MET_L"    # nose taper strut
  s fill-rect --frame "$f" --x 27 --y 55 --width 5 --height 83 --color "$MET_M"  # outer longeron
  s fill-rect --frame "$f" --x 27 --y 55 --width 2 --height 83 --color "$MET_L"
  s fill-rect --frame "$f" --x 42 --y 18 --width 6 --height 120 --color "$MET_M" # spine (at axis)
  s fill-rect --frame "$f" --x 42 --y 18 --width 2 --height 120 --color "$MET_L"
  for y in 65 78 90 103 115 128; do                                      # ladder ribs
    s fill-rect --frame "$f" --x 27 --y "$y" --width 21 --height 3 --color "$MET_D"
  done
  s fill-rect --frame "$f" --x 27 --y 135 --width 21 --height 4 --color "$MET_D"  # base ring
}
rk_fuelcells() { # Fuel Cells — skin the body + fuel-yellow tank cells fill the midriff (left)
  local f=$1
  s fill-rect --frame "$f" --x 30 --y 58 --width 18 --height 78 --color "$MET_M" # skinned hull
  s fill-rect --frame "$f" --x 30 --y 58 --width 5  --height 78 --color "$MET_L" # left sheen
  s fill-rect --frame "$f" --x 30 --y 58 --width 18 --height 3  --color "$MET_HL"
  s fill-rect --frame "$f" --x 33 --y 75 --width 12 --height 43 --color "$MET_XD" # cell recess
  for y in 78 93 108; do                                                 # stacked fuel cells
    s fill-rect --frame "$f" --x 35 --y "$y" --width 9 --height 10 --color "$FUEL"
    s fill-rect --frame "$f" --x 35 --y "$y" --width 9 --height 2 --color '#fff0b0'
    s fill-rect --frame "$f" --x 35 --y $(( y + 9 )) --width 9 --height 2 --color "$RUST_L"
  done
  s fill-rect --frame "$f" --x 30 --y 130 --width 18 --height 5 --color "$MET_D" # base band
}
rk_guidance() { # Guidance Unit — pointed nose cone + upper guidance fin, avionics light (left)
  local f=$1
  s fill-rect --frame "$f" --x 39 --y 38 --width 9 --height 23 --color "$MET_L" # nose base
  s line --frame "$f" --x0 48 --y0 15 --x1 39 --y1 43 --color "$MET_HL"         # cone edge
  s fill-rect --frame "$f" --x 42 --y 25 --width 6 --height 30 --color "$MET_M" # cone body
  s fill-rect --frame "$f" --x 45 --y 18 --width 3 --height 10 --color "$MET_L" # cone tip
  s fill-circle --frame "$f" --cx 44 --cy 50 --r 3 --color "$RESONITE"          # avionics lamp
  s fill-rect --frame "$f" --x 43 --y 48 --width 2 --height 2 --color "$WHITE"
  # upper guidance canard fin
  s line --frame "$f" --x0 30 --y0 63 --x1 18 --y1 58 --color "$MET_L"
  s line --frame "$f" --x0 30 --y0 73 --x1 18 --y1 58 --color "$MET_M"
  s fill-rect --frame "$f" --x 21 --y 58 --width 9 --height 15 --color "$MET_M"
  s fill-rect --frame "$f" --x 21 --y 58 --width 9 --height 3  --color "$MET_L"
}
rk_thruster() { # Thruster Assembly — engine bell + lower fin at the base, cryenite accent (left)
  local f=$1
  s fill-rect --frame "$f" --x 33 --y 135 --width 15 --height 8 --color "$MET_D"  # engine mount
  s line --frame "$f" --x0 33 --y0 143 --x1 27 --y1 153 --color "$MET_M"          # bell flare
  s fill-rect --frame "$f" --x 27 --y 143 --width 21 --height 10 --color "$MET_M" # bell body
  s fill-rect --frame "$f" --x 27 --y 143 --width 21 --height 3 --color "$MET_L"
  s fill-rect --frame "$f" --x 30 --y 150 --width 18 --height 4 --color "$MET_XD" # bell throat
  s fill-rect --frame "$f" --x 38 --y 138 --width 6 --height 15 --color "$CRYENITE" # plasma core
  s fill-rect --frame "$f" --x 39 --y 138 --width 3 --height 15 --color '#d6bcff'
  # lower stabilizer fin
  s line --frame "$f" --x0 30 --y0 120 --x1 15 --y1 138 --color "$MET_L"
  s line --frame "$f" --x0 30 --y0 135 --x1 15 --y1 138 --color "$MET_M"
  s fill-rect --frame "$f" --x 18 --y 125 --width 12 --height 15 --color "$MET_M"
  s fill-rect --frame "$f" --x 18 --y 125 --width 12 --height 3  --color "$MET_L"
}
rk_ignition() { # Ignition Core — the lit, launch-ready rocket: core glow + running lamps (left)
  local f=$1
  # hot core-glow up the spine (the installed, live Ignition Core)
  s fill-rect --frame "$f" --x 40 --y 60 --width 8 --height 73 --color "$COREGLOW"
  s fill-rect --frame "$f" --x 43 --y 60 --width 5 --height 73 --color "$CORE"
  s fill-rect --frame "$f" --x 45 --y 63 --width 3 --height 68 --color '#ffd9a0'
  s fill-circle --frame "$f" --cx 45 --cy 93 --r 5 --color "$FLAME"                # core heart
  s fill-circle --frame "$f" --cx 45 --cy 93 --r 3 --color '#ffe6c0'
  # engine ignition flare peeking from the bell
  s fill-circle --frame "$f" --cx 39 --cy 155 --r 6 --color "$FLAME"
  s fill-circle --frame "$f" --cx 40 --cy 154 --r 4 --color "$FUEL"
  s fill-circle --frame "$f" --cx 42 --cy 153 --r 2 --color '#fff0d0'
  # launch-ready running lamps up the hull
  for y in 70 90 110; do s fill-rect --frame "$f" --x 31 --y "$y" --width 2 --height 2 --color "$FUEL"; done
  s fill-rect --frame "$f" --x 45 --y 23 --width 2 --height 2 --color "$WHITE"      # nose beacon
}

# stage0 = bare pad; each later stage is the cumulative left-half, then mirror to whole.
for f in 0 1 2 3 4 5; do
  rk_pad "$f"
  [ "$f" -ge 1 ] && rk_frame "$f"
  [ "$f" -ge 2 ] && rk_fuelcells "$f"
  [ "$f" -ge 3 ] && rk_guidance "$f"
  [ "$f" -ge 4 ] && rk_thruster "$f"
  [ "$f" -ge 5 ] && rk_ignition "$f"
  s mirror-horizontal --frame "$f" --axis-x 48
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
echo "  $SURF/{sky,ground,cave-mouth,fuel-depot,ore-market,save-pad,upgrade-shop,supply-depot,launch-pad}.png"
echo "  $ROCK/stage0..stage5.png"
echo "  $ICON/{fuel,hull,cargo,credits,depth,resonite,cryenite}.png"
