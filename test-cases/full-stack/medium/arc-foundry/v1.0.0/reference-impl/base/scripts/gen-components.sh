#!/usr/bin/env bash
# Arc Foundry — produce the COMPONENT (tower) sprites with the on-PATH asset tools
# (specs/assets.md §11.1–11.2). This script owns the `assets/components/` category:
#
#   • the 5 component TYPES × 5 quality TIERS — each a rotatable, EAST-facing (+x) firing
#     head on a fixed base, drawn with `draw`. The quality ladder must READ: finish +
#     arc intensity escalate every rung (Scrap → Tuned → Charged → Primed → Tesla-Prime,
#     specs/towers.md, specs/overview.md). T1 is pitted/rusted/dim; T5 is mirror-chromed
#     and wreathed in continuous arcs.
#   • one non-rotatable base/mount per type (`components/<type>/base.png`) that sits under
#     the head (the head rotates to aim; the base does not).
#   • a 6-frame charge-and-discharge MUZZLE-FIRE cycle per type, drawn with `draw-sheet`
#     (one PNG per frame under `components/<type>/fire/`), played when the component fires.
#
# The game loads these exact paths via src/assets.ts (componentHead/componentBase/
# componentFire). Sizes: a component occupies a 2×2 tile / 40×40 px footprint
# (specs/board.md §2.3), so every sprite is a 40×40 transparent (straight-alpha) canvas
# with the pivot at its center (20,20) and the head/muzzle pointing +x (east).
#
# Usage:  bash scripts/gen-components.sh   (draw/draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume). Re-run to
#         regenerate. The game build itself is SELF-CONTAINED and never invokes these tools;
#         the produced PNGs are committed.
set -euo pipefail

# --- Resolve the tools: prefer PATH, else the cargo target release dir. ----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMP="$ROOT/assets/components"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers (draw) -----------------------------------------------
newsprite() { # newsprite <out.png> : fresh 40×40 transparent canvas -> <out.png>
  mkdir -p "$(dirname "$1")"
  printf '{ "width": 40, "height": 40, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$TMP/log.json" "$1" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# --- sheet helpers (draw-sheet, 6 frames) ---------------------------------------
newsheet() { # newsheet <dir> : 6-frame cycle -> <dir>/{0..5}.png
  mkdir -p "$1"
  printf '{ "width": 40, "height": 40, "background": "transparent", "frames": [0,1,2,3,4,5], "actions": "%s", "preview": "%s" }\n' \
    "$TMP/f_{frame}.json" "$1/{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# =============================== QUALITY LADDER =================================
# Per-tier METAL finish (dark / mid / light), escalating from rusted matte (T1) to
# mirror chrome (T5), and per-tier ARC count (rest-arcs wreathing the head, T3+).
# Index 0 is unused padding so tiers index 1..5 directly.
tier_md=(_ "#332e28" "#333d47" "#3a4855" "#45525f" "#5a6b78")   # darkest metal
tier_mm=(_ "#4a4238" "#4e5966" "#5c6e7d" "#6d8291" "#93a9b8")   # mid metal (body)
tier_ml=(_ "#5f5647" "#6d7986" "#8ea1b0" "#aebecb" "#e6f1f8")   # light metal (sheen)
tier_arcs=(_ 0 0 2 4 7)                                          # rest-arc filaments

# Per-TYPE core glow ramp (tier 1..5): dim/desaturated at Scrap → blinding at Tesla-Prime,
# in each type's accent hue (specs/overview.md palette). Index 5 doubles as the hottest core.
core_capacitor=(_ "#2f5a72" "#3f88b0" "#5ac8ff" "#9ee0ff" "#e6f7ff")
core_coil=(_      "#463a66" "#6b52b0" "#9b7bff" "#c3b0ff" "#efe8ff")
core_emitter=(_   "#376a54" "#4fa07a" "#7fe6b0" "#b6f2d6" "#e8fff4")
core_arcnode=(_   "#6e4a1e" "#b07a2c" "#ffb347" "#ffd28a" "#fff2d6")
core_discharge=(_ "#6e2436" "#b03a52" "#ff5470" "#ff9aac" "#ffe0e6")

# East muzzle x per type (where the barrel/terminal emits) — used by the fire cycle.
declare -A MZX=( [capacitor]=34 [coil]=32 [emitter]=35 [arcnode]=29 [discharge]=36 )

# Ambient rest-arc filament pool: "x0 y0  x1 y1  x2 y2" polylines around a generic head.
ARC_POOL=(
  "33 20 37 16 38 20"
  "14 10 17 5 21 9"
  "14 30 17 35 21 31"
  "30 13 34 9 37 12"
  "30 27 34 31 37 28"
  "9 11 4 7 9 6"
  "9 29 4 33 9 34"
)

draw_arcs() { # draw_arcs <n> : n white-hot arc filaments with a colored fork (ARC_GLOW)
  local n=$1 i=0 spec a b c e f g
  [ "$n" -eq 0 ] && return
  for spec in "${ARC_POOL[@]}"; do
    [ "$i" -ge "$n" ] && break
    read -r a b c e f g <<< "$spec"
    d line --x0 "$a" --y0 "$b" --x1 "$c" --y1 "$e" --color "$ARC_GLOW"     # main, glow
    d line --x0 "$c" --y0 "$e" --x1 "$f" --y1 "$g" --color "$ARC_GLOW"     # fork, glow
    d line --x0 "$a" --y0 "$b" --x1 "$c" --y1 "$e" --color '#eaf6ff'       # main, white-hot
    i=$((i + 1))
  done
}

pit_body() { # T1 only: pitting specks + rust patches on the body
  local p x y
  for p in "10 14" "13 22" "18 16" "21 25" "15 27" "24 19" "12 18"; do
    read -r x y <<< "$p"; d set-pixel --x "$x" --y "$y" --color '#241f19'
  done
  d fill-rect --x 9 --y 24 --width 3 --height 2 --color '#5c3a20'
  d fill-rect --x 20 --y 12 --width 2 --height 3 --color '#5c3a20'
}

chrome_body() { # T5 only: mirror-chrome highlight streaks
  d line --x0 9 --y0 13 --x1 14 --y1 18 --color '#f2fafd'
  d line --x0 9 --y0 14 --x1 13 --y1 18 --color '#cfe6f2'
  d line --x0 24 --y0 12 --x1 27 --y1 15 --color '#f2fafd'
}

# --- per-type bodies (draw the head facing +x; use $MD/$MM/$ML/$CORE/$CORE_HOT) --
capacitor_body() {
  d fill-rect --x 8 --y 11 --width 18 --height 18 --color "$MM"
  d fill-rect --x 8 --y 11 --width 18 --height 3 --color "$ML"
  d fill-rect --x 8 --y 11 --width 3 --height 18 --color "$ML"
  d fill-rect --x 8 --y 26 --width 18 --height 3 --color "$MD"
  d fill-rect --x 23 --y 11 --width 3 --height 18 --color "$MD"
  d fill-rect --x 11 --y 8 --width 4 --height 4 --color "$ML"    # terminal caps
  d fill-rect --x 18 --y 8 --width 4 --height 4 --color "$ML"
  d fill-rect --x 11 --y 8 --width 11 --height 1 --color "$MD"
  d fill-rect --x 26 --y 16 --width 9 --height 8 --color "$MM"   # east nozzle
  d fill-rect --x 26 --y 16 --width 9 --height 2 --color "$ML"
  d fill-rect --x 26 --y 22 --width 9 --height 2 --color "$MD"
  d fill-rect --x 33 --y 15 --width 2 --height 10 --color "$ML"  # muzzle ring
  d fill-circle --cx 17 --cy 20 --r 4 --color "$CORE"
  d fill-circle --cx 17 --cy 20 --r 1 --color "$CORE_HOT"
  d fill-circle --cx 34 --cy 20 --r 2 --color "$CORE"
}

coil_body() {
  d fill-rect --x 6 --y 12 --width 16 --height 16 --color "$MM"
  d fill-rect --x 6 --y 12 --width 16 --height 2 --color "$ML"
  d fill-rect --x 6 --y 26 --width 16 --height 2 --color "$MD"
  local yy
  for yy in 15 18 21 24; do d line --x0 6 --y0 "$yy" --x1 21 --y1 "$yy" --color "$ML"; done  # windings
  d fill-rect --x 11 --y 13 --width 5 --height 14 --color "$CORE"  # core column
  d fill-rect --x 13 --y 14 --width 1 --height 12 --color "$CORE_HOT"
  d fill-rect --x 22 --y 18 --width 6 --height 4 --color "$MM"     # neck
  d fill-circle --cx 31 --cy 20 --r 6 --color "$ML"               # toroid terminal ball
  d fill-circle --cx 31 --cy 20 --r 4 --color "$CORE"
  d fill-circle --cx 31 --cy 20 --r 1 --color "$CORE_HOT"
}

emitter_body() {
  d fill-rect --x 7 --y 13 --width 13 --height 14 --color "$MM"
  d fill-rect --x 7 --y 13 --width 13 --height 2 --color "$ML"
  d fill-rect --x 7 --y 25 --width 13 --height 2 --color "$MD"
  d fill-rect --x 20 --y 17 --width 16 --height 6 --color "$MM"    # long thin barrel
  d fill-rect --x 20 --y 17 --width 16 --height 1 --color "$ML"
  d fill-rect --x 20 --y 22 --width 16 --height 1 --color "$MD"
  local vx
  for vx in 24 28 32; do
    d fill-rect --x "$vx" --y 17 --width 1 --height 1 --color "$MD"  # cooling vents
    d fill-rect --x "$vx" --y 22 --width 1 --height 1 --color "$MD"
  done
  d fill-circle --cx 13 --cy 20 --r 3 --color "$CORE"
  d fill-circle --cx 13 --cy 20 --r 1 --color "$CORE_HOT"
  d fill-circle --cx 35 --cy 20 --r 2 --color "$CORE"             # aperture
}

arcnode_body() {
  d fill-circle --cx 15 --cy 20 --r 9 --color "$MM"
  d fill-circle --cx 13 --cy 18 --r 6 --color "$ML"              # top-left sheen
  d fill-circle --cx 17 --cy 22 --r 6 --color "$MD"              # bottom-right shade
  d fill-rect --x 22 --y 18 --width 5 --height 4 --color "$MM"    # neck
  d stroke-circle --cx 29 --cy 20 --r 7 --color "$MD"           # discharge ring (front dish)
  d stroke-circle --cx 29 --cy 20 --r 5 --color "$CORE"
  d fill-circle --cx 15 --cy 20 --r 4 --color "$CORE"           # central orb
  d fill-circle --cx 15 --cy 20 --r 1 --color "$CORE_HOT"
}

discharge_body() {
  d fill-rect --x 5 --y 9 --width 18 --height 22 --color "$MM"    # heavy bank body
  d fill-rect --x 5 --y 9 --width 18 --height 3 --color "$ML"
  d fill-rect --x 5 --y 9 --width 3 --height 22 --color "$ML"
  d fill-rect --x 5 --y 28 --width 18 --height 3 --color "$MD"
  d fill-rect --x 20 --y 9 --width 3 --height 22 --color "$MD"
  d line --x0 5 --y0 16 --x1 22 --y1 16 --color "$MD"            # bank cell divisions
  d line --x0 5 --y0 24 --x1 22 --y1 24 --color "$MD"
  d fill-rect --x 9 --y 12 --width 4 --height 16 --color "$CORE"  # charged bank core
  d fill-rect --x 10 --y 20 --width 2 --height 1 --color "$CORE_HOT"
  d fill-rect --x 23 --y 15 --width 13 --height 10 --color "$MM"  # thick barrel
  d fill-rect --x 23 --y 15 --width 13 --height 2 --color "$ML"
  d fill-rect --x 23 --y 23 --width 13 --height 2 --color "$MD"
  d fill-rect --x 33 --y 13 --width 3 --height 14 --color "$ML"   # muzzle brake
  d fill-rect --x 34 --y 17 --width 2 --height 6 --color "$MD"
  d fill-circle --cx 36 --cy 20 --r 2 --color "$CORE"
}

# --- one head: set the tier palette + type core, draw body, finish, arcs ---------
gen_head() { # gen_head <type> <tier>
  local type=$1 tier=$2
  local -n coreArr="core_$type"
  MD=${tier_md[$tier]}; MM=${tier_mm[$tier]}; ML=${tier_ml[$tier]}
  CORE=${coreArr[$tier]}; CORE_HOT=${coreArr[5]}; ARC_GLOW=${coreArr[4]}
  newsprite "$COMP/$type/head_$tier.png"
  "${type}_body"
  [ "$tier" -eq 1 ] && pit_body
  [ "$tier" -eq 5 ] && chrome_body
  draw_arcs "${tier_arcs[$tier]}"
}

# --- one type's fixed base/mount (does not rotate) -------------------------------
gen_base() { # gen_base <type>
  local type=$1
  local -n coreArr="core_$type"
  local acc=${coreArr[3]} accd=${coreArr[2]}
  newsprite "$COMP/$type/base.png"
  d fill-circle --cx 20 --cy 20 --r 15 --color '#0d141b'   # dark mounting pad
  d stroke-circle --cx 20 --cy 20 --r 15 --color '#2a333d'
  d stroke-circle --cx 20 --cy 20 --r 14 --color '#1a222b'
  d stroke-circle --cx 20 --cy 20 --r 11 --color "$accd"   # type-accent trim
  local b bx by
  for b in "9 9" "31 9" "9 31" "31 31"; do                 # corner bolts
    read -r bx by <<< "$b"
    d fill-circle --cx "$bx" --cy "$by" --r 2 --color '#39434e'
    d set-pixel --x "$bx" --y "$by" --color "$accd"
  done
  d fill-circle --cx 20 --cy 20 --r 5 --color '#05080c'    # center socket
  d fill-circle --cx 20 --cy 20 --r 3 --color "$accd"
  d fill-circle --cx 20 --cy 20 --r 1 --color "$acc"
}

# --- one type's 6-frame charge-and-discharge muzzle cycle ------------------------
gen_fire() { # gen_fire <type>
  local type=$1
  local -n coreArr="core_$type"
  local acc=${coreArr[3]} accd=${coreArr[2]} hot='#eaf6ff'
  local mx=${MZX[$type]} fx=$(( ${MZX[$type]} - 2 ))
  newsheet "$COMP/$type/fire"
  # f0 pre-charge glimmer
  s fill-circle --frame 0 --cx $(( mx - 2 )) --cy 20 --r 2 --color "$accd"
  # f1 charging
  s fill-circle --frame 1 --cx "$mx" --cy 20 --r 3 --color "$acc"
  s fill-circle --frame 1 --cx "$mx" --cy 20 --r 1 --color "$hot"
  # f2 full charge, arc forming
  s fill-circle --frame 2 --cx "$mx" --cy 20 --r 4 --color "$acc"
  s fill-circle --frame 2 --cx "$mx" --cy 20 --r 2 --color "$hot"
  s line --frame 2 --x0 "$mx" --y0 20 --x1 38 --y1 17 --color "$acc"
  # f3 DISCHARGE — big flash + forked muzzle bolt east
  s fill-circle --frame 3 --cx "$fx" --cy 20 --r 6 --color "$acc"
  s fill-circle --frame 3 --cx "$fx" --cy 20 --r 4 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 15 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 25 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 20 --color "$acc"
  s fill-circle --frame 3 --cx 39 --cy 20 --r 1 --color "$hot"
  # f4 fade
  s fill-circle --frame 4 --cx "$mx" --cy 20 --r 4 --color "$acc"
  s fill-circle --frame 4 --cx "$mx" --cy 20 --r 2 --color "$hot"
  s line --frame 4 --x0 "$mx" --y0 20 --x1 38 --y1 20 --color "$acc"
  # f5 residual speck
  s fill-circle --frame 5 --cx $(( mx - 1 )) --cy 20 --r 2 --color "$accd"
  s set-pixel --frame 5 --x 38 --y 19 --color "$acc"
}

# =============================== PRODUCE EVERYTHING =============================
TYPES=(capacitor coil emitter arcnode discharge)
for type in "${TYPES[@]}"; do
  for tier in 1 2 3 4 5; do gen_head "$type" "$tier"; done
  gen_base "$type"
  gen_fire "$type"
  echo "produced $type: head_1..5 + base + fire/0..5"
done

echo "components written under $COMP"
