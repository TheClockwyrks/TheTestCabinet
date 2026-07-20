#!/usr/bin/env bash
# Junction — produce the static pixel-art sprites with the on-PATH `draw` tool
# (specs/assets.md §"Sprites", ASSETS.md §1). This covers ONLY the single-PNG
# sprites drawn with `draw`: zone buildings per density tier, transit tiles,
# utility tiles, vehicles, and HUD icons. The animated `draw-sheet` sheets, the
# `particle-2d` systems, and the audio are produced by their own scripts.
#
# Every colour is from specs/overview.md (the canonical palette). Sprites are
# pixel art on small transparent (straight-alpha) canvases, sampled
# nearest-neighbour in the game. Re-run this script to regenerate the files.
#
# Usage:  bash scripts/gen-sprites.sh   (draw must be on PATH, or prebuilt under
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

# --- single-sprite helpers (draw) ---------------------------------------------
# newsprite <w> <h> <out.png> : start a fresh transparent canvas of the size.
newsprite() {
  mkdir -p "$(dirname "$3")"
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# gable <cx> <topY> <halfw> <color> : a 3-step pyramid roof (peak at cx,topY).
gable() {
  local cx=$1 ty=$2 hw=$3 c=$4
  d fill-rect --x $((cx-hw))   --y $((ty+4)) --width $((2*hw))   --height 2 --color "$c"
  d fill-rect --x $((cx-hw+2)) --y $((ty+2)) --width $((2*hw-4)) --height 2 --color "$c"
  d fill-rect --x $((cx-hw+4)) --y $((ty))   --width $((2*hw-8)) --height 2 --color "$c"
}

# ===== palette (specs/overview.md) ===========================================
BG='#12161c'
RES='#4caf6d';  RES_D='#3d9760';  RES_ROOF='#2f7a4a'; RES_LIT='#7fd89b'; RES_BR='#9be9b4'; RES_WIN='#eafff2'
COM='#4a90d9';  COM_D='#3a72b0';  COM_ROOF='#2f5c8f'; COM_SIGN='#bcdcff'; COM_LIT='#7fb4ea'; COM_BR='#a9d2ff'
IND='#e0a63c';  IND_D='#b8842a';  METAL='#8a7d5a';    STACK='#5b6570';    IND_LIT='#ffd27a'
ROAD='#3c434d'; ROAD_D='#2b3138'; LANE='#9aa4af'
RAIL='#b061e6'; TIE='#5b6570';    RAIL_LIT='#f0e6ff'
STAT='#ece6db'
PWR='#ffcb52';  PWR_LIT='#ffe28a'; POLE='#5b6570';   BODY_D='#3a3630';   BODY_L='#4a453d'
PIPE='#47c8e0'; PIPE_D='#2f8fa3'; PIPE_L='#8fe4f0';  WBODY='#245a73'
MONEY='#7cd45a'; MONEY_L='#a6e88a'
TEXT='#e6ebf0'; TEXT2='#9aa4af'; ALERT='#ff5a52'
SHADOW='#0000004d'

# =============================================================================
# 1.1  ZONE BUILDINGS (32x32, per density tier)
# =============================================================================

# --- residential --------------------------------------------------------------
newsprite 32 32 "$A/zones/res_1.png"                 # low-density cottage
d fill-rect --x 10 --y 24 --width 14 --height 2 --color "$SHADOW"
d fill-rect --x 11 --y 15 --width 10 --height 9 --color "$RES"
d fill-rect --x 18 --y 15 --width 3  --height 9 --color "$RES_D"
gable 15 11 6 "$RES_ROOF"
d fill-rect --x 13 --y 18 --width 3 --height 3 --color "$RES_WIN"
d fill-rect --x 17 --y 19 --width 3 --height 5 --color "$RES_ROOF"
d fill-rect --x 24 --y 21 --width 4 --height 3 --color "$RES_ROOF"   # small yard shed

newsprite 32 32 "$A/zones/res_2.png"                 # mid-density block
d fill-rect --x 8 --y 24 --width 17 --height 2 --color "$SHADOW"
d fill-rect --x 9  --y 10 --width 16 --height 14 --color "$RES"
d fill-rect --x 20 --y 10 --width 5  --height 14 --color "$RES_D"
d fill-rect --x 9  --y 8  --width 16 --height 2  --color "$RES_ROOF"
for yr in 13 18; do for xr in 11 15 19; do d fill-rect --x $xr --y $yr --width 2 --height 3 --color "$RES_LIT"; done; done
d fill-rect --x 15 --y 13 --width 2 --height 3 --color "$RES_WIN"
d fill-rect --x 11 --y 18 --width 2 --height 3 --color "$RES_WIN"

newsprite 32 32 "$A/zones/res_3.png"                 # high-density tower
d fill-rect --x 10 --y 25 --width 14 --height 1 --color "$SHADOW"
d fill-rect --x 11 --y 4  --width 11 --height 21 --color "$RES"
d fill-rect --x 18 --y 4  --width 4  --height 21 --color "$RES_D"
d fill-rect --x 11 --y 2  --width 11 --height 2  --color "$RES_ROOF"
d fill-rect --x 16 --y 0  --width 1  --height 2  --color "$STAT"   # antenna
for yr in 6 10 14 18 22; do for xr in 13 16 19; do d fill-rect --x $xr --y $yr --width 2 --height 2 --color "$RES_BR"; done; done
d fill-rect --x 16 --y 10 --width 2 --height 2 --color "$RES_WIN"
d fill-rect --x 13 --y 18 --width 2 --height 2 --color "$RES_WIN"
d fill-rect --x 19 --y 14 --width 2 --height 2 --color "$RES_WIN"

# --- commercial ---------------------------------------------------------------
newsprite 32 32 "$A/zones/com_1.png"                 # corner shop
d fill-rect --x 9 --y 24 --width 16 --height 2 --color "$SHADOW"
d fill-rect --x 9  --y 14 --width 16 --height 10 --color "$COM"
d fill-rect --x 20 --y 14 --width 5  --height 10 --color "$COM_D"
d fill-rect --x 9  --y 12 --width 16 --height 2  --color "$COM_SIGN"   # sign strip
d fill-rect --x 9  --y 16 --width 16 --height 2  --color "$IND"        # awning
d fill-rect --x 10 --y 19 --width 10 --height 5  --color "$COM_SIGN"   # glass front
d fill-rect --x 20 --y 19 --width 4  --height 5  --color "$COM_ROOF"   # door

newsprite 32 32 "$A/zones/com_2.png"                 # retail row / mid block
d fill-rect --x 8 --y 24 --width 18 --height 2 --color "$SHADOW"
d fill-rect --x 8  --y 10 --width 18 --height 14 --color "$COM"
d fill-rect --x 21 --y 10 --width 5  --height 14 --color "$COM_D"
d fill-rect --x 8  --y 8  --width 18 --height 2  --color "$COM_ROOF"
for xr in 10 14 18 22; do d fill-rect --x $xr --y 12 --width 3 --height 4 --color "$COM_LIT"; done
d fill-rect --x 9 --y 19 --width 16 --height 5 --color "$COM_SIGN"     # street-level glass
d fill-rect --x 13 --y 12 --width 3 --height 4 --color "$COM_BR"

newsprite 32 32 "$A/zones/com_3.png"                 # office tower
d fill-rect --x 9 --y 25 --width 15 --height 1 --color "$SHADOW"
d fill-rect --x 10 --y 3  --width 13 --height 22 --color "$COM"
d fill-rect --x 19 --y 3  --width 4  --height 22 --color "$COM_D"
d fill-rect --x 10 --y 2  --width 13 --height 1  --color "$COM_ROOF"
for yr in 5 9 13 17 21; do for xr in 12 15 18 21; do d fill-rect --x $xr --y $yr --width 2 --height 2 --color "$COM_BR"; done; done
d fill-rect --x 15 --y 9  --width 2 --height 2 --color "$COM_SIGN"
d fill-rect --x 18 --y 17 --width 2 --height 2 --color "$COM_SIGN"

# --- industrial ---------------------------------------------------------------
newsprite 32 32 "$A/zones/ind_1.png"                 # small workshop
d fill-rect --x 9 --y 24 --width 16 --height 2 --color "$SHADOW"
d fill-rect --x 9  --y 15 --width 16 --height 9 --color "$IND"
d fill-rect --x 20 --y 15 --width 5  --height 9 --color "$IND_D"
d fill-rect --x 8  --y 13 --width 18 --height 2 --color "$METAL"       # metal roof
d fill-rect --x 12 --y 10 --width 3  --height 3 --color "$STACK"       # roof vent
d fill-rect --x 18 --y 18 --width 5  --height 6 --color "$METAL"       # roll door

newsprite 32 32 "$A/zones/ind_2.png"                 # factory
d fill-rect --x 7 --y 24 --width 19 --height 2 --color "$SHADOW"
d fill-rect --x 7  --y 13 --width 19 --height 11 --color "$IND"
d fill-rect --x 20 --y 13 --width 6  --height 11 --color "$IND_D"
for xr in 8 13 18; do                                                    # saw-tooth roof
  d fill-rect --x $xr --y 11 --width 4 --height 2 --color "$METAL"
  d fill-rect --x $xr --y 9  --width 2 --height 2 --color "$METAL"
done
d fill-rect --x 21 --y 5  --width 3 --height 8 --color "$STACK"          # smokestack
d fill-rect --x 21 --y 5  --width 3 --height 1 --color "$IND_LIT"
d fill-rect --x 10 --y 17 --width 4 --height 4 --color "$METAL"

newsprite 32 32 "$A/zones/ind_3.png"                 # heavy plant
d fill-rect --x 5 --y 24 --width 22 --height 2 --color "$SHADOW"
d fill-rect --x 5  --y 12 --width 22 --height 12 --color "$IND"
d fill-rect --x 21 --y 12 --width 6  --height 12 --color "$IND_D"
d fill-rect --x 5  --y 11 --width 22 --height 1  --color "$METAL"        # long hall roof
for xr in 8 14 20; do                                                    # three stacks
  d fill-rect --x $xr --y 4 --width 3 --height 8 --color "$STACK"
  d fill-rect --x $xr --y 4 --width 3 --height 1 --color "$IND_LIT"
done
d fill-rect --x 8  --y 16 --width 5 --height 5 --color "$METAL"
d fill-rect --x 16 --y 16 --width 8 --height 3 --color "$IND_D"

# =============================================================================
# 1.2  TRANSIT TILES (32x32)
# =============================================================================
newsprite 32 32 "$A/transit/road_straight.png"      # vertical band, dashed centre
d fill-rect --x 10 --y 0  --width 12 --height 32 --color "$ROAD"
d fill-rect --x 10 --y 0  --width 1  --height 32 --color "$ROAD_D"
d fill-rect --x 21 --y 0  --width 1  --height 32 --color "$ROAD_D"
for yr in 1 7 13 19 25; do d fill-rect --x 15 --y $yr --width 2 --height 4 --color "$LANE"; done

newsprite 32 32 "$A/transit/road_corner.png"        # bottom<->right elbow
d fill-rect --x 10 --y 10 --width 12 --height 22 --color "$ROAD"       # down leg
d fill-rect --x 10 --y 10 --width 22 --height 12 --color "$ROAD"       # right leg
d fill-rect --x 13 --y 24 --width 2 --height 4 --color "$LANE"
d fill-rect --x 24 --y 15 --width 4 --height 2 --color "$LANE"
d fill-rect --x 15 --y 15 --width 2 --height 2 --color "$LANE"

newsprite 32 32 "$A/transit/road_junction.png"      # 4-way cross
d fill-rect --x 10 --y 0  --width 12 --height 32 --color "$ROAD"
d fill-rect --x 0  --y 10 --width 32 --height 12 --color "$ROAD"
for p in 1 25; do d fill-rect --x 15 --y $p --width 2 --height 4 --color "$LANE"; done
for p in 1 25; do d fill-rect --x $p --y 15 --width 4 --height 2 --color "$LANE"; done

newsprite 32 32 "$A/transit/road_end.png"           # stub cap
d fill-rect --x 10 --y 12 --width 12 --height 20 --color "$ROAD"
d fill-rect --x 10 --y 12 --width 12 --height 2  --color "$LANE"       # cap
for yr in 16 22 28; do d fill-rect --x 15 --y $yr --width 2 --height 3 --color "$LANE"; done

newsprite 32 32 "$A/transit/rail.png"               # two rails + ties
for yr in 1 6 11 16 21 26; do d fill-rect --x 11 --y $yr --width 11 --height 2 --color "$TIE"; done
d fill-rect --x 12 --y 0 --width 2 --height 32 --color "$RAIL"
d fill-rect --x 19 --y 0 --width 2 --height 32 --color "$RAIL"

newsprite 32 32 "$A/transit/station.png"            # platform astride rail
for yr in 3 9 15 21 27; do d fill-rect --x 13 --y $yr --width 7 --height 2 --color "$TIE"; done
d fill-rect --x 14 --y 0 --width 2 --height 32 --color "$RAIL"
d fill-rect --x 17 --y 0 --width 2 --height 32 --color "$RAIL"
d fill-rect --x 4  --y 8 --width 6 --height 16 --color "$STAT"         # left platform
d fill-rect --x 23 --y 8 --width 6 --height 16 --color "$STAT"         # right platform
d fill-rect --x 4  --y 6 --width 25 --height 2 --color "$RAIL"         # roof mark
d fill-rect --x 6  --y 12 --width 2 --height 2 --color "$TEXT2"

# =============================================================================
# 1.3  UTILITY TILES
# =============================================================================
newsprite 64 64 "$A/utility/plant.png"              # power plant (2x2)
d fill-rect --x 8  --y 54 --width 48 --height 4 --color "$SHADOW"
d fill-rect --x 8  --y 26 --width 48 --height 30 --color "$BODY_D"     # turbine hall
d fill-rect --x 8  --y 24 --width 48 --height 3  --color "$BODY_L"     # roof
d fill-rect --x 40 --y 8  --width 16 --height 20 --color "$BODY_D"     # cooling stack
d fill-rect --x 40 --y 8  --width 16 --height 3  --color "$BODY_L"
d fill-rect --x 42 --y 10 --width 12 --height 3  --color "$PWR_LIT"    # stack glow lip
d fill-circle --cx 24 --cy 40 --r 11 --color "$BODY_L"                 # amber core well
d fill-circle --cx 24 --cy 40 --r 9  --color "$PWR"
d fill-circle --cx 24 --cy 40 --r 5  --color "$PWR_LIT"
d fill-circle --cx 24 --cy 40 --r 2  --color "#ffffff"
for xr in 12 20 28 34; do d fill-rect --x $xr --y 48 --width 3 --height 6 --color "$BODY_L"; done  # vents

newsprite 32 32 "$A/utility/wire.png"               # pylon + amber cable
d line --x0 0 --y0 9  --x1 31 --y1 11 --color "$PWR"                   # sagging cables
d line --x0 0 --y0 20 --x1 31 --y1 18 --color "$PWR"
d fill-rect --x 15 --y 4 --width 2 --height 24 --color "$POLE"         # mast
d fill-rect --x 8  --y 8  --width 16 --height 2 --color "$POLE"        # upper arm
d fill-rect --x 10 --y 14 --width 12 --height 2 --color "$POLE"        # lower arm
d line --x0 11 --y0 10 --x1 20 --y1 14 --color "$POLE"                 # lattice braces
d line --x0 20 --y0 10 --x1 11 --y1 14 --color "$POLE"
d fill-rect --x 8  --y 8  --width 2 --height 2 --color "$PWR"          # insulators
d fill-rect --x 22 --y 8  --width 2 --height 2 --color "$PWR"

newsprite 64 64 "$A/utility/source.png"             # water source (2x2)
d fill-rect --x 8  --y 54 --width 44 --height 4 --color "$SHADOW"
d fill-rect --x 8  --y 32 --width 40 --height 24 --color "$WBODY"      # pump house
d fill-rect --x 8  --y 30 --width 40 --height 3  --color "$PIPE_D"     # roof
d fill-circle --cx 44 --cy 22 --r 14 --color "$WBODY"                  # water tower tank
d fill-circle --cx 44 --cy 22 --r 12 --color "$PIPE"
d fill-circle --cx 44 --cy 22 --r 6  --color "$PIPE_L"
d line --x0 36 --y0 30 --x1 38 --y1 44 --color "$PIPE_D"               # tower legs
d line --x0 52 --y0 30 --x1 50 --y1 44 --color "$PIPE_D"
d fill-rect --x 14 --y 40 --width 10 --height 14 --color "$PIPE_D"     # intake bay
d fill-rect --x 16 --y 42 --width 6  --height 10 --color "$PIPE"

newsprite 32 32 "$A/utility/pipe.png"               # cyan conduit run
d fill-rect --x 0 --y 12 --width 32 --height 8 --color "$PIPE_D"       # tube body
d fill-rect --x 0 --y 13 --width 32 --height 3 --color "$PIPE"         # sheen
d fill-rect --x 0 --y 13 --width 32 --height 1 --color "$PIPE_L"       # highlight
d fill-rect --x 6  --y 10 --width 3 --height 12 --color "$WBODY"       # flange joints
d fill-rect --x 23 --y 10 --width 3 --height 12 --color "$WBODY"

# =============================================================================
# 1.4  VEHICLES (small, drawn heading "up"/north; rotated in code)
# =============================================================================
newsprite 16 16 "$A/vehicles/car.png"               # commuter car
d fill-rect --x 5 --y 2 --width 6 --height 12 --color "#2f5c8f"        # outline/base
d fill-rect --x 5 --y 3 --width 6 --height 10 --color "$COM_SIGN"      # body
d fill-rect --x 6 --y 4 --width 4 --height 3 --color "$TEXT"           # windshield
d fill-rect --x 6 --y 9 --width 4 --height 3 --color "$TEXT"           # rear glass
d fill-rect --x 6 --y 2 --width 4 --height 1 --color "$PWR_LIT"        # headlights

newsprite 16 16 "$A/vehicles/truck.png"             # goods truck
d fill-rect --x 4 --y 2 --width 8 --height 12 --color "$IND_D"         # base
d fill-rect --x 4 --y 5 --width 8 --height 9 --color "$IND"            # cargo box
d fill-rect --x 4 --y 2 --width 8 --height 3 --color "$LANE"           # cab
d fill-rect --x 5 --y 3 --width 6 --height 1 --color "$TEXT"           # cab window
d fill-rect --x 4 --y 8 --width 8 --height 1 --color "$IND_D"          # box seam

newsprite 16 24 "$A/vehicles/tram.png"              # single tram car
d fill-rect --x 3 --y 1 --width 10 --height 22 --color "#5a2a86"       # base
d fill-rect --x 3 --y 2 --width 10 --height 20 --color "$RAIL"         # body
d fill-rect --x 4 --y 2 --width 8 --height 3 --color "$RAIL_LIT"       # front glass
for yr in 7 12 17; do d fill-rect --x 4 --y $yr --width 8 --height 3 --color "$RAIL_LIT"; done  # windows
d fill-rect --x 4 --y 21 --width 8 --height 2 --color "#3a1a5a"        # rear

# =============================================================================
# 1.5  HUD ICONS (16x16 glyphs)
# =============================================================================
newsprite 16 16 "$A/icons/money.png"                # coin / $
d fill-circle --cx 8 --cy 8 --r 6 --color "$MONEY"
d fill-circle --cx 8 --cy 8 --r 5 --color "$MONEY_L"
d fill-circle --cx 8 --cy 8 --r 4 --color "$MONEY"
d fill-rect --x 7 --y 3 --width 1 --height 10 --color "#0e3d1f"        # $ stem
d fill-rect --x 5 --y 5 --width 4 --height 1 --color "#0e3d1f"
d fill-rect --x 5 --y 5 --width 1 --height 2 --color "#0e3d1f"
d fill-rect --x 6 --y 8 --width 4 --height 1 --color "#0e3d1f"
d fill-rect --x 10 --y 9 --width 1 --height 2 --color "#0e3d1f"
d fill-rect --x 6 --y 11 --width 4 --height 1 --color "#0e3d1f"

newsprite 16 16 "$A/icons/pop.png"                  # person silhouette
d fill-circle --cx 8 --cy 4 --r 2 --color "$TEXT"
d fill-circle --cx 8 --cy 11 --r 4 --color "$TEXT"
d fill-rect --x 4 --y 11 --width 8 --height 4 --color "$TEXT"

newsprite 16 16 "$A/icons/power.png"                # lightning bolt
d fill-rect --x 9 --y 2 --width 3 --height 4 --color "$PWR"
d fill-rect --x 7 --y 5 --width 3 --height 4 --color "$PWR"
d fill-rect --x 4 --y 7 --width 5 --height 2 --color "$PWR_LIT"
d fill-rect --x 6 --y 8 --width 3 --height 4 --color "$PWR"
d fill-rect --x 4 --y 11 --width 3 --height 3 --color "$PWR"

newsprite 16 16 "$A/icons/water.png"                # droplet
d fill-rect --x 7 --y 2 --width 2 --height 3 --color "$PIPE"
d fill-rect --x 6 --y 4 --width 4 --height 3 --color "$PIPE"
d fill-circle --cx 8 --cy 10 --r 4 --color "$PIPE"
d fill-circle --cx 6 --cy 9 --r 1 --color "$PIPE_L"                    # highlight

newsprite 16 16 "$A/icons/zone_r.png"               # green house mark
gable 8 3 5 "$RES_ROOF"
d fill-rect --x 5 --y 7 --width 6 --height 6 --color "$RES"
d fill-rect --x 7 --y 9 --width 2 --height 4 --color "$RES_ROOF"       # door

newsprite 16 16 "$A/icons/zone_c.png"               # blue shop mark
d fill-rect --x 4 --y 6 --width 8 --height 7 --color "$COM"
d fill-rect --x 3 --y 4 --width 10 --height 2 --color "$COM_SIGN"      # awning
d fill-rect --x 5 --y 8 --width 6 --height 4 --color "$COM_SIGN"       # window

newsprite 16 16 "$A/icons/zone_i.png"               # amber factory mark
d fill-rect --x 4 --y 7 --width 8 --height 6 --color "$IND"
d fill-rect --x 4 --y 6 --width 8 --height 1 --color "$METAL"
d fill-rect --x 9 --y 3 --width 2 --height 4 --color "$STACK"          # smokestack

newsprite 16 16 "$A/icons/alert.png"                # warning triangle
d fill-rect --x 7 --y 2  --width 2 --height 2 --color "$ALERT"
d fill-rect --x 6 --y 4  --width 4 --height 2 --color "$ALERT"
d fill-rect --x 5 --y 6  --width 6 --height 2 --color "$ALERT"
d fill-rect --x 4 --y 8  --width 8 --height 2 --color "$ALERT"
d fill-rect --x 3 --y 10 --width 10 --height 2 --color "$ALERT"
d fill-rect --x 7 --y 5  --width 2 --height 4 --color "$BG"            # exclamation
d fill-rect --x 7 --y 10 --width 2 --height 1 --color "$BG"

newsprite 16 16 "$A/icons/road.png"                 # road tool glyph
d fill-rect --x 2 --y 3 --width 12 --height 10 --color "$ROAD"
d fill-rect --x 2 --y 3 --width 1 --height 10 --color "$ROAD_D"
d fill-rect --x 13 --y 3 --width 1 --height 10 --color "$ROAD_D"
for yr in 4 8 12; do d fill-rect --x 7 --y $yr --width 2 --height 2 --color "$LANE"; done

newsprite 16 16 "$A/icons/rail.png"                 # rail tool glyph
for yr in 3 6 9 12; do d fill-rect --x 3 --y $yr --width 10 --height 1 --color "$TIE"; done
d fill-rect --x 5 --y 2 --width 2 --height 11 --color "$RAIL"
d fill-rect --x 9 --y 2 --width 2 --height 11 --color "$RAIL"

newsprite 16 16 "$A/icons/station.png"              # station tool glyph
d fill-rect --x 7 --y 1 --width 2 --height 14 --color "$RAIL"
d fill-rect --x 2 --y 5 --width 12 --height 3 --color "$STAT"          # roof
d fill-rect --x 3 --y 8 --width 10 --height 5 --color "$STAT"          # platform
d fill-rect --x 4 --y 9 --width 8 --height 3 --color "$TEXT2"

newsprite 16 16 "$A/icons/bulldoze.png"             # bulldoze / raze
d fill-rect --x 8 --y 6 --width 6 --height 5 --color "$TEXT2"          # cab/body
d fill-rect --x 3 --y 4 --width 2 --height 8 --color "$TEXT2"          # blade
d fill-rect --x 3 --y 4 --width 2 --height 2 --color "$ALERT"          # blade edge
d fill-circle --cx 9  --cy 12 --r 2 --color "$STACK"                   # tracks
d fill-circle --cx 13 --cy 12 --r 2 --color "$STACK"
d line --x0 2 --y0 14 --x1 14 --y1 2 --color "$ALERT"                  # raze slash

echo "produced $(find "$A/zones" "$A/transit" "$A/utility" "$A/vehicles" "$A/icons" -name '*.png' | wc -l) sprites under $A"
