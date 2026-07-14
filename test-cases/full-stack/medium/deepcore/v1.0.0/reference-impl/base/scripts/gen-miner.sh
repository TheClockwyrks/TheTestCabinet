#!/usr/bin/env bash
# Deepcore — produce THE HEADLINE ASSET: the animated MINER (prospector) sprite-sheet
# cycles with the on-PATH `draw-sheet` tool (specs/assets.md "The animated miner", the
# centerpiece; specs/character.md "Animation states"; specs/overview.md palette).
#
# The prospector is a SUITED figure with a handheld DRILL and a back-mounted JETPACK,
# drawn ~44x44 facing +x (EAST); the engine MIRRORS the sprite to face west. The
# silhouette — helmet + suit-lamp, chest lamp, jetpack, and drill — is kept CONSISTENT
# across every state so it always reads as the same miner, only doing a different thing.
# The set escalates the sense of effort: idle is a gentle breath, the drill shakes and
# throws chips, the jetpack strains with a live flame, the fall goes limp, the hurt snaps,
# the fuel-out slumps with a dead pack.
#
# One `draw-sheet` cycle per animation state, ONE PNG PER FRAME, landed at the exact paths
# the engine globs (ASSET-LAYOUT.md, assets/miner/<state>/frameNN.png):
#
#   idle        3 frames   breathing bob + lamp flicker (standing at rest)
#   walk        6 frames   scissoring walk cycle, drill swinging
#   drill-down  4 frames   braced, drill biting the floor, body shaking + chips
#   drill-side  4 frames   braced, drill biting the wall ahead (+x), shaking + chips
#   jetpack     4 frames   thrusting up, flame flicker at the nozzles, legs tucked
#   fall        3 frames   dropping, arms/legs trailing, wind streaks (no flame)
#   hurt        3 frames   one-shot flinch/recoil + impact flash ("took a hit")
#   fuel-out    3 frames   slumped, powerless, jetpack dead (the fail-state read)
#
# `draw-sheet` writes each rendered frame to its preview path; we render to a scratch dir
# (never committed) and copy to zero-padded frameNN.png under assets/. The game build is
# SELF-CONTAINED and never invokes this tool — only the produced PNGs are committed. Re-run
# to regenerate.
#
# Usage:  bash scripts/gen-miner.sh   (draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tool: prefer PATH, else the cargo target release dir. -----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH or in the cargo release dir" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MINER="$ROOT/assets/miner"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# ============================== PALETTE (specs/overview.md) =====================
SUIT_L='#ffcf9a'  ; SUIT_M='#d9a76e' ; SUIT_D='#a87a4a' ; SUIT_XD='#7a5632'  # suit / lamp
VISOR='#243a42'   ; VISOR_L='#3f6b78'; GLINT='#bfe8f0'                         # helmet glass
LAMP='#ffcf9a'    ; LAMP_HOT='#fff3d8'                                         # suit lamp
JP_L='#5f6b78'    ; JP_M='#454f5a'   ; JP_D='#2e363f'                          # jetpack metal
FLAME_O='#ffa63a' ; FLAME_Y='#ffe08a'; FLAME_W='#fff7e0'; FLAME_R='#ff6a2a'    # jetpack flame
DR_L='#aebecb'    ; DR_M='#6d7986'   ; DR_D='#454f5a'  ; DR_BIT='#cdd6e0'      # drill metal
BOOT='#4a4038'    ; BOOT_L='#5f5445'                                           # boots
STRIPE='#ffcf4a'                                                               # warn stripe
ALERT='#ff5a52'   ; CRED='#ffd23a'                                            # hit shock

# ============================== SHEET PLUMBING =================================
STATE="" ; NF=0 ; SDIR="" ; OUT=""
newsheet() { # newsheet <state> <nframes> : a fresh 44x44 cycle -> scratch frameN.png
  STATE=$1 ; NF=$2
  SDIR="$TMP/$STATE" ; mkdir -p "$SDIR"
  OUT="$MINER/$STATE" ; mkdir -p "$OUT"
  local arr="" i
  for ((i=0;i<NF;i++)); do arr="$arr${arr:+,}$i"; done
  printf '{ "width":44, "height":44, "background":"transparent", "frames":[%s], "actions":"%s", "preview":"%s" }\n' \
    "$arr" "$SDIR/f_{frame}.json" "$SDIR/frame{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
sf() { local f=$1; shift; draw-sheet "$@" --frame "$f" --config "$CFG" >/dev/null; }  # sf <frame> <op...>
finalize() { # copy the rendered scratch frames to zero-padded committed PNGs
  local i pad
  for ((i=0;i<NF;i++)); do
    pad=$(printf '%02d' "$i")
    cp "$SDIR/frame$i.png" "$OUT/frame$pad.png"
  done
  echo "  $STATE: $NF frames -> assets/miner/$STATE/frame00..$(printf '%02d' $((NF-1))).png"
}

# ============================== SHARED BODY PARTS ==============================
# Every part is offset-parameterized so the SAME silhouette poses differently per state.

boot() { # boot <frame> <x> <y> : a stubby east-toed boot
  local F=$1 x=$2 y=$3
  sf $F fill-rect --x $x --y $y --width 6 --height 3 --color "$BOOT"
  sf $F fill-rect --x $x --y $y --width 6 --height 1 --color "$BOOT_L"
  sf $F fill-rect --x $((x+4)) --y $y --width 2 --height 3 --color "$BOOT_L"   # toe (east)
}

draw_jetpack() { # draw_jetpack <frame> <ox> <oy> <flame> : back pack + optional live flame
  local F=$1 ox=$2 oy=$3 flame=$4
  local x=$((7+ox)) y=$((15+oy)) nx
  sf $F fill-rect --x $x --y $y --width 8 --height 14 --color "$JP_M"
  sf $F fill-rect --x $x --y $y --width 2 --height 14 --color "$JP_L"          # west edge light
  sf $F fill-rect --x $((x+6)) --y $y --width 2 --height 14 --color "$JP_D"    # inboard shadow
  sf $F fill-rect --x $((x+1)) --y $((y-2)) --width 5 --height 2 --color "$JP_L"   # top cap
  sf $F fill-rect --x $((x+1)) --y $((y+6)) --width 6 --height 1 --color "$STRIPE" # warn stripe
  sf $F fill-rect --x $((x+1)) --y $((y+14)) --width 3 --height 2 --color "$JP_D"  # nozzles
  sf $F fill-rect --x $((x+5)) --y $((y+14)) --width 3 --height 2 --color "$JP_D"
  if [ "$flame" -gt 0 ]; then
    local fy=$((y+17)) inner=$((flame>1?flame-1:1))
    for nx in $((x+2)) $((x+6)); do
      sf $F fill-circle --cx $nx --cy $fy --r $flame --color "$FLAME_O"
      sf $F fill-circle --cx $nx --cy $((fy+flame)) --r $inner --color "$FLAME_R"
      sf $F fill-circle --cx $nx --cy $fy --r 1 --color "$FLAME_W"
      sf $F set-pixel --x $nx --y $((fy-flame)) --color "$FLAME_Y"
    done
  fi
}

draw_jetpack_dead() { # a cold, dark pack (fuel-out) — no stripe glow, no flame
  local F=$1 ox=$2 oy=$3
  local x=$((7+ox)) y=$((15+oy))
  sf $F fill-rect --x $x --y $y --width 8 --height 14 --color "$JP_D"
  sf $F fill-rect --x $x --y $y --width 2 --height 14 --color "$JP_M"
  sf $F fill-rect --x $((x+1)) --y $((y+6)) --width 6 --height 1 --color "$SUIT_XD"  # dead stripe
  sf $F fill-rect --x $((x+1)) --y $((y+14)) --width 3 --height 2 --color "$JP_D"
  sf $F fill-rect --x $((x+5)) --y $((y+14)) --width 3 --height 2 --color "$JP_D"
}

draw_torso() { # draw_torso <frame> <ox> <oy>
  local F=$1 ox=$2 oy=$3
  local x=$((15+ox)) y=$((17+oy))
  sf $F fill-rect --x $x --y $y --width 12 --height 13 --color "$SUIT_M"
  sf $F fill-rect --x $x --y $y --width 12 --height 2 --color "$SUIT_L"        # shoulder light
  sf $F fill-rect --x $x --y $y --width 2 --height 13 --color "$SUIT_D"        # west shade
  sf $F fill-rect --x $((x+10)) --y $y --width 2 --height 13 --color "$SUIT_L" # east highlight
  sf $F fill-rect --x $x --y $((y+10)) --width 12 --height 2 --color "$SUIT_XD"  # belt
  sf $F fill-circle --cx $((x+6)) --cy $((y+5)) --r 2 --color "$SUIT_L"        # chest lamp
  sf $F set-pixel --x $((x+6)) --y $((y+5)) --color "$LAMP_HOT"
}

draw_helmet() { # draw_helmet <frame> <ox> <oy> <lamp:0dim/1/2bright>
  local F=$1 ox=$2 oy=$3 lamp=$4
  local cx=$((23+ox)) cy=$((11+oy)) lr=2
  sf $F fill-circle --cx $cx --cy $cy --r 6 --color "$SUIT_M"                  # dome
  sf $F fill-circle --cx $((cx-1)) --cy $((cy-2)) --r 4 --color "$SUIT_L"      # top-left light
  sf $F fill-circle --cx $((cx+2)) --cy $((cy+2)) --r 4 --color "$SUIT_D"      # lower-right shade
  sf $F fill-rect --x $((cx-3)) --y $((cy+5)) --width 6 --height 2 --color "$SUIT_XD"  # neck ring
  sf $F fill-circle --cx $((cx+4)) --cy $((cy+1)) --r 3 --color "$VISOR"       # visor (east)
  sf $F fill-circle --cx $((cx+5)) --cy $cy --r 1 --color "$VISOR_L"
  sf $F set-pixel --x $((cx+3)) --y $((cy+2)) --color "$GLINT"                 # visor glint
  if [ "$lamp" -ge 1 ]; then
    [ "$lamp" -ge 2 ] && lr=3
    sf $F fill-circle --cx $((cx+5)) --cy $((cy-4)) --r $lr --color "$LAMP"    # headlamp
    sf $F fill-circle --cx $((cx+5)) --cy $((cy-4)) --r 1 --color "$LAMP_HOT"
    [ "$lamp" -ge 2 ] && sf $F set-pixel --x $((cx+8)) --y $((cy-4)) --color "$LAMP"  # light spill
  else
    sf $F fill-circle --cx $((cx+5)) --cy $((cy-4)) --r 1 --color "$SUIT_D"    # lamp dark
  fi
  return 0
}

# --- leg poses -----------------------------------------------------------------
draw_legs_stand() { # feet planted, weight even
  local F=$1 ox=$2 oy=$3 y=$((30+oy))
  sf $F fill-rect --x $((16+ox)) --y $y --width 4 --height 8 --color "$SUIT_D"  # back (west) leg
  sf $F fill-rect --x $((22+ox)) --y $y --width 4 --height 8 --color "$SUIT_M"  # front (east) leg
  boot $F $((15+ox)) $((y+8))
  boot $F $((21+ox)) $((y+8))
}
draw_legs_brace() { # wide braced stance (drilling)
  local F=$1 ox=$2 oy=$3 y=$((30+oy))
  sf $F fill-rect --x $((14+ox)) --y $y --width 4 --height 8 --color "$SUIT_D"
  sf $F fill-rect --x $((24+ox)) --y $y --width 4 --height 8 --color "$SUIT_M"
  boot $F $((12+ox)) $((y+8))
  boot $F $((25+ox)) $((y+8))
}
draw_legs_walk() { # scissoring stride, sw = swing amount
  local F=$1 ox=$2 oy=$3 sw=$4 y=$((30+oy))
  local backx=$((18+ox-sw)) frontx=$((20+ox+sw))
  sf $F fill-rect --x $backx --y $y --width 4 --height 8 --color "$SUIT_D"
  sf $F fill-rect --x $frontx --y $y --width 4 --height 8 --color "$SUIT_M"
  boot $F $((backx-1)) $((y+8))
  boot $F $((frontx-1)) $((y+8))
}
draw_legs_tuck() { # knees drawn up (jetpack ascent)
  local F=$1 ox=$2 oy=$3 y=$((30+oy))
  sf $F fill-rect --x $((16+ox)) --y $y --width 4 --height 5 --color "$SUIT_D"
  sf $F fill-rect --x $((13+ox)) --y $((y+4)) --width 4 --height 4 --color "$SUIT_D"
  boot $F $((12+ox)) $((y+7))
  sf $F fill-rect --x $((22+ox)) --y $y --width 4 --height 5 --color "$SUIT_M"
  sf $F fill-rect --x $((23+ox)) --y $((y+4)) --width 4 --height 4 --color "$SUIT_M"
  boot $F $((23+ox)) $((y+7))
}
draw_legs_trail() { # legs kicked back-up, trailing a fall
  local F=$1 ox=$2 w=$3
  sf $F fill-rect --x $((16+ox)) --y 31 --width 4 --height 4 --color "$SUIT_D"
  sf $F fill-rect --x $((12+ox-w)) --y 33 --width 4 --height 3 --color "$SUIT_D"
  boot $F $((10+ox-w)) 33
  sf $F fill-rect --x $((23+ox)) --y 31 --width 4 --height 4 --color "$SUIT_M"
  sf $F fill-rect --x $((25+ox+w)) --y 33 --width 4 --height 3 --color "$SUIT_M"
  boot $F $((27+ox+w)) 33
}
draw_legs_slump() { # buckled, splayed outward (fuel-out)
  local F=$1 ox=$2 oy=$3 y=$((32+oy))
  sf $F fill-rect --x $((13+ox)) --y $y --width 5 --height 4 --color "$SUIT_D"
  boot $F $((11+ox)) $((y+4))
  sf $F fill-rect --x $((24+ox)) --y $y --width 5 --height 4 --color "$SUIT_M"
  boot $F $((26+ox)) $((y+4))
}

# --- arm + drill poses (the handheld drill is part of the silhouette) -----------
drill_flutes() { # drill_flutes <frame> <ax> <ay> <spin> : 2-pixel spin flicker on the bit
  local F=$1 ax=$2 ay=$3 spin=$4
  if [ $((spin%2)) -eq 0 ]; then
    sf $F set-pixel --x $ax --y $((ay-1)) --color "$DR_D"
    sf $F set-pixel --x $((ax+1)) --y $((ay+1)) --color "$DR_D"
  else
    sf $F set-pixel --x $ax --y $((ay+1)) --color "$DR_D"
    sf $F set-pixel --x $((ax+1)) --y $((ay-1)) --color "$DR_D"
  fi
}
draw_drill_side() { # arm + drill held forward, biting east
  local F=$1 ox=$2 oy=$3 spin=$4 y=$((19+oy))
  sf $F fill-rect --x $((25+ox)) --y $((20+oy)) --width 5 --height 4 --color "$SUIT_M"   # upper arm
  sf $F fill-rect --x $((29+ox)) --y $((20+oy)) --width 2 --height 4 --color "$SUIT_D"   # glove
  sf $F fill-rect --x $((30+ox)) --y $y --width 7 --height 7 --color "$DR_M"             # housing
  sf $F fill-rect --x $((30+ox)) --y $y --width 7 --height 1 --color "$DR_L"
  sf $F fill-rect --x $((30+ox)) --y $((y+6)) --width 7 --height 1 --color "$DR_D"
  sf $F fill-rect --x $((37+ox)) --y $((y+1)) --width 2 --height 5 --color "$DR_L"       # chuck
  sf $F fill-rect --x $((39+ox)) --y $((y+1)) --width 2 --height 5 --color "$DR_BIT"     # auger cone
  sf $F fill-rect --x $((41+ox)) --y $((y+2)) --width 1 --height 3 --color "$DR_BIT"
  sf $F set-pixel --x $((42+ox)) --y $((y+3)) --color "$DR_L"                            # tip
  drill_flutes $F $((39+ox)) $((y+3)) $spin
}
draw_drill_down() { # arm + drill angled down, biting the floor
  local F=$1 ox=$2 oy=$3 spin=$4
  sf $F fill-rect --x $((24+ox)) --y $((21+oy)) --width 4 --height 5 --color "$SUIT_M"   # arm down
  sf $F fill-rect --x $((25+ox)) --y $((25+oy)) --width 3 --height 3 --color "$SUIT_D"   # glove
  sf $F fill-rect --x $((24+ox)) --y $((27+oy)) --width 7 --height 7 --color "$DR_M"     # housing (vert)
  sf $F fill-rect --x $((24+ox)) --y $((27+oy)) --width 1 --height 7 --color "$DR_L"
  sf $F fill-rect --x $((30+ox)) --y $((27+oy)) --width 1 --height 7 --color "$DR_D"
  sf $F fill-rect --x $((25+ox)) --y $((34+oy)) --width 5 --height 2 --color "$DR_L"     # chuck
  sf $F fill-rect --x $((25+ox)) --y $((36+oy)) --width 5 --height 2 --color "$DR_BIT"   # auger cone
  sf $F fill-rect --x $((26+ox)) --y $((38+oy)) --width 3 --height 1 --color "$DR_BIT"
  sf $F set-pixel --x $((27+ox)) --y $((39+oy)) --color "$DR_L"                          # tip
  drill_flutes $F $((26+ox)) $((37+oy)) $spin
}
draw_drill_up() { # arm + drill flung up (fall)
  local F=$1 ox=$2 oy=$3
  sf $F fill-rect --x $((26+ox)) --y $((14+oy)) --width 4 --height 5 --color "$SUIT_M"   # arm up
  sf $F fill-rect --x $((28+ox)) --y $((12+oy)) --width 3 --height 3 --color "$SUIT_D"   # glove
  sf $F fill-rect --x $((29+ox)) --y $((7+oy)) --width 6 --height 6 --color "$DR_M"      # housing
  sf $F fill-rect --x $((29+ox)) --y $((7+oy)) --width 6 --height 1 --color "$DR_L"
  sf $F fill-rect --x $((31+ox)) --y $((3+oy)) --width 2 --height 4 --color "$DR_BIT"    # bit up
  sf $F set-pixel --x $((32+ox)) --y $((2+oy)) --color "$DR_L"
}
draw_drill_recoil() { # arm thrown up-east (hurt)
  local F=$1 ox=$2 oy=$3
  sf $F fill-rect --x $((26+ox)) --y $((16+oy)) --width 4 --height 4 --color "$SUIT_M"
  sf $F fill-rect --x $((29+ox)) --y $((13+oy)) --width 3 --height 3 --color "$SUIT_D"
  sf $F fill-rect --x $((31+ox)) --y $((10+oy)) --width 6 --height 5 --color "$DR_M"
  sf $F fill-rect --x $((31+ox)) --y $((10+oy)) --width 6 --height 1 --color "$DR_L"
  sf $F fill-rect --x $((37+ox)) --y $((7+oy)) --width 2 --height 4 --color "$DR_BIT"
}
draw_drill_droop() { # limp arm + dull drill hanging down (fuel-out)
  local F=$1 ox=$2 oy=$3
  sf $F fill-rect --x $((26+ox)) --y $((22+oy)) --width 3 --height 6 --color "$SUIT_D"
  sf $F fill-rect --x $((25+ox)) --y $((28+oy)) --width 6 --height 5 --color "$DR_D"
  sf $F fill-rect --x $((26+ox)) --y $((33+oy)) --width 3 --height 3 --color "$DR_M"
}

# --- effect flourishes ---------------------------------------------------------
cut_spark_down() { # rock chips off the floor bit
  local F=$1 x=$2 y=$3 f=$4 ; local w=$((f%2))
  sf $F set-pixel --x $((x-3)) --y $((y+w)) --color "$FLAME_Y"
  sf $F set-pixel --x $((x+3)) --y $((y-w)) --color "$LAMP_HOT"
  sf $F set-pixel --x $((x-2)) --y $((y+2)) --color "$DR_L"
  sf $F set-pixel --x $((x+2)) --y $((y+2)) --color "$DR_L"
  [ $w -eq 0 ] && sf $F set-pixel --x $x --y $((y+3)) --color "$FLAME_W"
  return 0
}
cut_spark_side() { # rock chips off the wall bit
  local F=$1 x=$2 y=$3 f=$4 ; local w=$((f%2))
  sf $F set-pixel --x $x --y $((y-2)) --color "$FLAME_Y"
  sf $F set-pixel --x $x --y $((y+2)) --color "$LAMP_HOT"
  sf $F set-pixel --x $((x-1)) --y $((y-3+w)) --color "$DR_L"
  [ $w -eq 0 ] && sf $F set-pixel --x $x --y $y --color "$FLAME_W"
  return 0
}
hurt_flash() { # radiating impact star, sz shrinks over the one-shot
  local F=$1 x=$2 y=$3 sz=$4 inner
  [ "$sz" -lt 1 ] && sz=1
  inner=$((sz>1?sz-1:1))
  sf $F fill-circle --cx $x --cy $y --r $sz --color "$FLAME_R"
  sf $F fill-circle --cx $x --cy $y --r $inner --color "$FLAME_W"
  sf $F line --x0 $x --y0 $y --x1 $((x+sz+3)) --y1 $((y-sz-2)) --color "$ALERT"
  sf $F line --x0 $x --y0 $y --x1 $((x-sz-3)) --y1 $((y+sz+2)) --color "$ALERT"
  sf $F line --x0 $x --y0 $y --x1 $((x+sz+2)) --y1 $((y+sz+3)) --color "$CRED"
}

# ============================== STATES ========================================

state_idle() { # 3 frames: gentle breath + lamp flicker (feet planted)
  newsheet idle 3
  local F oy lamp
  local oys=(0 -1 0) lamps=(1 2 1)
  for F in 0 1 2; do
    oy=${oys[$F]} ; lamp=${lamps[$F]}
    draw_jetpack $F 0 "$oy" 0
    draw_legs_stand $F 0 0                # feet stay planted while the torso bobs
    draw_torso $F 0 "$oy"
    draw_drill_side $F 0 "$oy" 0
    draw_helmet $F 0 "$oy" "$lamp"
  done
  finalize
}

state_walk() { # 6 frames: scissoring stride, drill swings, torso bobs on the pass
  newsheet walk 6
  local F sw oy
  local sws=(3 1 -2 -3 -1 2) oys=(0 -1 0 0 -1 0)
  for F in 0 1 2 3 4 5; do
    sw=${sws[$F]} ; oy=${oys[$F]}
    draw_jetpack $F 0 "$oy" 0
    draw_legs_walk $F 0 0 "$sw"
    draw_torso $F 0 "$oy"
    draw_drill_side $F 0 "$oy" "$F"
    draw_helmet $F 0 "$oy" 1
  done
  finalize
}

state_drill_down() { # 4 frames loop: braced, drill biting the floor, body shake + chips
  newsheet drill-down 4
  local F ox oy
  local oxs=(0 1 0 -1) oys=(0 1 0 1)
  for F in 0 1 2 3; do
    ox=${oxs[$F]} ; oy=${oys[$F]}
    draw_jetpack $F "$ox" "$oy" 0
    draw_legs_brace $F "$ox" 0
    draw_torso $F "$ox" "$oy"
    draw_helmet $F "$ox" "$oy" 2
    draw_drill_down $F "$ox" "$oy" "$F"
    cut_spark_down $F $((27+ox)) $((40+oy)) "$F"
  done
  finalize
}

state_drill_side() { # 4 frames loop: braced, drill biting the wall (+x), shake + chips
  newsheet drill-side 4
  local F ox oy
  local oxs=(0 -1 0 -1) oys=(0 1 0 1)
  for F in 0 1 2 3; do
    ox=${oxs[$F]} ; oy=${oys[$F]}
    draw_jetpack $F "$ox" "$oy" 0
    draw_legs_brace $F "$ox" 0
    draw_torso $F "$ox" "$oy"
    draw_drill_side $F "$ox" "$oy" "$F"
    draw_helmet $F "$ox" "$oy" 2
    cut_spark_side $F $((42+ox)) $((22+oy)) "$F"
  done
  finalize
}

state_jetpack() { # 4 frames loop: thrusting, flame flicker, legs tucked, lamp bright
  newsheet jetpack 4
  local F fl oy
  local fls=(3 2 4 2) oys=(-1 0 -2 0)
  for F in 0 1 2 3; do
    fl=${fls[$F]} ; oy=${oys[$F]}
    draw_jetpack $F 0 "$oy" "$fl"
    draw_legs_tuck $F 0 "$oy"
    draw_torso $F 0 "$oy"
    draw_drill_side $F 0 "$oy" 0
    draw_helmet $F 0 "$oy" 2
  done
  finalize
}

state_fall() { # 3 frames: limbs trailing, arms up, wind streaks (no flame)
  newsheet fall 3
  local F ox
  local oxs=(0 1 -1)
  for F in 0 1 2; do
    ox=${oxs[$F]}
    draw_jetpack $F "$ox" 0 0
    draw_legs_trail $F "$ox" $((F%2))
    draw_torso $F "$ox" 0
    draw_drill_up $F "$ox" 0
    draw_helmet $F "$ox" 0 1
    sf $F line --x0 $((6+ox)) --y0 40 --x1 $((8+ox)) --y1 34 --color "$SUIT_D"   # wind streaks
    sf $F line --x0 $((34+ox)) --y0 42 --x1 $((33+ox)) --y1 36 --color "$SUIT_D"
  done
  finalize
}

state_hurt() { # 3 frames one-shot: head snaps back, arm flings, impact flash decays
  newsheet hurt 3
  local F hx oy
  local hxs=(-3 -2 -1) oys=(1 0 0)
  for F in 0 1 2; do
    hx=${hxs[$F]} ; oy=${oys[$F]}
    draw_jetpack $F "$hx" "$oy" 0
    draw_legs_brace $F "$hx" 0
    draw_torso $F "$hx" "$oy"
    draw_drill_recoil $F "$hx" "$oy"
    draw_helmet $F "$hx" "$oy" 1
    hurt_flash $F $((30+hx)) $((16+oy)) $((3-F))
  done
  finalize
}

state_fuel_out() { # 3 frames: slumped, powerless, jetpack dead
  newsheet fuel-out 3
  local F oy hd
  local oys=(2 3 3) hds=(2 4 4)
  for F in 0 1 2; do
    oy=${oys[$F]} ; hd=${hds[$F]}
    draw_jetpack_dead $F 0 "$oy"
    draw_legs_slump $F 0 "$oy"
    draw_torso $F 0 "$oy"
    draw_drill_droop $F 0 "$oy"
    draw_helmet $F "$hd" $((oy+2)) 0                # head drooped forward + down, lamp dark
    [ $F -eq 1 ] && sf $F set-pixel --x 10 --y $((31+oy)) --color "$DR_D"   # last dead wisp
  done
  finalize
}

# ============================== PRODUCE EVERYTHING ============================
echo "producing the animated miner (facing +x, ~44x44) under assets/miner/ ..."
state_idle
state_walk
state_drill_down
state_drill_side
state_jetpack
state_fall
state_hurt
state_fuel_out
echo "done."
