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
# Three new base types (design bible §3/§8): choke = icy cyan slow/EM-drag,
# rectifier = ember burn, regulator = lime NON-firing support node.
core_choke=(_     "#274f5a" "#3d8a99" "#66d9e8" "#a6ecf3" "#e6fbff")
core_rectifier=(_ "#5f2c17" "#b0491f" "#ff6b3d" "#ff9e72" "#ffe0cf")
core_regulator=(_ "#455a22" "#7d9a34" "#b6e05a" "#d3ee96" "#f2fbd8")

# East muzzle x per type (where the barrel/terminal emits) — used by the fire cycle.
# regulator has no entry: it never fires (no muzzle, no fire cycle).
declare -A MZX=( [capacitor]=34 [coil]=32 [emitter]=35 [arcnode]=29 [discharge]=36 [choke]=33 [rectifier]=35 )

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

# Choke — a throttle/EM-drag valve: a boxy housing feeding a NARROWING constrictor
# throat (concentric rings closing toward the east aperture) that reads as "it drags
# the load". Icy-cyan core. Fires a slow bolt (muzzle x=33).
choke_body() {
  d fill-rect --x 7 --y 12 --width 15 --height 16 --color "$MM"    # intake housing
  d fill-rect --x 7 --y 12 --width 15 --height 2 --color "$ML"
  d fill-rect --x 7 --y 12 --width 2 --height 16 --color "$ML"
  d fill-rect --x 7 --y 26 --width 15 --height 2 --color "$MD"
  d fill-rect --x 9 --y 8 --width 3 --height 4 --color "$ML"       # drag vanes (top/bottom fins)
  d fill-rect --x 9 --y 28 --width 3 --height 4 --color "$MD"
  d line --x0 10 --y0 10 --x1 20 --y1 10 --color "$MD"
  d line --x0 10 --y0 30 --x1 20 --y1 30 --color "$MD"
  d fill-rect --x 21 --y 18 --width 4 --height 4 --color "$MM"      # neck
  d stroke-circle --cx 26 --cy 20 --r 7 --color "$MD"              # constrictor throat (narrowing)
  d stroke-circle --cx 28 --cy 20 --r 5 --color "$CORE"
  d stroke-circle --cx 30 --cy 20 --r 3 --color "$CORE"
  d fill-circle --cx 33 --cy 20 --r 2 --color "$CORE"              # aperture / muzzle
  d fill-circle --cx 14 --cy 20 --r 4 --color "$CORE"              # core coil
  d fill-circle --cx 14 --cy 20 --r 1 --color "$CORE_HOT"
}

# Rectifier — an overcurrent diode/heat-sink stack: a finned body with a glowing
# rectifier cell and a stubby heat-emitting barrel. Ember core. Fires a burn bolt
# (muzzle x=35).
rectifier_body() {
  d fill-rect --x 6 --y 11 --width 16 --height 18 --color "$MM"    # finned heat-sink
  d fill-rect --x 6 --y 11 --width 16 --height 2 --color "$ML"
  d fill-rect --x 6 --y 27 --width 16 --height 2 --color "$MD"
  d fill-rect --x 6 --y 11 --width 2 --height 18 --color "$ML"
  local fy
  for fy in 14 17 20 23 26; do d line --x0 8 --y0 "$fy" --x1 21 --y1 "$fy" --color "$MD"; done  # cooling fins
  d fill-rect --x 9 --y 13 --width 3 --height 14 --color "$CORE"   # glowing rectifier cell
  d fill-rect --x 10 --y 14 --width 1 --height 12 --color "$CORE_HOT"
  d fill-rect --x 22 --y 16 --width 13 --height 8 --color "$MM"    # heat-emitter barrel
  d fill-rect --x 22 --y 16 --width 13 --height 2 --color "$ML"
  d fill-rect --x 22 --y 22 --width 13 --height 2 --color "$MD"
  d fill-rect --x 33 --y 15 --width 2 --height 10 --color "$ML"    # muzzle ring
  d fill-circle --cx 35 --cy 20 --r 2 --color "$CORE"
}

# Regulator — a NON-firing support node (design bible §3): no gun barrel; instead a
# central aura emitter ringed by a concentric support field, with four antenna
# prongs. Reads as "it buffs, it never shoots". Lime core.
regulator_body() {
  d fill-circle --cx 20 --cy 20 --r 8 --color "$MM"                # central pylon housing
  d fill-circle --cx 18 --cy 18 --r 5 --color "$ML"               # sheen
  d fill-circle --cx 22 --cy 22 --r 5 --color "$MD"               # shade
  local p px py
  for p in "20 5" "35 20" "20 35" "5 20"; do                      # antenna prongs (aura nodes)
    read -r px py <<< "$p"
    d fill-circle --cx "$px" --cy "$py" --r 2 --color "$MD"
    d fill-circle --cx "$px" --cy "$py" --r 1 --color "$CORE"
  done
  d stroke-circle --cx 20 --cy 20 --r 15 --color "$MD"            # outer support field ring
  d stroke-circle --cx 20 --cy 20 --r 12 --color "$CORE"          # aura ring (accent)
  d fill-circle --cx 20 --cy 20 --r 4 --color "$CORE"             # aura emitter core (no barrel)
  d fill-circle --cx 20 --cy 20 --r 2 --color "$CORE_HOT"
  d set-pixel --x 20 --y 20 --color '#ffffff'
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

# =============================== COMBINATION TOWERS ============================
# The 12 terminal recipe-combine towers (design bible §4). SINGLE grade — no quality
# tiers: one head + one base + one 6-frame fire cycle each. Each must read as a
# "superior/special" turret: premium chrome body, a GOLD accent frame/badge
# (#ffe9a8, specs/overview.md), and its own dominant ability color; its east output
# element + trim vary by the combo's abilities (multishot → triple barrel, crit →
# pointed lance, splash → wide dish, aura → support rings, chain → toroid, slow/burn
# → cyan/ember flecks) so each of the twelve is visually distinct.
COMBO_ORDER=(fusecluster staticweb slagdriver corroder ionprism forkarray \
             nullcore rupturenode blightcoil reactorpile auroralance singularity)

# Premium chrome body + gold badge shared by every combo.
CMD="#39434e"; CMM="#66798a"; CML="#c8d8e4"
GOLD="#ffe9a8"; GOLD_D="#c9a24e"; GOLD_L="#fff4d0"

# Per-combo dominant accent (design bible §4/§8) + its bright core, and its ability set.
declare -A COMBO_ACC=(
  [fusecluster]="#ff6b3d" [staticweb]="#9b7bff" [slagdriver]="#ff5470"
  [corroder]="#b6e05a"    [ionprism]="#5ac8ff"  [forkarray]="#7fe6b0"
  [nullcore]="#8fe0b0"    [rupturenode]="#ffb347" [blightcoil]="#c46bff"
  [reactorpile]="#9be07a" [auroralance]="#66d9e8" [singularity]="#a45cff"
)
declare -A COMBO_HOT=(
  [fusecluster]="#ffb694" [staticweb]="#cbb8ff" [slagdriver]="#ff9aac"
  [corroder]="#dcef9e"    [ionprism]="#a6e2ff"  [forkarray]="#b6f2d6"
  [nullcore]="#c4f0d8"    [rupturenode]="#ffd28a" [blightcoil]="#e0b6ff"
  [reactorpile]="#cff0b0" [auroralance]="#a6ecf3" [singularity]="#d8b0ff"
)
declare -A COMBO_ABIL=(
  [fusecluster]="splash burn"       [staticweb]="chain slow"      [slagdriver]="crit"
  [corroder]="burn slow aura"       [ionprism]="splash burn crit" [forkarray]="multishot"
  [nullcore]="splash aura"          [rupturenode]="splash burn"   [blightcoil]="chain burn slow"
  [reactorpile]="chain multishot"   [auroralance]="chain slow"    [singularity]="splash burn crit aura"
)

has() { case " $ABIL " in *" $1 "*) return 0;; *) return 1;; esac; }

# --- the combo head body (uses $ACC/$ACCH/$ABIL + shared chrome/gold) -------------
combo_body() {
  d fill-circle --cx 18 --cy 20 --r 10 --color "$CMM"             # rounded core housing
  d fill-circle --cx 16 --cy 18 --r 7 --color "$CML"             # sheen
  d fill-circle --cx 20 --cy 22 --r 7 --color "$CMD"             # shade
  d stroke-circle --cx 18 --cy 20 --r 10 --color "$GOLD_D"       # gold rim (the combo badge)
  d stroke-circle --cx 18 --cy 20 --r 9 --color "$GOLD"
  local b bx by
  for b in "9 11" "9 29" "27 11" "27 29"; do                     # gold corner studs
    read -r bx by <<< "$b"; d fill-circle --cx "$bx" --cy "$by" --r 1 --color "$GOLD"
  done
  d fill-circle --cx 18 --cy 20 --r 5 --color "$ACC"             # accent core
  d fill-circle --cx 18 --cy 20 --r 2 --color "$ACCH"
  d set-pixel --x 18 --y 20 --color '#ffffff'

  if has aura; then                                              # support field rings
    d stroke-circle --cx 20 --cy 20 --r 17 --color "$ACC"
    d stroke-circle --cx 20 --cy 20 --r 14 --color "$GOLD_D"
  fi
  if has chain; then                                             # toroid coil node
    d fill-circle --cx 18 --cy 9 --r 3 --color "$CML"
    d stroke-circle --cx 18 --cy 9 --r 3 --color "$ACC"
    d fill-circle --cx 18 --cy 9 --r 1 --color "$ACCH"
  fi

  if has multishot; then                                         # triple barrel
    local yb
    for yb in 14 20 26; do
      d fill-rect --x 26 --y $((yb-2)) --width 12 --height 4 --color "$CMM"
      d fill-rect --x 26 --y $((yb-2)) --width 12 --height 1 --color "$CML"
      d fill-circle --cx 37 --cy "$yb" --r 1 --color "$ACC"
    done
    d fill-rect --x 25 --y 12 --width 2 --height 16 --color "$GOLD_D"
  elif has crit; then                                            # long pointed lance
    d fill-rect --x 26 --y 18 --width 12 --height 4 --color "$CMM"
    d fill-rect --x 26 --y 18 --width 12 --height 1 --color "$CML"
    d fill-rect --x 26 --y 21 --width 12 --height 1 --color "$CMD"
    d fill-circle --cx 33 --cy 20 --r 2 --color "$ACC"
    d line --x0 38 --y0 20 --x1 34 --y1 17 --color "$GOLD"
    d line --x0 38 --y0 20 --x1 34 --y1 23 --color "$GOLD"
    d fill-circle --cx 38 --cy 20 --r 1 --color "$ACCH"
  elif has splash; then                                          # wide flare dish
    d fill-rect --x 25 --y 17 --width 6 --height 6 --color "$CMM"
    d line --x0 31 --y0 13 --x1 38 --y1 11 --color "$GOLD_D"
    d line --x0 31 --y0 27 --x1 38 --y1 29 --color "$GOLD_D"
    d fill-rect --x 31 --y 15 --width 6 --height 10 --color "$ACC"
    d fill-rect --x 33 --y 17 --width 3 --height 6 --color "$ACCH"
    d stroke-circle --cx 33 --cy 20 --r 6 --color "$GOLD"
  else                                                           # chain/slow-only → toroid terminal
    d fill-rect --x 24 --y 18 --width 5 --height 4 --color "$CMM"
    d fill-circle --cx 33 --cy 20 --r 6 --color "$CML"
    d fill-circle --cx 33 --cy 20 --r 4 --color "$ACC"
    d fill-circle --cx 33 --cy 20 --r 1 --color "$ACCH"
  fi

  if has slow; then                                              # icy slow flecks
    d set-pixel --x 12 --y 12 --color '#a6ecf3'
    d set-pixel --x 11 --y 24 --color '#66d9e8'
    d set-pixel --x 24 --y 29 --color '#a6ecf3'
  fi
  if has burn; then                                              # ember burn flecks
    d set-pixel --x 13 --y 27 --color '#ff9e72'
    d set-pixel --x 22 --y 12 --color '#ff6b3d'
    d set-pixel --x 26 --y 25 --color '#ffb694'
  fi
}

# --- one combo's fixed base/mount (gold-trimmed, accent socket) -------------------
gen_combo_base() { # gen_combo_base <comboId>
  newsprite "$COMP/combo/$1/base.png"
  d fill-circle --cx 20 --cy 20 --r 15 --color '#0d141b'
  d stroke-circle --cx 20 --cy 20 --r 15 --color "$GOLD_D"       # gold outer ring
  d stroke-circle --cx 20 --cy 20 --r 13 --color '#1a222b'
  d stroke-circle --cx 20 --cy 20 --r 11 --color "$ACC"          # accent trim
  local b bx by
  for b in "9 9" "31 9" "9 31" "31 31"; do
    read -r bx by <<< "$b"
    d fill-circle --cx "$bx" --cy "$by" --r 2 --color "$GOLD_D"
    d set-pixel --x "$bx" --y "$by" --color "$GOLD"
  done
  d fill-circle --cx 20 --cy 20 --r 5 --color '#05080c'
  d fill-circle --cx 20 --cy 20 --r 3 --color "$ACC"
  d fill-circle --cx 20 --cy 20 --r 1 --color "$ACCH"
}

# --- one combo's 6-frame fire cycle (accent bolt with a GOLD discharge flash) -----
gen_combo_fire() { # gen_combo_fire <comboId>
  local mx=36 fx=34 hot='#fff4d6'
  newsheet "$COMP/combo/$1/fire"
  s fill-circle --frame 0 --cx 34 --cy 20 --r 2 --color "$ACC"
  s fill-circle --frame 1 --cx "$mx" --cy 20 --r 3 --color "$ACC"
  s fill-circle --frame 1 --cx "$mx" --cy 20 --r 1 --color "$hot"
  s fill-circle --frame 2 --cx "$mx" --cy 20 --r 4 --color "$ACC"
  s fill-circle --frame 2 --cx "$mx" --cy 20 --r 2 --color "$GOLD"
  s line --frame 2 --x0 "$mx" --y0 20 --x1 38 --y1 17 --color "$ACC"
  s fill-circle --frame 3 --cx "$fx" --cy 20 --r 6 --color "$ACC"
  s fill-circle --frame 3 --cx "$fx" --cy 20 --r 4 --color "$GOLD"
  s fill-circle --frame 3 --cx "$fx" --cy 20 --r 2 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 15 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 25 --color "$hot"
  s line --frame 3 --x0 "$mx" --y0 20 --x1 39 --y1 20 --color "$GOLD"
  s fill-circle --frame 3 --cx 39 --cy 20 --r 1 --color "$hot"
  s fill-circle --frame 4 --cx "$mx" --cy 20 --r 4 --color "$ACC"
  s fill-circle --frame 4 --cx "$mx" --cy 20 --r 2 --color "$GOLD"
  s line --frame 4 --x0 "$mx" --y0 20 --x1 38 --y1 20 --color "$ACC"
  s fill-circle --frame 5 --cx 35 --cy 20 --r 2 --color "$ACC"
  s set-pixel --frame 5 --x 38 --y 19 --color "$GOLD"
}

# --- one whole combo: head + base + fire cycle -----------------------------------
gen_combo() { # gen_combo <comboId>
  local id=$1
  ACC=${COMBO_ACC[$id]}; ACCH=${COMBO_HOT[$id]}; ABIL=${COMBO_ABIL[$id]}
  ARC_GLOW=$ACC
  newsprite "$COMP/combo/$id/head.png"
  combo_body
  draw_arcs 3                                                    # superior towers stay lightly wreathed
  gen_combo_base "$id"
  gen_combo_fire "$id"
}

# =============================== PRODUCE EVERYTHING =============================
# 5 original + 3 new base types (choke/rectifier icy-slow/ember-burn fire; regulator
# is the non-firing support node → 5 heads + base only, NO fire cycle).
TYPES=(capacitor coil emitter arcnode discharge choke rectifier regulator)
for type in "${TYPES[@]}"; do
  for tier in 1 2 3 4 5; do gen_head "$type" "$tier"; done
  gen_base "$type"
  if [ "$type" = "regulator" ]; then
    echo "produced $type: head_1..5 + base (non-firing support — no fire cycle)"
  else
    gen_fire "$type"
    echo "produced $type: head_1..5 + base + fire/0..5"
  fi
done

# The 12 combination towers (single grade).
for id in "${COMBO_ORDER[@]}"; do
  gen_combo "$id"
  echo "produced combo $id: head + base + fire/0..5"
done

echo "components written under $COMP"
