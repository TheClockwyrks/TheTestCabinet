#!/usr/bin/env bash
# Facet — produce the static SPRITES with the on-PATH `draw` tool
# (specs/assets.md → "Sprites").
#
# Facet ships with no pre-made art: every stone on the board is a file produced
# here. Each is a 64x64 straight-alpha canvas built from drawing primitives, its
# form fitting inside GEM_R (30) of a cell center (specs/board.md), and drawn at
# native size so the game can sample it nearest-neighbor and keep it crisp.
#
# Produces, under assets/gems/ (35 PNGs):
#   <kind>-<strain>.png   the seven kinds at strain 0..3            (28)
#   prism-<strain>.png    the prism at strain 0..3                   (4)
#   cut-brilliant.png     the brilliant overlay                      (1)
#   cut-star.png          the star overlay                           (1)
#   frame.png             the bench surround the 8x8 field sits on   (1)
#
# The break sheets and the prism's idle turn are produced by gen-sheets.sh, the
# particle systems by gen-particles.sh, and the audio by gen-audio.sh.
#
# Usage:  bash scripts/gen-sprites.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/{debug,release} — the devcontainer's cargo volume).
set -euo pipefail

# Resolve the tool: prefer PATH, else the devcontainer's cargo target volume.
if ! command -v draw >/dev/null 2>&1; then
  for d in "${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"/{release,debug}; do
    [ -x "$d/draw" ] && export PATH="$d:$PATH" && break
  done
  command -v draw >/dev/null 2>&1 || { echo "draw not found on PATH" >&2; exit 1; }
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=gem-lib.sh
. "$HERE/gem-lib.sh"

OUT="${1:-$HERE/../assets}/gems"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

GEM_TOOL=draw
GEM_EXTRA=()

# newsprite <w> <h> <out.png> — start a fresh transparent canvas. `draw` writes
# its preview straight to the finished path, so the preview *is* the asset.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s", "layers": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" "$TMP/layers.json" > "$CFG"
  draw init --config "$CFG" >/dev/null
}

# ==============================================================================
# The stones — 28 kind sprites and 4 prism sprites, built by gem-lib.sh
# ==============================================================================
for kind in "${KINDS[@]}" prism; do
  for strain in 0 1 2 3; do
    newsprite "$CANVAS" "$CANVAS" "$OUT/$kind-$strain.png"
    draw_gem "$kind" "$strain"
    echo "  gems/$kind-$strain.png"
  done
done

# ==============================================================================
# The cut overlays
# ==============================================================================
# Both are composited over a kind's sprite, so they sit clear of the table where
# the kind's own facets are read, and they are shaped so the two never blur into
# one another: the brilliant scatters fire around the girdle, the star throws one
# asterism straight through the stone.

# --- brilliant: a ring of small glints scattered over the crown ---------------
# Six four-armed sparks on a ring tight enough to land inside even the narrowest
# silhouette (the marquise), each laid over a dark backing so it reads on a
# citrine as clearly as on a sapphire.
newsprite "$CANVAS" "$CANVAS" "$OUT/cut-brilliant.png"
GOLD='#ffcf55'; GOLD_HI='#fffbe6'; GOLD_SH='#171021'
for a in 20 80 140 200 260 320; do
  read -r gx gy < <(awk -v a="$a" 'BEGIN { t = a * 3.14159265 / 180; printf "%d %d\n", 31.5 + 13.5 * cos(t) + 0.5, 31.5 + 13.5 * sin(t) + 0.5 }')
  gdraw line --x0 $((gx - 5)) --y0 $((gy + 1)) --x1 $((gx + 5)) --y1 $((gy + 1)) --color "$GOLD_SH"
  gdraw line --x0 $((gx + 1)) --y0 $((gy - 5)) --x1 $((gx + 1)) --y1 $((gy + 5)) --color "$GOLD_SH"
  gdraw line --x0 $((gx - 5)) --y0 "$gy" --x1 $((gx + 5)) --y1 "$gy" --color "$GOLD"
  gdraw line --x0 "$gx" --y0 $((gy - 5)) --x1 "$gx" --y1 $((gy + 5)) --color "$GOLD"
  gdraw fill-circle --cx "$gx" --cy "$gy" --r 1 --color "$GOLD_HI"
  gdraw set-pixel --x $((gx - 2)) --y "$gy" --color "$GOLD_HI"
  gdraw set-pixel --x $((gx + 2)) --y "$gy" --color "$GOLD_HI"
done
echo "  gems/cut-brilliant.png"

# --- star: one six-rayed asterism, edge to edge ------------------------------
newsprite "$CANVAS" "$CANVAS" "$OUT/cut-star.png"
STAR='#eaf1ff'; STAR_C='#ffffff'; STAR_S='#9fb8e8'
for a in 90 30 150; do
  read -r dx dy < <(awk -v a="$a" 'BEGIN { t = a * 3.14159265 / 180; printf "%d %d\n", 26 * cos(t) + 0.5, 26 * sin(t) + 0.5 }')
  # each ray is laid down three times — a shadow, then two adjacent passes — so a
  # shallow diagonal comes out as a solid 2px ray rather than a dashed one
  gdraw line --x0 $((33 - dx)) --y0 $((33 - dy)) --x1 $((33 + dx)) --y1 $((33 + dy)) --color "$STAR_S"
  gdraw line --x0 $((31 - dx)) --y0 $((31 - dy)) --x1 $((31 + dx)) --y1 $((31 + dy)) --color "$STAR"
  gdraw line --x0 $((31 - dx)) --y0 $((32 - dy)) --x1 $((31 + dx)) --y1 $((32 + dy)) --color "$STAR"
done
gdraw fill-circle --cx 31 --cy 31 --r 3 --color "$STAR"
gdraw fill-circle --cx 31 --cy 31 --r 2 --color "$STAR_C"
echo "  gems/cut-star.png"

# ==============================================================================
# The board frame
# ==============================================================================
# The bench the field sits on. specs/board.md puts the 8x8 field's cell centers
# at x 388..892 and y 144..648 on a CELL_PITCH of 72, so the field spans 576x576
# from (352, 108). This sprite is that field plus a 36px bench surround, so it is
# 648x648 and is drawn BEHIND the gems at (316, 72). It carries the cell grooves,
# so the field's extent and its eight-by-eight division read without a code-drawn
# outline.
FIELD=576; BORDER=36; FRAME=$((FIELD + BORDER * 2))
newsprite "$FRAME" "$FRAME" "$OUT/frame.png"
WOOD='#3a2a20'; WOOD_HI='#57402f'; WOOD_LO='#20170f'; GRAIN='#463323'
BRASS='#c8a24e'; BRASS_HI='#eecd8a'; BRASS_LO='#6f5622'
FELT='#141a26'; FELT_LIT='#212d42'; GROOVE='#0b0f18'; GROOVE_HI='#222c40'

# the bench: a dark wood surround, lit from the top left, with a little grain
gdraw fill-rect --x 0 --y 0 --width "$FRAME" --height "$FRAME" --color "$WOOD"
for gy in $(seq 7 13 $((FRAME - 1))); do
  gdraw fill-rect --x 0 --y "$gy" --width "$FRAME" --height 1 --color "$GRAIN"
done
gdraw fill-rect --x 0 --y 0 --width "$FRAME" --height 4 --color "$WOOD_HI"
gdraw fill-rect --x 0 --y 0 --width 4 --height "$FRAME" --color "$WOOD_HI"
gdraw fill-rect --x 0 --y $((FRAME - 4)) --width "$FRAME" --height 4 --color "$WOOD_LO"
gdraw fill-rect --x $((FRAME - 4)) --y 0 --width 4 --height "$FRAME" --color "$WOOD_LO"

# the brass bezel that holds the field
gdraw fill-rect --x $((BORDER - 8)) --y $((BORDER - 8)) --width $((FIELD + 16)) --height $((FIELD + 16)) --color "$BRASS_LO"
gdraw fill-rect --x $((BORDER - 7)) --y $((BORDER - 7)) --width $((FIELD + 14)) --height $((FIELD + 14)) --color "$BRASS"
gdraw fill-rect --x $((BORDER - 7)) --y $((BORDER - 7)) --width $((FIELD + 14)) --height 1 --color "$BRASS_HI"
gdraw fill-rect --x $((BORDER - 7)) --y $((BORDER - 7)) --width 1 --height $((FIELD + 14)) --color "$BRASS_HI"
gdraw fill-rect --x $((BORDER - 3)) --y $((BORDER - 3)) --width $((FIELD + 6)) --height $((FIELD + 6)) --color "$BRASS_LO"

# the felt the stones rest on, with a pool of bench light over its middle
gdraw fill-rect --x "$BORDER" --y "$BORDER" --width "$FIELD" --height "$FIELD" --color "$FELT"
FC=$((BORDER + FIELD / 2))
for i in $(seq 0 30); do
  r=$(( FIELD / 2 - i * (FIELD / 2 - 26) / 30 ))
  gdraw fill-circle --cx "$FC" --cy "$FC" --r "$r" --color "$(mix "$FELT" "$FELT_LIT" $((i * 100 / 30)))"
done

# the cell grooves: the field's eight columns and eight rows of CELL_PITCH (72)
for i in 1 2 3 4 5 6 7; do
  g=$((BORDER + i * 72))
  gdraw fill-rect --x $((g - 1)) --y "$BORDER" --width 2 --height "$FIELD" --color "$GROOVE"
  gdraw fill-rect --x $((g + 1)) --y "$BORDER" --width 1 --height "$FIELD" --color "$GROOVE_HI"
  gdraw fill-rect --x "$BORDER" --y $((g - 1)) --width "$FIELD" --height 2 --color "$GROOVE"
  gdraw fill-rect --x "$BORDER" --y $((g + 1)) --width "$FIELD" --height 1 --color "$GROOVE_HI"
done

# brass corner brackets, and a rivet in each, on the bench itself
for cxy in "0 0" "1 0" "0 1" "1 1"; do
  read -r sx sy <<<"$cxy"
  x=$((sx * (FRAME - 52))); y=$((sy * (FRAME - 52)))
  gdraw fill-rect --x "$x" --y "$y" --width 52 --height 7 --color "$BRASS"
  gdraw fill-rect --x "$x" --y "$y" --width 7 --height 52 --color "$BRASS"
  gdraw fill-rect --x "$x" --y $((y + 7)) --width 52 --height 1 --color "$BRASS_LO"
  gdraw fill-rect --x $((x + 7)) --y "$y" --width 1 --height 52 --color "$BRASS_LO"
  gdraw fill-circle --cx $((sx * (FRAME - 35) + 17)) --cy $((sy * (FRAME - 35) + 17)) --r 4 --color "$BRASS_LO"
  gdraw fill-circle --cx $((sx * (FRAME - 35) + 17)) --cy $((sy * (FRAME - 35) + 17)) --r 3 --color "$BRASS_HI"
done
echo "  gems/frame.png"

echo "gen-sprites.sh: done -> $OUT"
