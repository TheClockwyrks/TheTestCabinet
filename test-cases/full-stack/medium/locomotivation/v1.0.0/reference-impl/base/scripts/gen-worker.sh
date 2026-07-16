#!/usr/bin/env bash
# Locomotivation — produce THE HEADLINE ASSET: the animated yard WORKER sprite-sheet
# cycles with the on-PATH `draw-sheet` tool (specs/assets.md "The animated worker", the
# centerpiece; specs/character.md "Animation states"; specs/overview.md palette).
#
# The worker is a SUITED yard hand in the ¾ view: an ORANGE-overalled figure wearing a
# YELLOW hi-vis vest (silver reflective bands) and a YELLOW hard hat, drawn as a REAL
# four-facing character — a distinct FRONT (down), BACK (up), and two profile SIDES
# (left / right), each authored independently (NOT one sprite mirrored). The silhouette —
# hard hat + brim, hi-vis vest with reflective stripe, overalls, work boots — is kept
# CONSISTENT across every state so it always reads as the same worker, only doing a
# different thing. The carry cycles read visibly LADEN: hunched, arms forward under a
# hauled crate.
#
# One `draw-sheet` cycle per (state, facing), ONE PNG PER FRAME, landed at the exact paths
# the game globs (ASSET-MANIFEST.md, assets/worker/<cycle>/<facing>/frameNN.png):
#
#   idle    4 frames × {down,up,left,right}   subtle breathing/settle bob (standing)
#   walk    6 frames × {down,up,left,right}   clear unladen walk cycle
#   sprint  6 frames × {down,up,left,right}   faster, leaning cadence
#   carry   6 frames × {down,up,left,right}   visibly laden/hunched haul cycle
#   drop    4 frames  (down, shared)          brief set-down beat
#   squish  5 frames  (shared)                signature death: a sharp flatten/impact
#
# `draw-sheet` writes each rendered frame to its preview path; we render to a scratch dir
# (never committed) and copy to zero-padded frameNN.png under assets/. The game build is
# SELF-CONTAINED and never invokes this tool — only the produced PNGs are committed. Re-run
# to regenerate.
#
# Usage:  bash scripts/gen-worker.sh   (draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tool: prefer PATH, else the cargo target release dir. -----------
if ! command -v draw-sheet >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH or in the cargo release dir" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/assets/worker"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"
W=44 ; H=44

# ============================== PALETTE (specs/overview.md) =====================
HAT='#ffd23a'   ; HAT_L='#ffe485' ; HAT_D='#c99417'                # hard hat / hi-vis yellow
VEST='#ffd23a'  ; VEST_L='#ffe485'; VEST_D='#c99417'               # hi-vis vest
REFLECT='#eef3f8'; REFLECT_D='#b9c2cc'                             # silver reflective bands
OVR='#c8562e'   ; OVR_L='#e6743f' ; OVR_D='#9c3f1e' ; OVR_XD='#742d13' # overalls (orange)
SKIN='#e8b48c'  ; SKIN_L='#f5cca6'; SKIN_D='#bd8560'               # skin
GLOVE='#33383f' ; GLOVE_L='#4c525b'                                # work gloves
BOOT='#2c2620'  ; BOOT_L='#463a2e'                                 # boots
CRATE='#a9773f' ; CRATE_L='#c69355'; CRATE_D='#6f4a22'             # hauled crate
STRAP='#742d13'                                                    # overall straps
OUTLINE='#241812'                                                  # eyes / dark accents
IMPACT_Y='#ffe485'; IMPACT_W='#fff7e0'; IMPACT_R='#ff5a52'; DUST='#b8ab97'  # squish fx

# ============================== SHEET PLUMBING =================================
STATE="" ; FACE="" ; NF=0 ; SDIR="" ; OUT=""
newsheet() { # newsheet <cycle> <facing|-> <nframes> : fresh 44x44 cycle -> scratch frameN.png
  STATE=$1 ; FACE=$2 ; NF=$3
  local tag="$STATE${FACE:+_$FACE}"
  SDIR="$TMP/$tag" ; mkdir -p "$SDIR"
  if [ "$FACE" = "-" ]; then OUT="$WORK/$STATE"; else OUT="$WORK/$STATE/$FACE"; fi
  mkdir -p "$OUT"
  local arr="" i
  for ((i=0;i<NF;i++)); do arr="$arr${arr:+,}$i"; done
  printf '{ "width":%d, "height":%d, "background":"transparent", "frames":[%s], "actions":"%s", "preview":"%s" }\n' \
    "$W" "$H" "$arr" "$SDIR/f_{frame}.json" "$SDIR/frame{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
sf() { local f=$1; shift; draw-sheet "$@" --frame "$f" --config "$CFG" >/dev/null; }  # sf <frame> <op...>
rectc() { # rectc <frame> <cx> <y> <w> <h> <color> : rect horizontally centered on cx
  sf "$1" fill-rect --x $(( $2 - $4/2 )) --y "$3" --width "$4" --height "$5" --color "$6"
}
finalize() {
  local i pad
  for ((i=0;i<NF;i++)); do
    pad=$(printf '%02d' "$i")
    cp "$SDIR/frame$i.png" "$OUT/frame$pad.png"
  done
  echo "  ${STATE}/${FACE}: $NF frames"
}

# ============================== SHARED PARTS ==================================
# All parts are offset-parameterized (ox horizontal lean, oy vertical bob) so the SAME
# silhouette poses differently per state. Center column is 22.

crate() { # crate <F> <cx> <cy> : a hauled wooden crate centered at (cx,cy)
  local F=$1 cx=$2 cy=$3
  rectc $F $cx $cy 15 11 "$CRATE"
  rectc $F $cx $cy 15 2 "$CRATE_L"
  sf $F fill-rect --x $((cx-7)) --y $((cy-5)) --width 2 --height 11 --color "$CRATE_L"
  sf $F fill-rect --x $((cx+5)) --y $((cy-5)) --width 2 --height 11 --color "$CRATE_D"
  sf $F fill-rect --x $((cx-6)) --y $((cy+4)) --width 12 --height 1 --color "$CRATE_D"
  sf $F line --x0 $((cx-6)) --y0 $((cy-4)) --x1 $((cx+6)) --y1 $((cy+5)) --color "$CRATE_D"
}

# ------------------------------ FRONT (facing DOWN) ---------------------------
front_head() { # <F> <ox> <oy>
  local F=$1 ox=$2 oy=$3
  local cx=$((22+ox)) cy=$((13+oy))
  rectc $F $cx $((cy+4)) 4 3 "$SKIN_D"                                   # neck
  sf $F fill-circle --cx $cx --cy $cy --r 6 --color "$SKIN"              # face
  sf $F fill-circle --cx $((cx-2)) --cy $((cy)) --r 4 --color "$SKIN_L"  # face light
  sf $F fill-circle --cx $((cx+3)) --cy $((cy+2)) --r 3 --color "$SKIN_D" # jaw shade
  sf $F fill-circle --cx $cx --cy $((cy-3)) --r 6 --color "$HAT"         # hat dome
  sf $F fill-circle --cx $((cx-2)) --cy $((cy-4)) --r 4 --color "$HAT_L" # dome light
  sf $F fill-circle --cx $((cx+2)) --cy $((cy-2)) --r 3 --color "$HAT_D" # dome shade
  rectc $F $cx $((cy-8)) 2 4 "$HAT_L"                                    # crown ridge
  rectc $F $cx $((cy-1)) 15 2 "$HAT_D"                                   # brim (front)
  rectc $F $cx $((cy-2)) 15 1 "$HAT"
  sf $F set-pixel --x $((cx-2)) --y $((cy+2)) --color "$OUTLINE"         # eyes
  sf $F set-pixel --x $((cx+2)) --y $((cy+2)) --color "$OUTLINE"
  sf $F fill-rect --x $((cx-1)) --y $((cy+4)) --width 3 --height 1 --color "$SKIN_D" # mouth line
}
front_torso() { # <F> <ox> <oy>
  local F=$1 ox=$2 oy=$3
  local cx=$((22+ox)) y=$((17+oy))
  rectc $F $cx $y 14 14 "$OVR"                                          # overalls body
  sf $F fill-rect --x $((cx-7)) --y $y --width 2 --height 14 --color "$OVR_D"
  sf $F fill-rect --x $((cx+5)) --y $y --width 2 --height 14 --color "$OVR_L"
  rectc $F $cx $y 12 9 "$VEST"                                          # hi-vis vest (upper)
  sf $F fill-rect --x $((cx-6)) --y $y --width 2 --height 9 --color "$VEST_L"
  sf $F fill-rect --x $((cx+4)) --y $y --width 2 --height 9 --color "$VEST_D"
  rectc $F $cx $((y+1)) 3 8 "$OVR"                                      # vest front zip gap
  rectc $F $cx $((y+3)) 12 1 "$REFLECT"                                 # reflective bands
  rectc $F $cx $((y+6)) 12 1 "$REFLECT_D"
  rectc $F $cx $((y+5)) 3 1 "$OVR"
  rectc $F $cx $((y+8)) 3 1 "$OVR"
  sf $F fill-rect --x $((cx-4)) --y $((y+10)) --width 2 --height 4 --color "$STRAP" # bib straps
  sf $F fill-rect --x $((cx+2)) --y $((y+10)) --width 2 --height 4 --color "$STRAP"
}
front_arms() { # <F> <ox> <oy> <sw:sideways sway>
  local F=$1 ox=$2 oy=$3 sw=$4
  local cx=$((22+ox)) y=$((18+oy))
  sf $F fill-rect --x $((cx-9+sw)) --y $y --width 3 --height 7 --color "$OVR"     # L sleeve
  sf $F fill-rect --x $((cx-9+sw)) --y $((y+7)) --width 3 --height 3 --color "$GLOVE" # L glove
  sf $F fill-rect --x $((cx+6-sw)) --y $y --width 3 --height 7 --color "$OVR_L"   # R sleeve
  sf $F fill-rect --x $((cx+6-sw)) --y $((y+7)) --width 3 --height 3 --color "$GLOVE" # R glove
}
front_arms_carry() { # arms bent forward, cradling a load
  local F=$1 ox=$2 oy=$3
  local cx=$((22+ox)) y=$((20+oy))
  sf $F fill-rect --x $((cx-9)) --y $y --width 3 --height 5 --color "$OVR"
  sf $F fill-rect --x $((cx-9)) --y $((y-2)) --width 3 --height 3 --color "$GLOVE" # L hand up
  sf $F fill-rect --x $((cx+6)) --y $y --width 3 --height 5 --color "$OVR_L"
  sf $F fill-rect --x $((cx+6)) --y $((y-2)) --width 3 --height 3 --color "$GLOVE" # R hand up
}
front_legs() { # <F> <ox> <ll:left lift> <rl:right lift>
  local F=$1 ox=$2 ll=$3 rl=$4
  local cx=$((22+ox)) y=$((31))
  sf $F fill-rect --x $((cx-5)) --y $((y-ll)) --width 4 --height $((9-ll)) --color "$OVR_D"  # L leg
  sf $F fill-rect --x $((cx+1)) --y $((y-rl)) --width 4 --height $((9-rl)) --color "$OVR"    # R leg
  sf $F fill-rect --x $((cx-6)) --y $((y+9-ll)) --width 5 --height 3 --color "$BOOT"         # L boot
  sf $F fill-rect --x $((cx-6)) --y $((y+9-ll)) --width 5 --height 1 --color "$BOOT_L"
  sf $F fill-rect --x $((cx+1)) --y $((y+9-rl)) --width 5 --height 3 --color "$BOOT"         # R boot
  sf $F fill-rect --x $((cx+1)) --y $((y+9-rl)) --width 5 --height 1 --color "$BOOT_L"
}

# ------------------------------ BACK (facing UP) ------------------------------
back_head() { # <F> <ox> <oy>
  local F=$1 ox=$2 oy=$3
  local cx=$((22+ox)) cy=$((13+oy))
  rectc $F $cx $((cy+3)) 5 3 "$SKIN_D"                                   # nape of neck
  sf $F fill-circle --cx $cx --cy $cy --r 6 --color "$HAT"               # back of hat
  sf $F fill-circle --cx $((cx-2)) --cy $((cy-2)) --r 4 --color "$HAT_L"
  sf $F fill-circle --cx $((cx+2)) --cy $((cy+1)) --r 4 --color "$HAT_D"
  rectc $F $cx $((cy-7)) 2 4 "$HAT_L"                                    # crown ridge
  rectc $F $cx $((cy+3)) 13 2 "$HAT_D"                                   # brim (back edge)
  rectc $F $cx $((cy+2)) 13 1 "$HAT"
}
back_torso() { # <F> <ox> <oy>
  local F=$1 ox=$2 oy=$3
  local cx=$((22+ox)) y=$((17+oy))
  rectc $F $cx $y 14 14 "$OVR"                                          # overalls back
  sf $F fill-rect --x $((cx-7)) --y $y --width 2 --height 14 --color "$OVR_D"
  sf $F fill-rect --x $((cx+5)) --y $y --width 2 --height 14 --color "$OVR_L"
  rectc $F $cx $y 12 10 "$VEST"                                         # vest back panel
  sf $F fill-rect --x $((cx-6)) --y $y --width 2 --height 10 --color "$VEST_L"
  sf $F fill-rect --x $((cx+4)) --y $y --width 2 --height 10 --color "$VEST_D"
  sf $F fill-rect --x $((cx-3)) --y $y --width 2 --height 10 --color "$REFLECT"   # vest back straps
  sf $F fill-rect --x $((cx+1)) --y $y --width 2 --height 10 --color "$REFLECT_D"
  rectc $F $cx $((y+6)) 12 1 "$REFLECT"                                 # horizontal band
}
back_legs() { front_legs "$@"; }  # legs read the same from behind (boots heel-on)

# ------------------------------ SIDE (facing LEFT/RIGHT) ----------------------
# D = +1 → faces RIGHT (toe +x); D = -1 → faces LEFT. Authored independently per facing.
side_head() { # <F> <D> <ox> <oy>
  local F=$1 D=$2 ox=$3 oy=$4
  local cx=$((22+ox+D)) cy=$((13+oy))
  rectc $F $((cx-D)) $((cy+4)) 4 3 "$SKIN_D"                             # neck
  sf $F fill-circle --cx $cx --cy $cy --r 6 --color "$SKIN"             # head
  sf $F fill-circle --cx $((cx+D)) --cy $((cy)) --r 4 --color "$SKIN_L" # front-lit
  sf $F fill-circle --cx $((cx-D*2)) --cy $((cy+1)) --r 3 --color "$SKIN_D" # back of head shade
  sf $F set-pixel --x $((cx+D*6)) --y $((cy+1)) --color "$SKIN_L"       # nose
  sf $F fill-circle --cx $cx --cy $((cy-3)) --r 6 --color "$HAT"        # hat dome
  sf $F fill-circle --cx $((cx-D)) --cy $((cy-4)) --r 4 --color "$HAT_L"
  sf $F fill-circle --cx $((cx+D*2)) --cy $((cy-2)) --r 3 --color "$HAT_D"
  local bx=$(( D>0 ? cx-1 : cx-6 ))                                     # brim (forward)
  sf $F fill-rect --x $bx --y $((cy-1)) --width 7 --height 2 --color "$HAT_D"
  sf $F fill-rect --x $bx --y $((cy-2)) --width 7 --height 1 --color "$HAT"
  sf $F set-pixel --x $((cx+D)) --y $((cy+2)) --color "$OUTLINE"        # eye
}
side_torso() { # <F> <D> <ox> <oy>
  local F=$1 D=$2 ox=$3 oy=$4
  local cx=$((22+ox)) y=$((17+oy))
  rectc $F $cx $y 10 14 "$OVR"                                          # overalls (slim profile)
  sf $F fill-rect --x $(( cx - D*5 )) --y $y --width 2 --height 14 --color "$OVR_D"  # back edge shade
  rectc $F $cx $y 10 9 "$VEST"                                          # hi-vis vest
  sf $F fill-rect --x $(( D>0 ? cx+2 : cx-4 )) --y $y --width 2 --height 9 --color "$REFLECT" # front reflective stripe
  rectc $F $cx $((y+4)) 10 1 "$REFLECT_D"                               # horizontal band
  sf $F fill-rect --x $(( cx - D*4 )) --y $((y+10)) --width 2 --height 4 --color "$STRAP" # bib strap
}
side_arm() { # <F> <D> <ox> <oy> <sw:swing forward+/back->
  local F=$1 D=$2 ox=$3 oy=$4 sw=$5
  local cx=$((22+ox)) y=$((18+oy))
  local hx=$(( cx + D*(2+sw) ))
  sf $F fill-rect --x $(( hx - 1 )) --y $y --width 3 --height 7 --color "$OVR_L" # sleeve
  sf $F fill-rect --x $(( hx - 1 )) --y $((y+7)) --width 3 --height 3 --color "$GLOVE" # glove
}
side_arm_carry() { # bent forward under the load
  local F=$1 D=$2 ox=$3 oy=$4
  local cx=$((22+ox)) y=$((20+oy))
  local hx=$(( cx + D*4 ))
  sf $F fill-rect --x $(( hx - 1 )) --y $y --width 3 --height 4 --color "$OVR_L"
  sf $F fill-rect --x $(( hx - 1 + D )) --y $((y-2)) --width 3 --height 3 --color "$GLOVE"
}
side_boot() { # <F> <D> <cx> <y>
  local F=$1 D=$2 cx=$3 y=$4
  sf $F fill-rect --x $((cx-2)) --y $y --width 5 --height 3 --color "$BOOT"
  sf $F fill-rect --x $((cx-2)) --y $y --width 5 --height 1 --color "$BOOT_L"
  sf $F fill-rect --x $(( D>0 ? cx+3 : cx-4 )) --y $((y+1)) --width 2 --height 2 --color "$BOOT_L" # toe
}
side_legs() { # <F> <D> <ox> <st:stride>
  local F=$1 D=$2 ox=$3 st=$4
  local cx=$((22+ox)) y=31
  local fx=$(( cx + D*(2+st) )) bx=$(( cx - D*(2+st) ))
  sf $F fill-rect --x $((bx-2)) --y $y --width 4 --height 9 --color "$OVR_D"     # back leg
  side_boot $F $D $bx $((y+9))
  sf $F fill-rect --x $((fx-2)) --y $y --width 4 --height 9 --color "$OVR"       # front leg
  side_boot $F $D $fx $((y+9))
}

# ============================== COMPOSERS =====================================
compose_front() { # <F> <ox> <oy> <ll> <rl> <sw> <carry>
  local F=$1 ox=$2 oy=$3 ll=$4 rl=$5 sw=$6 carry=$7
  front_legs $F $ox $ll $rl
  front_torso $F $ox $oy
  if [ "$carry" -gt 0 ]; then front_arms_carry $F $ox $oy; else front_arms $F $ox $oy $sw; fi
  front_head $F $ox $oy
  [ "$carry" -gt 0 ] && crate $F $((22+ox)) $((24+oy))
  return 0
}
compose_back() { # <F> <ox> <oy> <ll> <rl> <sw> <carry>
  local F=$1 ox=$2 oy=$3 ll=$4 rl=$5 sw=$6 carry=$7
  back_legs $F $ox $ll $rl
  back_torso $F $ox $oy
  if [ "$carry" -gt 0 ]; then
    front_arms_carry $F $ox $oy                                        # arms forward (behind body from back)
    crate $F $((22+ox)) $((23+oy))                                     # load peeks over the shoulders
  else
    front_arms $F $ox $oy $sw
  fi
  back_head $F $ox $oy
  return 0
}
compose_side() { # <F> <D> <ox> <oy> <st> <arm> <carry>
  local F=$1 D=$2 ox=$3 oy=$4 st=$5 arm=$6 carry=$7
  side_legs $F $D $ox $st
  side_torso $F $D $ox $oy
  side_head $F $D $ox $oy
  if [ "$carry" -gt 0 ]; then
    crate $F $((22+ox+D*5)) $((25+oy))                                 # load out front
    side_arm_carry $F $D $ox $oy
  else
    side_arm $F $D $ox $oy $arm
  fi
  return 0
}

# dispatch a facing by name
compose() { # <facing> <F> <ox> <oy> <legA> <legB> <swing> <carry>
  case "$1" in
    down)  compose_front "$2" "$3" "$4" "$5" "$6" "$7" "$8" ;;
    up)    compose_back  "$2" "$3" "$4" "$5" "$6" "$7" "$8" ;;
    left)  compose_side  "$2" -1  "$3" "$4" "$5" "$7" "$8" ;;   # legB unused; swing=$7 as stride/arm
    right) compose_side  "$2"  1  "$3" "$4" "$5" "$7" "$8" ;;
  esac
}

# ============================== CYCLES ========================================
# For front/back: legA=left-lift, legB=right-lift, swing=arm sway, carry.
# For side: legA=stride, swing=arm swing (opposite of stride), carry.

gen_cardinal_cycle() { # <state> <facing> <carry> — builds walk-family motion for one facing
  local state=$1 face=$2 carry=$3
  case "$state" in
    idle)   frames_idle  "$face" "$carry" ;;
    walk)   frames_walk  "$face" "$carry" 0 ;;
    sprint) frames_walk  "$face" "$carry" 1 ;;
    carry)  frames_walk  "$face" 1 0 ;;
  esac
}

frames_idle() { # <facing> <carry>
  local face=$1 carry=$2
  newsheet idle "$face" 4
  local oys=(0 -1 -1 0) F oy
  for F in 0 1 2 3; do
    oy=${oys[$F]}
    if [ "$face" = left ] || [ "$face" = right ]; then
      compose "$face" $F 0 $oy 0 0 0 "$carry"          # stride 0, arm 0
    else
      compose "$face" $F 0 $oy 0 0 0 "$carry"
    fi
  done
  finalize
}

frames_walk() { # <facing> <carry> <sprint>
  local face=$1 carry=$2 sprint=$3
  local st=walk; [ "$sprint" -gt 0 ] && st=sprint; [ "$carry" -gt 0 ] && [ "$sprint" -eq 0 ] && st=carry
  newsheet "$st" "$face" 6
  local F
  # front/back leg-lift + body-bob patterns
  local L=(0 0 0 2 1 0) R=(2 1 0 0 0 0) BOB=(-1 0 0 -1 0 0) SWAY=(1 0 -1 -1 0 1)
  # side stride + opposite arm swing
  local STR=(3 2 0 -3 -2 0) ARM=(-3 -2 0 3 2 0) SBOB=(0 -1 0 0 -1 0)
  local lean=0 oyx=0 amp=1
  if [ "$sprint" -gt 0 ]; then amp=2; oyx=1; fi         # sprint: lower, punchier
  if [ "$carry" -gt 0 ]; then oyx=2; fi                 # carry: hunched down
  for F in 0 1 2 3 4 5; do
    if [ "$face" = left ] || [ "$face" = right ]; then
      local d=1; [ "$face" = left ] && d=-1
      local s=${STR[$F]} a=${ARM[$F]} oy=$(( ${SBOB[$F]} + oyx ))
      if [ "$sprint" -gt 0 ]; then s=$(( s*3/2 )); a=$(( a*3/2 )); lean=$(( d*2 )); fi
      if [ "$carry" -gt 0 ]; then s=$(( s/2 )); fi
      compose "$face" $F $lean $oy $s 0 $a "$carry"
      if [ "$sprint" -gt 0 ]; then                      # motion streak behind
        sf $F line --x0 $(( 22 - d*10 )) --y0 $((20+oy)) --x1 $(( 22 - d*14 )) --y1 $((20+oy)) --color "$DUST"
      fi
    else
      local ll=$(( ${L[$F]}*amp )) rl=$(( ${R[$F]}*amp )) sw=${SWAY[$F]} oy=$(( ${BOB[$F]} + oyx ))
      [ "$sprint" -gt 0 ] && { ll=$(( ll>3?3:ll )); rl=$(( rl>3?3:rl )); }
      [ "$carry" -gt 0 ] && { ll=$(( ll>1?1:ll )); rl=$(( rl>1?1:rl )); sw=0; }
      compose "$face" $F 0 $oy $ll $rl $sw "$carry"
    fi
  done
  finalize
}

frames_drop() { # down-facing set-down beat, 4 frames
  newsheet drop down 4
  # f0 hold high, f1 bend, f2 crate on ground, f3 rise empty
  local oys=(0 3 5 1) cys=(24 30 36 0) hold=(1 1 0 0)
  local F oy cy
  for F in 0 1 2 3; do
    oy=${oys[$F]} ; cy=${cys[$F]}
    front_legs $F 0 0 0
    front_torso $F 0 $oy
    if [ "${hold[$F]}" -gt 0 ]; then
      front_arms_carry $F 0 $oy
    else
      # arms reaching down to set/release
      sf $F fill-rect --x 12 --y $((22+oy)) --width 3 --height 8 --color "$OVR"
      sf $F fill-rect --x 12 --y $((30+oy)) --width 3 --height 3 --color "$GLOVE"
      sf $F fill-rect --x 29 --y $((22+oy)) --width 3 --height 8 --color "$OVR_L"
      sf $F fill-rect --x 29 --y $((30+oy)) --width 3 --height 3 --color "$GLOVE"
    fi
    front_head $F 0 $oy
    [ "$cy" -gt 0 ] && crate $F 22 $cy
  done
  finalize
}

frames_squish() { # shared death: a sharp flatten/impact, 5 frames
  newsheet squish - 5
  local F
  # f0: braced/compressed but upright-ish
  F=0
  front_legs $F 0 0 0
  front_torso $F 0 2
  front_arms $F 0 2 0
  front_head $F 0 3
  sf $F line --x0 6 --y0 22 --x1 2 --y1 20 --color "$IMPACT_W"
  sf $F line --x0 38 --y0 22 --x1 42 --y1 20 --color "$IMPACT_W"
  # f1: buckling — torso squat, hat pops up
  F=1
  rectc $F 22 40 18 4 "$OVR_D"                         # spread legs
  rectc $F 22 30 20 11 "$OVR"                          # squashed body
  rectc $F 22 31 18 5 "$VEST"
  rectc $F 22 33 18 1 "$REFLECT"
  sf $F fill-circle --cx 22 --cy 22 --r 6 --color "$HAT"   # hat lifting
  sf $F fill-circle --cx 22 --cy 27 --r 5 --color "$SKIN"  # head
  sf $F set-pixel --x 20 --y 26 --color "$OUTLINE"; sf $F set-pixel --x 24 --y 26 --color "$OUTLINE"
  sf $F line --x0 4 --y0 24 --x1 0 --y1 21 --color "$IMPACT_Y"
  sf $F line --x0 40 --y0 24 --x1 44 --y1 21 --color "$IMPACT_Y"
  # f2: PANCAKE — wide, very short, impact star
  F=2
  rectc $F 22 40 30 4 "$OVR"                           # flattened body
  rectc $F 22 38 32 3 "$VEST"
  rectc $F 22 39 30 1 "$REFLECT"
  rectc $F 22 41 34 2 "$OVR_D"
  sf $F fill-circle --cx 9 --cy 39 --r 3 --color "$HAT"   # hat flung left
  sf $F fill-circle --cx 33 --cy 40 --r 2 --color "$SKIN" # head squished right
  sf $F fill-circle --cx 22 --cy 30 --r 7 --color "${IMPACT_R}" # impact flash
  sf $F fill-circle --cx 22 --cy 30 --r 4 --color "$IMPACT_W"
  local a
  for a in "2 22 40 8" "42 22 4 8" "22 44 12 20" "10 24 4 12" "34 24 40 12"; do
    set -- $a; sf $F line --x0 22 --y0 32 --x1 $1 --y1 $2 --color "$IMPACT_Y"
  done
  # f3: settle — flat splat, dust rising
  F=3
  rectc $F 22 41 30 3 "$OVR"
  rectc $F 22 40 30 2 "$VEST"
  rectc $F 22 40 26 1 "$REFLECT"
  sf $F fill-circle --cx 8 --cy 40 --r 3 --color "$HAT"
  sf $F fill-circle --cx 34 --cy 41 --r 2 --color "$SKIN"
  sf $F fill-circle --cx 12 --cy 30 --r 2 --color "$DUST"
  sf $F fill-circle --cx 30 --cy 28 --r 2 --color "$DUST"
  sf $F set-pixel --x 22 --y 26 --color "$DUST"
  # f4: aftermath — flat splat + settling hat, faint dust
  F=4
  rectc $F 22 42 28 2 "$OVR"
  rectc $F 22 41 28 1 "$VEST"
  rectc $F 22 41 22 1 "$REFLECT"
  sf $F fill-circle --cx 9 --cy 41 --r 3 --color "$HAT"
  sf $F fill-circle --cx 9 --cy 40 --r 2 --color "$HAT_L"
  sf $F fill-circle --cx 33 --cy 42 --r 2 --color "$SKIN"
  sf $F set-pixel --x 16 --y 33 --color "$DUST"
  sf $F set-pixel --x 27 --y 32 --color "$DUST"
  finalize
}

# ============================== PRODUCE EVERYTHING ============================
echo "producing the animated yard worker (44x44, four facings) under assets/worker/ ..."
for face in down up left right; do
  for state in idle walk sprint carry; do
    gen_cardinal_cycle "$state" "$face" 0
  done
done
frames_drop
frames_squish
echo "done."
