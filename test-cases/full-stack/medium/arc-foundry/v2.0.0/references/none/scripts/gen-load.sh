#!/usr/bin/env bash
# Arc Foundry — produce the Load's idle cycles with `draw-sheet` (specs/assets.md).
#
# Seven cycles, one per Load type and one for the Overload Dynamo of the finale, each four
# frames at `assets/load/<type>/0.png` .. `3.png` and played as a loop while its subject is
# on the yard. Frame 0 doubles as the type's still sprite. Each is 20 by 20, and 32 by 32
# for the Slug, the Dynamo, and the Overload Dynamo.
#
# The Load is silvery conductive scrap (#c4cbd6) lit by blue-white arc discharge
# (#eaf6ff / #4ac6ff); a Dynamo's overload core burns violet (#a45cff / #d9b6ff) and the
# Overload Dynamo's runs hotter still. Every unit visibly crackles, and the Dynamo carries
# a visible overload wobble.
#
# Usage:  bash scripts/gen-load.sh   (draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/debug). The game build never invokes this: the produced PNGs
#         are committed and bundled.
set -euo pipefail

if ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/debug"
  [ -x "$REL/draw-sheet" ] || { echo "draw-sheet not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOAD="$ROOT/assets/load"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsheet <size> <outdir> : a four-frame square cycle rendered to <outdir>/{0..3}.png.
newsheet() {
  local n=$1 dir=$2
  mkdir -p "$dir"
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [0,1,2,3], "actions": "%s", "preview": "%s" }\n' \
    "$n" "$n" "$TMP/f_{frame}.json" "$dir/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# spark <frame> <cx> <cy> <color> : a tiny 3px crackle spark (a lit pixel and two arms).
spark() {
  local f=$1 cx=$2 cy=$3 col=$4
  s set-pixel --frame "$f" --x "$cx" --y "$cy" --color "$col"
  s set-pixel --frame "$f" --x $((cx+1)) --y "$cy" --color "$col"
  s set-pixel --frame "$f" --x "$cx" --y $((cy+1)) --color "$col"
}

# ============================ MOTE (the baseline charge unit) =================
# A compact nugget of charged scrap: dark rim, silvery body, blue-white core. The core
# pulses and a spark orbits the rim.
mote_body() { # <frame> <coreR> <arcR>
  local f=$1 cr=$2 ar=$3
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 8 --color '#20262d'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 7 --color '#5a6570'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 5 --color '#c4cbd6'
  s fill-rect   --frame "$f" --x 6 --y 5 --width 4 --height 2 --color '#e8eef5'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r "$ar" --color '#4ac6ff'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r "$cr" --color '#eaf6ff'
}
newsheet 20 "$LOAD/mote"
mote_body 0 2 3; spark 0 10 0  '#4ac6ff'
mote_body 1 2 4; spark 1 17 7  '#eaf6ff'
mote_body 2 3 4; spark 2 10 17 '#4ac6ff'
mote_body 3 2 4; spark 3 1  8  '#eaf6ff'
echo "produced the Mote's idle cycle -> $LOAD/mote"

# ============================ SPARK (fast, fragile) ===========================
# Small, bright, wired tight: a darting bead with radiating spikes that flicker between
# long and short across the cycle, so it reads energetic.
spark_body() { # <frame> <coreR>
  local f=$1 cr=$2
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 6 --color '#2a3742'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 5 --color '#7fbfe0'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 3 --color '#c8ecff'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r "$cr" --color '#ffffff'
}
newsheet 20 "$LOAD/spark"
spark_body 0 2; s line --frame 0 --x0 10 --y0 1  --x1 10 --y1 4  --color '#eaf6ff'; s line --frame 0 --x0 15 --y0 10 --x1 18 --y1 10 --color '#4ac6ff'; s line --frame 0 --x0 2 --y0 10 --x1 5 --y1 10 --color '#4ac6ff'
spark_body 1 2; s line --frame 1 --x0 10 --y0 10 --x1 10 --y1 16 --color '#eaf6ff'; s line --frame 1 --x0 10 --y0 4  --x1 10 --y1 10 --color '#4ac6ff'
spark_body 2 3; s line --frame 2 --x0 4  --y0 4  --x1 7  --y1 7  --color '#eaf6ff'; s line --frame 2 --x0 13 --y0 13 --x1 16 --y1 16 --color '#eaf6ff'
spark_body 3 2; s line --frame 3 --x0 4  --y0 16 --x1 7  --y1 13 --color '#eaf6ff'; s line --frame 3 --x0 13 --y0 7  --x1 16 --y1 4  --color '#eaf6ff'
echo "produced the Spark's idle cycle -> $LOAD/spark"

# ============================ SLUG (slow, capacitive tank) ====================
# A bulky armoured mass of fused capacitor plates: heavy, dim, deep-blue charge on a slow
# pulse, so it reads as a wall of health rather than a live wire.
slug_body() { # <frame> <coreColor>
  local f=$1 core=$2
  s fill-circle --frame "$f" --cx 16 --cy 17 --r 13 --color '#181d22'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 12 --color '#3a444e'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 10 --color '#4a555f'
  s line --frame "$f" --x0 6  --y0 16 --x1 26 --y1 16 --color '#242b31'
  s line --frame "$f" --x0 16 --y0 6  --x1 16 --y1 26 --color '#242b31'
  s fill-rect --frame "$f" --x 7  --y 8  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x 22 --y 8  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x 7  --y 21 --width 3 --height 3 --color '#2f373e'
  s fill-rect --frame "$f" --x 22 --y 21 --width 3 --height 3 --color '#2f373e'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 5 --color '#245a7a'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 3 --color "$core"
}
newsheet 32 "$LOAD/slug"
slug_body 0 '#2f7fb0'
slug_body 1 '#3d94c8'
slug_body 2 '#4ac6ff'; spark 2 16 16 '#eaf6ff'
slug_body 3 '#3d94c8'
echo "produced the Slug's idle cycle -> $LOAD/slug"

# ============================ CLUSTER (tiny, dense packs) =====================
# A tight clump of four small charged bits that jitter and flicker, so the pack reads as
# alive rather than as one body.
cbit() { # <frame> <cx> <cy> <coreR>
  local f=$1 cx=$2 cy=$3 cr=$4
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 3 --color '#2a3037'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 2 --color '#c4cbd6'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r "$cr" --color '#7fe0ff'
}
cluster_frame() { # <frame> <ax> <ay> <bx> <by> <cx> <cy> <dx> <dy> <litIdx>
  local f=$1
  cbit "$f" "$2" "$3" $([ "${10}" = 0 ] && echo 2 || echo 1)
  cbit "$f" "$4" "$5" $([ "${10}" = 1 ] && echo 2 || echo 1)
  cbit "$f" "$6" "$7" $([ "${10}" = 2 ] && echo 2 || echo 1)
  cbit "$f" "$8" "$9" $([ "${10}" = 3 ] && echo 2 || echo 1)
}
newsheet 20 "$LOAD/cluster"
cluster_frame 0  7 7  13 6  6 13 14 14 0
cluster_frame 1  6 7  14 6  7 14 13 13 1
cluster_frame 2  7 6  13 7  6 14 14 13 2
cluster_frame 3  7 7  14 7  7 13 13 14 3
spark 1 10 10 '#eaf6ff'
spark 3 10 9  '#eaf6ff'
echo "produced the Cluster's idle cycle -> $LOAD/cluster"

# ============================ FILAMENT (the flyer) ============================
# An airborne plasma thread: a bright horizontal filament wreathed in sweeping arc-wings
# over a faint hover halo, so it clearly reads as ABOVE the yard rather than crawling it.
fil_body() { # <frame> <threadHalfWidth>
  local f=$1 tw=$2
  s fill-circle --frame "$f" --cx 10 --cy 15 --r 5 --color '#1c4a6633'
  s fill-circle --frame "$f" --cx 10 --cy 16 --r 3 --color '#2f7fb022'
  s fill-rect   --frame "$f" --x $((10 - tw)) --y 7 --width $((tw*2)) --height 4 --color '#2f9fd0'
  s fill-rect   --frame "$f" --x $((10 - tw)) --y 8 --width $((tw*2)) --height 2 --color '#c8ecff'
  s fill-circle --frame "$f" --cx 10 --cy 9 --r 3 --color '#eaf6ff'
}
newsheet 20 "$LOAD/filament"
fil_body 0 6; s line --frame 0 --x0 4  --y0 9 --x1 1  --y1 5  --color '#4ac6ff'; s line --frame 0 --x0 16 --y0 9 --x1 18 --y1 5  --color '#4ac6ff'
fil_body 1 7; s line --frame 1 --x0 3  --y0 9 --x1 0  --y1 9  --color '#eaf6ff'; s line --frame 1 --x0 17 --y0 9 --x1 19 --y1 9  --color '#eaf6ff'
fil_body 2 6; s line --frame 2 --x0 4  --y0 9 --x1 1  --y1 13 --color '#4ac6ff'; s line --frame 2 --x0 16 --y0 9 --x1 18 --y1 13 --color '#4ac6ff'
fil_body 3 8; spark 3 10 8 '#ffffff'; s line --frame 3 --x0 2 --y0 9 --x1 17 --y1 9 --color '#c8ecff88'
echo "produced the Filament's idle cycle -> $LOAD/filament"

# ============================ THE DYNAMO AND THE OVERLOAD DYNAMO ==============
# A large unstable overload core: a dark riveted iron casing split by glowing cracks around
# a violent reactor core. The cycle is an unstable WOBBLE — the casing shakes by a pixel,
# the core swells and dims erratically, and an arc leaps to a different casing point each
# frame — so the boss visibly seethes.
dyn_body() { # <frame> <dx> <dy> <coreR> <coreColor> <crackColor>
  local f=$1 dx=$2 dy=$3 cr=$4 core=$5 ring=$6
  local cx=$((16+dx)) cy=$((16+dy))
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 14 --color '#14181d'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 13 --color '#3a4048'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 11 --color '#2b333c'
  s fill-rect --frame "$f" --x $((cx-1))  --y $((cy-13)) --width 2 --height 2 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-1))  --y $((cy+11)) --width 2 --height 2 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-13)) --y $((cy-1))  --width 2 --height 2 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx+11)) --y $((cy-1))  --width 2 --height 2 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-10)) --y $((cy-10)) --width 2 --height 2 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx+8))  --y $((cy-10)) --width 2 --height 2 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx-10)) --y $((cy+8))  --width 2 --height 2 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx+8))  --y $((cy+8))  --width 2 --height 2 --color '#4a555f'
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx-9)) --y1 $((cy-6)) --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx+8)) --y1 $((cy-7)) --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx+6)) --y1 $((cy+9)) --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx-7)) --y1 $((cy+8)) --color "$ring"
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r $((cr+3)) --color '#5a2a8c'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r $((cr+1)) --color "$ring"
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r "$cr" --color "$core"
}

newsheet 32 "$LOAD/dynamo"
dyn_body 0  0  0 3 '#d9b6ff' '#a45cff'; s line --frame 0 --x0 16 --y0 2  --x1 20 --y1 8  --color '#c8a0ff'
dyn_body 1  1 -1 5 '#f0e0ff' '#b978ff'; s line --frame 1 --x0 29 --y0 14 --x1 24 --y1 13 --color '#eaf6ff'
dyn_body 2 -1  0 4 '#d9b6ff' '#a45cff'; s line --frame 2 --x0 16 --y0 29 --x1 12 --y1 23 --color '#c8a0ff'
dyn_body 3  1  1 6 '#ffffff' '#c78cff'; s line --frame 3 --x0 2  --y0 16 --x1 9  --y1 18 --color '#eaf6ff'; spark 3 16 16 '#ffffff'
echo "produced the Dynamo's idle cycle -> $LOAD/dynamo"

# The Overload Dynamo of the finale is a unit of its own (specs/enemies.md): the same
# oversized casing wound far hotter, a white-hot core roiling inside amber-white fissures
# rather than the boss's violet, so the finale reads as its own event on sight.
newsheet 32 "$LOAD/overload"
dyn_body 0  0  0 5 '#fff4d6' '#ff9c3c'; s line --frame 0 --x0 16 --y0 1  --x1 21 --y1 8  --color '#ffd27f'; spark 0 16 16 '#ffffff'
dyn_body 1 -1  1 7 '#ffffff' '#ffbe5c'; s line --frame 1 --x0 30 --y0 16 --x1 23 --y1 14 --color '#ffffff'
dyn_body 2  1  0 6 '#fff4d6' '#ff9c3c'; s line --frame 2 --x0 16 --y0 30 --x1 11 --y1 22 --color '#ffd27f'; spark 2 14 15 '#ffffff'
dyn_body 3 -1 -1 8 '#ffffff' '#ffbe5c'; s line --frame 3 --x0 1  --y0 16 --x1 8  --y1 19 --color '#ffffff'
echo "produced the Overload Dynamo's idle cycle -> $LOAD/overload"

echo "== every Load idle cycle produced under $LOAD =="
