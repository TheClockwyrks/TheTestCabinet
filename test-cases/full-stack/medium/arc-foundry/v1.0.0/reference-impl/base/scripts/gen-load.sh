#!/usr/bin/env bash
# Arc Foundry — produce the LOAD (enemy) sprites + charge cycles with the on-PATH
# asset tools (specs/assets.md §11.1–11.2, specs/enemies.md).
#
# This script authors the whole enemy roster as animated charge cycles with
# `draw-sheet` (one PNG per frame): the six unit types — Mote, Spark, Slug,
# Cluster, the airborne Filament flyer, and the Dynamo boss — each seething with
# charge rather than sitting static, and the Dynamo with a distinct
# unstable-overload wobble. Frame 0 of every cycle doubles as the type's static
# read (src/assets.ts loads `assets/load/<type>/idle/<n>.png`, frame 0 first).
#
# Palette (specs/overview.md): the Load is silvery conductive scrap (#c4cbd6) lit
# by blue-white arc discharge (#eaf6ff / #4ac6ff); the Dynamo overload core burns
# violet (#a45cff / #d9b6ff). On-theme electro-industrial "charged scrap".
#
# Usage:  bash scripts/gen-load.sh   (draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# Resolve the tools: prefer PATH, else the cargo target release dir (Valence pattern).
if ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw-sheet" ] || { echo "draw-sheet not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOAD="$ROOT/assets/load"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- sheet helpers (draw-sheet: one PNG per frame) ----------------------------
# newsheet <w> <h> <nframes> <outdir> : declare an n-frame cycle rendered to
#   <outdir>/{0..n-1}.png (page-relative key `load/<type>/idle/<n>`).
newsheet() {
  local w=$1 h=$2 n=$3 dir=$4 frames i
  mkdir -p "$dir"
  frames="0"; for ((i=1;i<n;i++)); do frames="$frames,$i"; done
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [%s], "actions": "%s", "preview": "%s" }\n' \
    "$w" "$h" "$frames" "$TMP/f_{frame}.json" "$dir/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# spark <frame> <cx> <cy> <color> : a tiny 3px crackle spark (a lit pixel + arms).
spark() {
  local f=$1 cx=$2 cy=$3 col=$4
  s set-pixel --frame "$f" --x "$cx" --y "$cy" --color "$col"
  s set-pixel --frame "$f" --x $((cx+1)) --y "$cy" --color "$col"
  s set-pixel --frame "$f" --x "$cx" --y $((cy+1)) --color "$col"
}

# ============================ MOTE (baseline charge unit) =====================
# A compact nugget of charged scrap: dark rim, silvery body, blue-white core.
# 6-frame crackle: the core pulses and a spark orbits the rim.
mote_body() { # <frame> <coreR> <arcR>
  local f=$1 cr=$2 ar=$3
  s fill-circle --frame "$f" --cx 12 --cy 12 --r 8 --color '#20262d'
  s fill-circle --frame "$f" --cx 12 --cy 12 --r 7 --color '#5a6570'
  s fill-circle --frame "$f" --cx 12 --cy 12 --r 5 --color '#c4cbd6'
  s fill-rect   --frame "$f" --x 8 --y 7 --width 4 --height 2 --color '#e8eef5'
  s fill-circle --frame "$f" --cx 12 --cy 12 --r "$ar" --color '#4ac6ff'
  s fill-circle --frame "$f" --cx 12 --cy 12 --r "$cr" --color '#eaf6ff'
}
newsheet 24 24 6 "$LOAD/mote/idle"
# per-frame: (coreR, arcR) pulse + orbiting spark position
mote_body 0 2 3; spark 0 12 1  '#4ac6ff'
mote_body 1 2 4; spark 1 21 9  '#eaf6ff'
mote_body 2 3 4; spark 2 20 19 '#4ac6ff'
mote_body 3 2 4; spark 3 12 22 '#eaf6ff'
mote_body 4 2 3; spark 4 3  18 '#4ac6ff'
mote_body 5 3 4; spark 5 1  10 '#eaf6ff'
echo "produced Mote charge cycle → $LOAD/mote/idle"

# ============================ SPARK (fast, fragile) ===========================
# Small, bright, wired-tight — a darting bead with radiating spikes; reads energetic.
spark_body() { # <frame> <coreR>
  local f=$1 cr=$2
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 6 --color '#2a3742'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 5 --color '#7fbfe0'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r 3 --color '#c8ecff'
  s fill-circle --frame "$f" --cx 10 --cy 10 --r "$cr" --color '#ffffff'
}
newsheet 20 20 6 "$LOAD/spark/idle"
# radiating spikes flicker between long/short across frames (a fast shimmer)
spark_body 0 2; s line --frame 0 --x0 10 --y0 1  --x1 10 --y1 4  --color '#eaf6ff'; s line --frame 0 --x0 15 --y0 10 --x1 18 --y1 10 --color '#4ac6ff'; s line --frame 0 --x0 2 --y0 10 --x1 5 --y1 10 --color '#4ac6ff'
spark_body 1 2; s line --frame 1 --x0 10 --y0 10 --x1 10 --y1 16 --color '#eaf6ff'; s line --frame 1 --x0 10 --y0 4  --x1 10 --y1 10 --color '#4ac6ff'
spark_body 2 3; s line --frame 2 --x0 4  --y0 4  --x1 7  --y1 7  --color '#eaf6ff'; s line --frame 2 --x0 13 --y0 13 --x1 16 --y1 16 --color '#eaf6ff'
spark_body 3 2; s line --frame 3 --x0 4  --y0 16 --x1 7  --y1 13 --color '#eaf6ff'; s line --frame 3 --x0 13 --y0 7  --x1 16 --y1 4  --color '#eaf6ff'
spark_body 4 2; s line --frame 4 --x0 2  --y0 10 --x1 5  --y1 10 --color '#eaf6ff'; s line --frame 4 --x0 15 --y0 10 --x1 18 --y1 10 --color '#eaf6ff'
spark_body 5 3; s line --frame 5 --x0 10 --y0 1  --x1 10 --y1 4  --color '#4ac6ff'; s line --frame 5 --x0 10 --y0 16 --x1 10 --y1 19 --color '#4ac6ff'
echo "produced Spark charge cycle → $LOAD/spark/idle"

# ============================ SLUG (slow, capacitive tank) ====================
# A bulky, armored mass of fused capacitor plates — heavy, dim, deep-blue charge.
# Slow deep pulse; reads as a wall of HP, not a live wire.
slug_body() { # <frame> <coreA>  (coreA = alpha-ish brightness via color choice)
  local f=$1 core=$2
  s fill-circle --frame "$f" --cx 16 --cy 17 --r 13 --color '#181d22'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 12 --color '#3a444e'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 10 --color '#4a555f'
  # riveted plate seams
  s line --frame "$f" --x0 6  --y0 16 --x1 26 --y1 16 --color '#242b31'
  s line --frame "$f" --x0 16 --y0 6  --x1 16 --y1 26 --color '#242b31'
  s fill-rect --frame "$f" --x 7  --y 8  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x 22 --y 8  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x 7  --y 21 --width 3 --height 3 --color '#2f373e'
  s fill-rect --frame "$f" --x 22 --y 21 --width 3 --height 3 --color '#2f373e'
  # deep capacitive core (slow, dim glow)
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 5 --color '#245a7a'
  s fill-circle --frame "$f" --cx 16 --cy 16 --r 3 --color "$core"
}
newsheet 32 32 6 "$LOAD/slug/idle"
slug_body 0 '#2f7fb0'; slug_body 1 '#3d94c8'
slug_body 2 '#4ac6ff'; spark 2 16 16 '#eaf6ff'
slug_body 3 '#4ac6ff'; slug_body 4 '#3d94c8'; slug_body 5 '#2f7fb0'
echo "produced Slug charge cycle → $LOAD/slug/idle"

# ============================ CLUSTER (tiny, dense packs) =====================
# A tight clump of four small charged bits — very low HP, arrives in packs; the
# individual bits jitter and flicker so the swarm reads as alive.
cbit() { # <frame> <cx> <cy> <coreR>
  local f=$1 cx=$2 cy=$3 cr=$4
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 3 --color '#2a3037'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 2 --color '#c4cbd6'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r "$cr" --color '#7fe0ff'
}
newsheet 20 20 6 "$LOAD/cluster/idle"
# four bits at slightly different jitter offsets + a flickering core each frame
cluster_frame() { # <frame> <ax> <ay> <bx> <by> <cx> <cy> <dx> <dy> <litIdx>
  local f=$1
  cbit "$f" "$2" "$3" $([ "${10}" = 0 ] && echo 2 || echo 1)
  cbit "$f" "$4" "$5" $([ "${10}" = 1 ] && echo 2 || echo 1)
  cbit "$f" "$6" "$7" $([ "${10}" = 2 ] && echo 2 || echo 1)
  cbit "$f" "$8" "$9" $([ "${10}" = 3 ] && echo 2 || echo 1)
}
cluster_frame 0  7 7  13 6  6 13 14 14 0
cluster_frame 1  6 7  14 6  7 14 13 13 1
cluster_frame 2  7 6  13 7  6 14 14 13 2
cluster_frame 3  7 7  14 7  7 13 13 14 3
cluster_frame 4  6 6  13 6  6 13 14 13 0
cluster_frame 5  7 6  14 7  7 14 13 13 2
# a stray micro-spark arcing between bits
spark 1 10 10 '#eaf6ff'
spark 3 10 9  '#eaf6ff'
spark 5 11 11 '#eaf6ff'
echo "produced Cluster charge cycle → $LOAD/cluster/idle"

# ============================ FILAMENT (the flyer) ============================
# Airborne plasma thread: a bright horizontal filament wreathed in arc-wings, with
# a faint downward glow (a hover halo) so it clearly reads as ABOVE the yard, not
# crawling it. Wings sweep and the thread crackles across the cycle.
fil_body() { # <frame> <threadW>
  local f=$1 tw=$2
  # hover halo beneath (translucent, implies it floats over the board)
  s fill-circle --frame "$f" --cx 14 --cy 20 --r 6 --color '#1c4a6633'
  s fill-circle --frame "$f" --cx 14 --cy 21 --r 3 --color '#2f7fb022'
  # the glowing plasma thread (horizontal capsule)
  s fill-rect   --frame "$f" --x $((14 - tw)) --y 12 --width $((tw*2)) --height 4 --color '#2f9fd0'
  s fill-rect   --frame "$f" --x $((14 - tw)) --y 13 --width $((tw*2)) --height 2 --color '#c8ecff'
  s fill-circle --frame "$f" --cx 14 --cy 14 --r 3 --color '#eaf6ff'
}
newsheet 28 28 6 "$LOAD/filament/idle"
# frame: body + arc-wings sweeping (short lines fanning up/down from the ends)
fil_frame() { # <frame> <threadW>
  local f=$1
  fil_body "$f" "$2"
}
fil_frame 0 8; s line --frame 0 --x0 6  --y0 14 --x1 2  --y1 9  --color '#4ac6ff'; s line --frame 0 --x0 22 --y0 14 --x1 26 --y1 9  --color '#4ac6ff'
fil_frame 1 9; s line --frame 1 --x0 5  --y0 14 --x1 1  --y1 14 --color '#eaf6ff'; s line --frame 1 --x0 23 --y0 14 --x1 27 --y1 14 --color '#eaf6ff'
fil_frame 2 8; s line --frame 2 --x0 6  --y0 14 --x1 2  --y1 19 --color '#4ac6ff'; s line --frame 2 --x0 22 --y0 14 --x1 26 --y1 19 --color '#4ac6ff'
fil_frame 3 9; s line --frame 3 --x0 5  --y0 14 --x1 1  --y1 14 --color '#eaf6ff'; s line --frame 3 --x0 23 --y0 14 --x1 27 --y1 14 --color '#eaf6ff'
fil_frame 4 8; s line --frame 4 --x0 6  --y0 14 --x1 2  --y1 9  --color '#4ac6ff'; s line --frame 4 --x0 22 --y0 14 --x1 26 --y1 9  --color '#4ac6ff'
fil_frame 5 10; spark 5 14 13 '#ffffff'; s line --frame 5 --x0 4 --y0 14 --x1 24 --y1 14 --color '#c8ecff88'
echo "produced Filament (flyer) charge cycle → $LOAD/filament/idle"

# ============================ DYNAMO (boss — overload core) ===================
# A large, unstable overload core: a dark riveted iron casing split by glowing
# cracks around a violent violet reactor core, wreathed in arcs that leap to
# different casing points. An 8-frame UNSTABLE WOBBLE: the casing shakes ±1px,
# the core swells and dims erratically, arcs jump — the boss visibly seethes.
dyn_body() { # <frame> <dx> <dy> <coreR> <coreCol> <ringCol>
  local f=$1 dx=$2 dy=$3 cr=$4 core=$5 ring=$6
  local cx=$((24+dx)) cy=$((24+dy))
  # dark iron casing shell
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 20 --color '#14181d'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 19 --color '#3a4048'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r 16 --color '#2b333c'
  # rivets around the casing (four cardinal, four diagonal)
  s fill-rect --frame "$f" --x $((cx-2))  --y $((cy-19)) --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-2))  --y $((cy+16)) --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-19)) --y $((cy-2))  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx+16)) --y $((cy-2))  --width 3 --height 3 --color '#5a6570'
  s fill-rect --frame "$f" --x $((cx-14)) --y $((cy-14)) --width 3 --height 3 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx+11)) --y $((cy-14)) --width 3 --height 3 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx-14)) --y $((cy+11)) --width 3 --height 3 --color '#4a555f'
  s fill-rect --frame "$f" --x $((cx+11)) --y $((cy+11)) --width 3 --height 3 --color '#4a555f'
  # glowing overload cracks (violet fissures through the casing)
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx-13)) --y1 $((cy-9))  --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx+12)) --y1 $((cy-11)) --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx+9))  --y1 $((cy+13)) --color "$ring"
  s line --frame "$f" --x0 "$cx" --y0 "$cy" --x1 $((cx-11)) --y1 $((cy+12)) --color "$ring"
  # the violent reactor core
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r $((cr+3)) --color '#5a2a8c'
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r $((cr+1)) --color "$ring"
  s fill-circle --frame "$f" --cx "$cx" --cy "$cy" --r "$cr" --color "$core"
}
newsheet 48 48 8 "$LOAD/dynamo/idle"
# unstable wobble: shake offset + core swell/dim + wreathing arc that jumps
dyn_body 0  0  0 4 '#d9b6ff' '#a45cff'; s line --frame 0 --x0 24 --y0 4  --x1 30 --y1 12 --color '#c8a0ff'
dyn_body 1  1 -1 6 '#f0e0ff' '#b978ff'; s line --frame 1 --x0 44 --y0 22 --x1 36 --y1 20 --color '#eaf6ff'
dyn_body 2 -1  0 5 '#d9b6ff' '#a45cff'; s line --frame 2 --x0 24 --y0 44 --x1 18 --y1 34 --color '#c8a0ff'
dyn_body 3  1  1 7 '#ffffff' '#c78cff'; s line --frame 3 --x0 4  --y0 24 --x1 13 --y1 27 --color '#eaf6ff'; spark 3 24 24 '#ffffff'
dyn_body 4  0  1 5 '#d9b6ff' '#a45cff'; s line --frame 4 --x0 40 --y0 8  --x1 33 --y1 15 --color '#c8a0ff'
dyn_body 5 -1 -1 6 '#f0e0ff' '#b978ff'; s line --frame 5 --x0 8  --y0 40 --x1 16 --y1 32 --color '#eaf6ff'
dyn_body 6  1  0 4 '#d9b6ff' '#a45cff'; s line --frame 6 --x0 42 --y0 40 --x1 34 --y1 33 --color '#c8a0ff'
dyn_body 7  0 -1 8 '#ffffff' '#c78cff'; s line --frame 7 --x0 24 --y0 4  --x1 30 --y1 13 --color '#eaf6ff'; spark 7 24 22 '#ffffff'
echo "produced Dynamo overload-wobble cycle → $LOAD/dynamo/idle"

echo "== all Load sprites produced under $LOAD =="
