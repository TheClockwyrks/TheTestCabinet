#!/usr/bin/env bash
# Locomotivation — produce the TRAIN sprites (the CO-STAR) with the on-PATH `draw`
# tool (specs/assets.md §2, specs/trains.md, ASSET-MANIFEST.md §2). The trains are
# chunky ¾ bodies — a side FLANK (long) for the horizontal (`-h`) orientation and a
# FRONT/BACK view for the vertical (`-v`) orientation — NOT flat bars. Each has a top
# face + a side face + underframe + wheels so it reads with real height in the ¾ view.
#
# Three kinds (specs/trains.md):
#   • Freight  — chunky, heavy, LETHAL engine + sealed BOXCAR, plus two RIDEABLE
#     FLAT-TOP cars (regular + half-length): open flat deck, unmistakably distinct
#     from the sealed lethal cars because a player bets their life on the read.
#   • Commuter — sleek, medium; lead car + coach with a continuous window band.
#   • Bullet   — needle-nosed, low, fast; nose car + body with a bold accent stripe.
# Plus a shared warm HEADLIGHT glow cast ahead of a train.
#
# Colours match specs/overview.md. A long train tiles these car sprites behind its
# engine; car bodies fill their sprite width (a thin coupler gap at each end) so
# adjacent cars butt together. All sprites are anchored at their BASE (bottom).
#
# The build is SELF-CONTAINED: it loads these committed PNGs and never runs this tool.
set -euo pipefail

# ── locate the tool ───────────────────────────────────────────────────────────
REL="/cargo-target/the-test-cabinet/release"
if ! command -v draw >/dev/null 2>&1; then export PATH="$REL:$PATH"; fi
command -v draw >/dev/null 2>&1 || { echo "draw not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FR="$ROOT/assets/train/freight"
CO="$ROOT/assets/train/commuter"
BU="$ROOT/assets/train/bullet"
mkdir -p "$FR" "$CO" "$BU"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsprite <w> <h> <out.png>: fresh transparent canvas rendering straight to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# ── palette (specs/overview.md) ────────────────────────────────────────────────
# Freight (#6b7280) shades
FR_TOP='#818997'; FR_TOPHI='#949cab'; FR_SIDE='#6b7280'; FR_SIDESH='#565c68'; FR_LOW='#454a54'
# Commuter (#c9d0d8)
CO_TOP='#dbe1e8'; CO_TOPHI='#eef2f6'; CO_SIDE='#c9d0d8'; CO_SIDESH='#a9b2bd'; CO_LOW='#8b95a1'
# Bullet (#eef2f7)
BU_TOP='#ffffff'; BU_SIDE='#eef2f7'; BU_SIDESH='#cfd7e0'; BU_LOW='#aeb8c4'
# Common
FRAME='#34383f'; WHEEL='#23262b'; WHEELHUB='#3a3f47'; COUPLER='#2a2d33'
GLASS='#2b3a4a'; GLASSHI='#4a6076'
DECK='#8a8f98'; DECK_HI='#a2a7b0'; DECK_SH='#6f747d'; PLANK='#565c68'; POST='#3c2f26'; POST_HI='#54402f'
LAMP='#fff2c4'; LAMPRIM='#c9a94e'
RED='#e2503b'; BLUE='#3f8ae0'; AMBER='#f2b03d'

# wheelrow <y> <x0> <x1> <step> <color>: evenly spaced wheels along the underframe.
wheelrow() {
  local y=$1 x0=$2 x1=$3 step=$4 col=$5 x
  for (( x=x0; x<=x1; x+=step )); do
    d fill-circle --cx "$x" --cy "$y" --r 5 --color "$col"
    d fill-circle --cx "$x" --cy "$y" --r 2 --color "$WHEELHUB"
  done
}

# ================================================================================
# HORIZONTAL (-h) — the long FLANK. Facing RIGHT (lead/cab on the right); the renderer
# flips for left-running trains. Base at the bottom row.
# ================================================================================

# ── FREIGHT ENGINE -h (104x64) — chunky, heavy, LETHAL ─────────────────────────
freight_engine_h() {
  local W=104 H=64 out="$FR/engine-h.png"
  newsprite "$W" "$H" "$out"
  # underframe + wheels
  d fill-rect --x 4 --y $((H-14)) --width $((W-8)) --height 8 --color "$FRAME"
  wheelrow $((H-5)) 16 $((W-16)) 20 "$WHEEL"
  # long hood (left ~2/3): side face
  d fill-rect --x 4  --y 22 --width 62 --height $((H-22-6)) --color "$FR_SIDE"
  d fill-rect --x 4  --y $((H-14)) --width 62 --height 4 --color "$FR_LOW"      # lower shadow band
  d fill-rect --x 4  --y 22 --width 62 --height 3 --color "$FR_TOPHI"           # top edge highlight
  # hood top face (¾), inset
  d fill-rect --x 8  --y 14 --width 56 --height 9 --color "$FR_TOP"
  d fill-rect --x 8  --y 14 --width 56 --height 2 --color "$FR_TOPHI"
  d line --x0 8 --y0 23 --x1 64 --y1 23 --color "$FR_SIDESH"
  # tall CAB (right ~1/3): sealed, with roof
  d fill-rect --x 66 --y 12 --width 34 --height $((H-12-6)) --color "$FR_SIDE"
  d fill-rect --x 66 --y $((H-14)) --width 34 --height 4 --color "$FR_LOW"
  d fill-rect --x 68 --y 6  --width 30 --height 8 --color "$FR_TOP"             # cab roof top face
  d fill-rect --x 68 --y 6  --width 30 --height 2 --color "$FR_TOPHI"
  # cab window (glass)
  d fill-rect --x 72 --y 18 --width 24 --height 14 --color "$GLASS"
  d fill-rect --x 72 --y 18 --width 24 --height 3 --color "$GLASSHI"
  d line --x0 84 --y0 18 --x1 84 --y1 32 --color "$FR_LOW"                      # window mullion
  # smokestack near hood/cab join
  d fill-rect --x 56 --y 8 --width 8 --height 8 --color "$FRAME"
  d fill-rect --x 55 --y 6 --width 10 --height 3 --color "$FR_LOW"
  # front lamp housing + warm lamp at the lead (right)
  d fill-rect --x 98 --y 28 --width 6 --height 12 --color "$LAMPRIM"
  d fill-circle --cx 101 --cy 34 --r 3 --color "$LAMP"
  # paneling seams + rivets on the hood side
  d line --x0 24 --y0 25 --x1 24 --y1 $((H-11)) --color "$FR_SIDESH"
  d line --x0 44 --y0 25 --x1 44 --y1 $((H-11)) --color "$FR_SIDESH"
  local rx
  for rx in 10 20 30 40 50 60; do d set-pixel --x "$rx" --y 27 --color "$FR_TOPHI"; d set-pixel --x "$rx" --y $((H-12)) --color "$FR_LOW"; done
  # coupler nubs
  d fill-rect --x 0 --y 40 --width 4 --height 8 --color "$COUPLER"
}

# ── FREIGHT BOXCAR -h (88x64) — tall SEALED, LETHAL ────────────────────────────
freight_boxcar_h() {
  local W=88 H=64 out="$FR/boxcar-h.png"
  newsprite "$W" "$H" "$out"
  d fill-rect --x 3 --y $((H-14)) --width $((W-6)) --height 8 --color "$FRAME"
  wheelrow $((H-5)) 16 $((W-16)) 18 "$WHEEL"
  # tall sealed body: side face
  d fill-rect --x 3 --y 14 --width $((W-6)) --height $((H-14-6)) --color "$FR_SIDE"
  d fill-rect --x 3 --y $((H-14)) --width $((W-6)) --height 4 --color "$FR_LOW"
  d fill-rect --x 3 --y 14 --width $((W-6)) --height 3 --color "$FR_TOPHI"
  # roof top face (¾) — SOLID (sealed, not open)
  d fill-rect --x 6 --y 6 --width $((W-12)) --height 9 --color "$FR_TOP"
  d fill-rect --x 6 --y 6 --width $((W-12)) --height 2 --color "$FR_TOPHI"
  d line --x0 6 --y0 15 --x1 $((W-6)) --y1 15 --color "$FR_SIDESH"
  # centred sliding door panel (recessed, darker) with seams
  d fill-rect --x 32 --y 20 --width 24 --height $((H-20-11)) --color "$FR_SIDESH"
  d line --x0 44 --y0 20 --x1 44 --y1 $((H-11)) --color "$FR_LOW"
  d stroke-rect --x 32 --y 20 --width 24 --height $((H-20-11)) --color "$FR_LOW"
  d fill-rect --x 41 --y 34 --width 6 --height 4 --color "$FR_LOW"              # door handle
  # side panel seams flanking the door + rivets
  d line --x0 18 --y0 17 --x1 18 --y1 $((H-11)) --color "$FR_SIDESH"
  d line --x0 70 --y0 17 --x1 70 --y1 $((H-11)) --color "$FR_SIDESH"
  local rx
  for rx in 8 18 70 80; do d set-pixel --x "$rx" --y 18 --color "$FR_TOPHI"; d set-pixel --x "$rx" --y $((H-12)) --color "$FR_LOW"; done
  # end ladder (right end)
  d line --x0 82 --y0 16 --x1 82 --y1 $((H-11)) --color "$FRAME"
  for rx in 20 30 40 50; do d line --x0 84 --y0 "$rx" --x1 86 --y1 "$rx" --color "$FRAME"; done
  d fill-rect --x 0 --y 40 --width 3 --height 8 --color "$COUPLER"
  d fill-rect --x $((W-3)) --y 40 --width 3 --height 8 --color "$COUPLER"
}

# ── FREIGHT FLAT-TOP -h (88x44) — LOW OPEN DECK, RIDEABLE ──────────────────────
flat_top_h() { # <width> <out>
  local W=$1 out=$2 H=44
  newsprite "$W" "$H" "$out"
  d fill-rect --x 3 --y $((H-14)) --width $((W-6)) --height 8 --color "$FRAME"
  wheelrow $((H-5)) 14 $((W-14)) 18 "$WHEEL"
  # thin SIDE skirt only (the deck edge) — the body is LOW so the open top dominates
  d fill-rect --x 3 --y $((H-22)) --width $((W-6)) --height 8 --color "$FR_SIDESH"
  d fill-rect --x 3 --y $((H-22)) --width $((W-6)) --height 2 --color "$FR_SIDE"
  # big OPEN flat DECK top face (¾) — light timber/steel planks you can stand on
  d fill-rect --x 4 --y $((H-30)) --width $((W-8)) --height 9 --color "$DECK"
  d fill-rect --x 4 --y $((H-30)) --width $((W-8)) --height 2 --color "$DECK_HI"
  d fill-rect --x 4 --y $((H-22)) --width $((W-8)) --height 1 --color "$DECK_SH"  # deck front lip
  # plank seams across the deck (reads as an open boardable surface)
  local px
  for (( px=10; px<W-6; px+=8 )); do d line --x0 "$px" --y0 $((H-29)) --x1 "$px" --y1 $((H-23)) --color "$PLANK"; done
  # short corner STAKE posts (open sides — not a wall) — telegraphs "rideable"
  d fill-rect --x 3  --y $((H-34)) --width 4 --height 12 --color "$POST"
  d fill-rect --x 3  --y $((H-34)) --width 4 --height 3  --color "$POST_HI"
  d fill-rect --x $((W-7)) --y $((H-34)) --width 4 --height 12 --color "$POST"
  d fill-rect --x $((W-7)) --y $((H-34)) --width 4 --height 3  --color "$POST_HI"
  d fill-rect --x 0 --y $((H-14)) --width 3 --height 8 --color "$COUPLER"
  d fill-rect --x $((W-3)) --y $((H-14)) --width 3 --height 8 --color "$COUPLER"
}

# ── COMMUTER lead/coach -h — sleek medium ──────────────────────────────────────
commuter_car_h() { # <width> <out> <is_lead 0|1>
  local W=$1 out=$2 lead=$3 H=56
  newsprite "$W" "$H" "$out"
  d fill-rect --x 3 --y $((H-13)) --width $((W-6)) --height 7 --color "$FRAME"
  wheelrow $((H-4)) 16 $((W-16)) 20 "$WHEEL"
  # smooth side face, rounded ends
  d fill-rect --x 4 --y 16 --width $((W-8)) --height $((H-16-6)) --color "$CO_SIDE"
  d fill-rect --x 4 --y $((H-13)) --width $((W-8)) --height 4 --color "$CO_LOW"
  d fill-rect --x 4 --y 16 --width $((W-8)) --height 3 --color "$CO_TOPHI"
  # bevel hint at the top corners
  d set-pixel --x 5 --y 16 --color "$CO_SIDESH"
  d set-pixel --x $((W-6)) --y 16 --color "$CO_SIDESH"
  # roof top face (¾)
  d fill-rect --x 8 --y 9 --width $((W-16)) --height 8 --color "$CO_TOP"
  d fill-rect --x 8 --y 9 --width $((W-16)) --height 2 --color "$CO_TOPHI"
  d line --x0 8 --y0 17 --x1 $((W-8)) --y1 17 --color "$CO_SIDESH"
  # continuous window band (dark glass) along the upper flank
  d fill-rect --x 10 --y 22 --width $((W-20)) --height 12 --color "$GLASS"
  d fill-rect --x 10 --y 22 --width $((W-20)) --height 3 --color "$GLASSHI"
  local wx
  for (( wx=20; wx<W-12; wx+=14 )); do d line --x0 "$wx" --y0 22 --x1 "$wx" --y1 33 --color "$CO_SIDESH"; done
  # bold accent stripe (blue) below the windows
  d fill-rect --x 5 --y 38 --width $((W-10)) --height 4 --color "$BLUE"
  if [ "$lead" = "1" ]; then
    # slanted front + cab window + lamp at the lead (right)
    d fill-rect --x $((W-16)) --y 20 --width 12 --height 20 --color "$CO_SIDESH"
    d fill-rect --x $((W-14)) --y 22 --width 9 --height 10 --color "$GLASS"
    d fill-rect --x $((W-14)) --y 22 --width 9 --height 2 --color "$GLASSHI"
    d fill-rect --x $((W-5)) --y 30 --width 4 --height 8 --color "$LAMPRIM"
    d fill-circle --cx $((W-3)) --cy 34 --r 2 --color "$LAMP"
  fi
  d fill-rect --x 0 --y 34 --width 3 --height 7 --color "$COUPLER"
  d fill-rect --x $((W-3)) --y 34 --width 3 --height 7 --color "$COUPLER"
}

# ── BULLET nose/body -h — needle-nosed, low, fast ──────────────────────────────
bullet_nose_h() {
  local W=76 H=48 out="$BU/nose-h.png"
  newsprite "$W" "$H" "$out"
  d fill-rect --x 3 --y $((H-11)) --width $((W-6)) --height 6 --color "$FRAME"
  wheelrow $((H-3)) 18 $((W-24)) 22 "$WHEEL"
  # low smooth body, blunt at coupler (left), tapering to a NOSE at the right
  d fill-rect --x 2 --y 18 --width $((W-24)) --height $((H-18-5)) --color "$BU_SIDE"
  d fill-rect --x 2 --y $((H-11)) --width $((W-24)) --height 4 --color "$BU_LOW"
  d fill-rect --x 2 --y 18 --width $((W-24)) --height 3 --color "$BU_TOP"
  # roof top face
  d fill-rect --x 6 --y 12 --width $((W-32)) --height 7 --color "$BU_TOP"
  # needle nose: descending steps from body to a point (¾ tapered front)
  d fill-rect --x $((W-24)) --y 20 --width 6 --height 16 --color "$BU_SIDE"
  d fill-rect --x $((W-18)) --y 23 --width 6 --height 12 --color "$BU_SIDE"
  d fill-rect --x $((W-12)) --y 26 --width 6 --height 8  --color "$BU_SIDESH"
  d fill-rect --x $((W-6))  --y 29 --width 5 --height 4  --color "$BU_SIDESH"
  d line --x0 $((W-24)) --y0 20 --x1 $((W-1)) --y1 30 --color "$BU_TOP"          # top nose highlight
  # bold accent stripe (red) running to the tip
  d fill-rect --x 2 --y 32 --width $((W-26)) --height 4 --color "$RED"
  d fill-rect --x $((W-24)) --y 32 --width 12 --height 3 --color "$RED"
  # cockpit window near the nose
  d fill-rect --x $((W-34)) --y 20 --width 12 --height 8 --color "$GLASS"
  d fill-rect --x $((W-34)) --y 20 --width 12 --height 2 --color "$GLASSHI"
  # lamp at the tip
  d fill-circle --cx $((W-2)) --cy 31 --r 2 --color "$LAMP"
  d fill-rect --x 0 --y 28 --width 3 --height 7 --color "$COUPLER"
}
bullet_body_h() {
  local W=72 H=48 out="$BU/body-h.png"
  newsprite "$W" "$H" "$out"
  d fill-rect --x 3 --y $((H-11)) --width $((W-6)) --height 6 --color "$FRAME"
  wheelrow $((H-3)) 16 $((W-16)) 20 "$WHEEL"
  d fill-rect --x 2 --y 18 --width $((W-4)) --height $((H-18-5)) --color "$BU_SIDE"
  d fill-rect --x 2 --y $((H-11)) --width $((W-4)) --height 4 --color "$BU_LOW"
  d fill-rect --x 2 --y 18 --width $((W-4)) --height 3 --color "$BU_TOP"
  d fill-rect --x 6 --y 12 --width $((W-12)) --height 7 --color "$BU_TOP"
  d line --x0 6 --y0 19 --x1 $((W-6)) --y1 19 --color "$BU_SIDESH"
  # window ports
  local wx
  for (( wx=12; wx<W-10; wx+=16 )); do
    d fill-rect --x "$wx" --y 22 --width 10 --height 7 --color "$GLASS"
    d fill-rect --x "$wx" --y 22 --width 10 --height 2 --color "$GLASSHI"
  done
  # accent stripe (red)
  d fill-rect --x 2 --y 32 --width $((W-4)) --height 4 --color "$RED"
  d fill-rect --x 0 --y 28 --width 3 --height 7 --color "$COUPLER"
  d fill-rect --x $((W-3)) --y 28 --width 3 --height 7 --color "$COUPLER"
}

# ================================================================================
# VERTICAL (-v) — the FRONT/BACK view (train travelling along a column). The car
# LENGTH runs vertically; you see the near END FACE (bottom) + the ROOF receding up.
# Not campaign-loaded today (all tracks are horizontal) but produced for completeness
# and any future vertical (`!`) lane (ASSET-MANIFEST.md §2).
# ================================================================================

# vbody <W> <H> <out> <side> <sidesh> <low> <top> <tophi>: roof-dominant vertical car,
# end face at the bottom, thin side reveals at left/right.
vbody() {
  local W=$1 H=$2 out=$3 side=$4 sidesh=$5 low=$6 top=$7 tophi=$8
  newsprite "$W" "$H" "$out"
  # roof (top face) fills most of the length, inset from the side reveals
  d fill-rect --x 6 --y 4 --width $((W-12)) --height $((H-14)) --color "$top"
  d fill-rect --x 6 --y 4 --width 3 --height $((H-14)) --color "$tophi"          # left roof highlight
  d fill-rect --x $((W-9)) --y 4 --width 3 --height $((H-14)) --color "$sidesh"  # right roof shade
  # side reveals (the flanks seen thinly at the ¾ angle)
  d fill-rect --x 2 --y 6 --width 4 --height $((H-16)) --color "$sidesh"
  d fill-rect --x $((W-6)) --y 6 --width 4 --height $((H-16)) --color "$low"
  # near END face (bottom) — a short vertical face + underframe/wheels peeking
  d fill-rect --x 4 --y $((H-14)) --width $((W-8)) --height 8 --color "$side"
  d fill-rect --x 4 --y $((H-14)) --width $((W-8)) --height 2 --color "$tophi"
  d fill-rect --x 4 --y $((H-8)) --width $((W-8)) --height 3 --color "$FRAME"
  d fill-circle --cx 10 --cy $((H-4)) --r 3 --color "$WHEEL"
  d fill-circle --cx $((W-10)) --cy $((H-4)) --r 3 --color "$WHEEL"
}

echo "→ horizontal flanks…"
freight_engine_h
freight_boxcar_h
flat_top_h 88 "$FR/flat-top-h.png"
flat_top_h 44 "$FR/flat-top-half-h.png"
commuter_car_h 96 "$CO/engine-h.png" 1
commuter_car_h 88 "$CO/coach-h.png"  0
bullet_nose_h
bullet_body_h

echo "→ headlight glow…"
# ── HEADLIGHT glow (72x56) — warm cone cast ahead of a train (specs/trains.md) ──
newsprite 72 56 "$ROOT/assets/train/headlight.png"
d fill-circle --cx 24 --cy 28 --r 24 --color '#fff2c422'
d fill-circle --cx 26 --cy 28 --r 18 --color '#fff2c440'
d fill-circle --cx 26 --cy 28 --r 12 --color '#fff2c47a'
d fill-circle --cx 26 --cy 28 --r 7  --color '#fff6d6c8'
d fill-circle --cx 26 --cy 28 --r 4  --color '#fffbeaf2'
# forward-cast cone (to the right — the way the train faces)
d fill-circle --cx 42 --cy 28 --r 12 --color '#fff2c42a'
d fill-circle --cx 54 --cy 28 --r 9  --color '#fff2c41e'
d fill-circle --cx 64 --cy 28 --r 6  --color '#fff2c414'

echo "→ vertical front/back views…"
vbody 56 104 "$FR/engine-v.png"         "$FR_SIDE" "$FR_SIDESH" "$FR_LOW" "$FR_TOP" "$FR_TOPHI"
vbody 56 88  "$FR/boxcar-v.png"         "$FR_SIDE" "$FR_SIDESH" "$FR_LOW" "$FR_TOP" "$FR_TOPHI"
# flat-top -v: open deck (light) instead of a sealed roof
vbody 56 88  "$FR/flat-top-v.png"       "$FR_SIDESH" "$DECK_SH" "$FR_LOW" "$DECK" "$DECK_HI"
vbody 56 44  "$FR/flat-top-half-v.png"  "$FR_SIDESH" "$DECK_SH" "$FR_LOW" "$DECK" "$DECK_HI"
vbody 56 96  "$CO/engine-v.png"         "$CO_SIDE" "$CO_SIDESH" "$CO_LOW" "$CO_TOP" "$CO_TOPHI"
vbody 56 88  "$CO/coach-v.png"          "$CO_SIDE" "$CO_SIDESH" "$CO_LOW" "$CO_TOP" "$CO_TOPHI"
vbody 48 76  "$BU/nose-v.png"           "$BU_SIDE" "$BU_SIDESH" "$BU_LOW" "$BU_TOP" "$BU_TOP"
vbody 48 72  "$BU/body-v.png"           "$BU_SIDE" "$BU_SIDESH" "$BU_LOW" "$BU_TOP" "$BU_TOP"

echo "train sprites written under $ROOT/assets/train/"
