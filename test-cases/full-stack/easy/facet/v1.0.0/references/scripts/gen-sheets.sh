#!/usr/bin/env bash
# Facet — produce the ANIMATION SHEETS with the on-PATH `draw-sheet` tool
# (specs/assets.md → "Animations"). `draw-sheet` emits ONE PNG per frame, so a
# sequence is a directory of numbered frames, never a strip inside one image.
#
# Produces, under assets/gems/ (50 PNGs):
#   break/<kind>/{0..5}.png   a break animation per kind, 7 x 6 frames    (42)
#   prism-turn/{0..7}.png     the prism's looping idle turn, 8 frames      (8)
#
# The break sheets are played at a cell when a chain step removes the gem there,
# advancing on a timer; the cell is empty once the sheet has run. The prism turn
# loops under every prism standing on the board, so a prism is picked out by its
# motion as well as its art.
#
# Both lean on the tool's LAYERS: a layer is drawn once and appears in every
# frame at whatever its keyframes resolve to there, which is how the shards get
# real motion, spin, and shrink out of six drawings rather than thirty-six.
#
# Usage:  bash scripts/gen-sheets.sh   (draw-sheet must be on PATH, or built
#         under $CARGO_TARGET_DIR/{debug,release}).
set -euo pipefail

# Resolve the tool: prefer PATH, else the devcontainer's cargo target volume.
if ! command -v draw-sheet >/dev/null 2>&1; then
  for d in "${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}"/{release,debug}; do
    [ -x "$d/draw-sheet" ] && export PATH="$d:$PATH" && break
  done
  command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH" >&2; exit 1; }
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=gem-lib.sh
. "$HERE/gem-lib.sh"

OUT="${1:-$HERE/../assets}/gems"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

GEM_TOOL=draw-sheet

# newsheet <dir> <frames-json> — start a fresh sheet writing straight to its
# finished frame paths. `draw-sheet` wants the frame list, not a count.
newsheet() {
  mkdir -p "$1"
  rm -f "$1"/*.png
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": %s, "actions": "%s", "preview": "%s", "layers": "%s" }\n' \
    "$CANVAS" "$CANVAS" "$2" "$TMP/f_{frame}.json" "$1/{frame}.png" "$TMP/layers.json" > "$CFG"
  rm -f "$TMP/layers.json"
  draw-sheet init --config "$CFG" >/dev/null
}

# key <layer> <property> <frame> <value> [interp] — one keyframe.
key() {
  draw-sheet animate-layer --config "$CFG" \
    --layer "$1" --property "$2" --frame "$3" --value="$4" --interp "${5:-linear}" >/dev/null
}

# ==============================================================================
# The break animations
# ==============================================================================
# BREAK_FRAMES (6) frames per kind:
#   0  the stone, already carrying a strain-2 fracture network, still whole
#   1  it goes: a white flash at the break, and six shards at full size
#   2  the flash collapses to a ring; the shards are clear of the cell center
#   3  the shards are tumbling and shrinking, throwing dust
#   4  they are most of the way out and fading
#   5  a few last specks
BREAK_FRAMES=6
SHARD_COUNT=6

# chip <layer> <form> <base> <light> <dark> — one 20x20 shard of a broken stone.
# Three forms so the six pieces of a stone are not six copies of one shape.
chip() {
  local layer="$1" form="$2" base="$3" light="$4" dark="$5" y half left w
  draw-sheet register-layer --config "$CFG" \
    --name "$layer" --x 22 --y 22 --width 20 --height 20 --opacity 0 >/dev/null
  GEM_EXTRA=(--layer "$layer")
  for y in $(seq 3 16); do
    case "$form" in
      wedge) half=$(( (y - 2) * 7 / 14 + 1 ));;
      rhomb) half=$(( 7 - (y > 10 ? y - 10 : 10 - y) ));;
      *)     half=$(( y < 5 || y > 14 ? 1 : 3 ));;
    esac
    [ "$half" -ge 1 ] || continue
    if [ "$form" = sliver ]; then left=$(( 4 + (y - 3) * 8 / 14 )); else left=$((10 - half)); fi
    w=$((half * 2))
    gdraw fill-rect --x "$left" --y "$y" --width "$w" --height 1 --color "$base"
    gdraw set-pixel --x "$left" --y "$y" --color "$light"
    gdraw set-pixel --x $((left + w - 1)) --y "$y" --color "$dark"
  done
  gdraw fill-rect --x 8 --y 6 --width 3 --height 2 --color "$light"
}

break_sheet() {
  local kind="$1" i form ang ax ay spin
  local dir="$OUT/break/$kind"
  local base light dark hot
  base=$(kind_base "$kind"); light=$(kind_light "$kind"); dark=$(kind_dark "$kind")
  hot=$(mix "$(kind_hi "$kind")" '#ffffff' 55)

  newsheet "$dir" "[0,1,2,3,4,5]"

  # frame 0 — the whole stone, at the strain it breaks from
  GEM_EXTRA=(--frame 0)
  draw_gem "$kind" 2

  # frame 1 — the flash the break throws: a hot core with spikes of the kind's
  # own light thrown off it. Frame 2 is what is left of it, one thin shock ring.
  GEM_EXTRA=(--frame 1)
  gdraw fill-circle --cx 31 --cy 31 --r 17 --color "${light}55"
  gdraw fill-circle --cx 31 --cy 31 --r 12 --color "${hot}bb"
  gdraw fill-circle --cx 31 --cy 31 --r 7 --color '#ffffff'
  local a rx0 ry0 rx1 ry1
  for a in 0 45 90 135 180 225 270 315; do
    read -r rx0 ry0 rx1 ry1 < <(awk -v a="$a" 'BEGIN {
      t = a * 3.14159265 / 180;
      printf "%d %d %d %d\n", 31 + 14 * cos(t), 31 + 14 * sin(t), 31 + 29 * cos(t), 31 + 29 * sin(t) }')
    gdraw line --x0 "$rx0" --y0 "$ry0" --x1 "$rx1" --y1 "$ry1" --color "${hot}cc"
  done
  GEM_EXTRA=(--frame 2)
  gdraw stroke-circle --cx 31 --cy 31 --r 28 --color "${light}77"
  for a in 22 112 202 292; do
    read -r rx0 ry0 rx1 ry1 < <(awk -v a="$a" 'BEGIN {
      t = a * 3.14159265 / 180;
      printf "%d %d %d %d\n", 31 + 22 * cos(t), 31 + 22 * sin(t), 31 + 30 * cos(t), 31 + 30 * sin(t) }')
    gdraw line --x0 "$rx0" --y0 "$ry0" --x1 "$rx1" --y1 "$ry1" --color "${hot}99"
  done

  # frames 2..5 — dust and last specks thrown clear of the shards
  local specks=("14 18" "48 20" "10 40" "52 44" "30 12" "34 52" "20 50" "44 12")
  for i in 2 3 4 5; do
    GEM_EXTRA=(--frame "$i")
    local n=0 sx sy
    for s in "${specks[@]}"; do
      read -r sx sy <<<"$s"
      n=$((n + 1))
      [ $(( (n + i) % 2 )) -eq 0 ] || continue
      sx=$((sx + (i - 2) * (sx > 31 ? 3 : -3)))
      sy=$((sy + (i - 2) * (sy > 31 ? 3 : -3) + i))
      gdraw set-pixel --x "$sx" --y "$sy" --color "$(mix "$light" '#ffffff' $((i * 12)))"
    done
  done

  # the shards themselves — one layer each, thrown out on its own heading
  for ((i = 0; i < SHARD_COUNT; i++)); do
    case $((i % 3)) in 0) form=wedge;; 1) form=rhomb;; *) form=sliver;; esac
    chip "shard$i" "$form" "$base" "$light" "$dark"

    ang=$(( 30 + i * 60 ))
    read -r ax ay < <(awk -v a="$ang" 'BEGIN { t = a * 3.14159265 / 180; printf "%.4f %.4f\n", cos(t), sin(t) }')
    spin=$(( (i % 2 == 0 ? 1 : -1) * (110 + i * 24) ))

    key "shard$i" opacity 0 0 constant
    key "shard$i" opacity 1 255
    key "shard$i" opacity 3 235
    key "shard$i" opacity $((BREAK_FRAMES - 1)) 0
    key "shard$i" x 1 "$(awk -v a="$ax" 'BEGIN { printf "%d\n", 22 + a * 7 }')" ease-out
    key "shard$i" x $((BREAK_FRAMES - 1)) "$(awk -v a="$ax" 'BEGIN { printf "%d\n", 22 + a * 34 }')"
    key "shard$i" y 1 "$(awk -v a="$ay" 'BEGIN { printf "%d\n", 22 + a * 7 }')" ease-out
    key "shard$i" y $((BREAK_FRAMES - 1)) "$(awk -v a="$ay" 'BEGIN { printf "%d\n", 22 + a * 34 + 11 }')"
    key "shard$i" rotation 1 0 ease-out
    key "shard$i" rotation $((BREAK_FRAMES - 1)) "$spin"
    key "shard$i" scale-x 1 100 ease-out
    key "shard$i" scale-x $((BREAK_FRAMES - 1)) 52
    key "shard$i" scale-y 1 100 ease-out
    key "shard$i" scale-y $((BREAK_FRAMES - 1)) 52
  done
  echo "  gems/break/$kind/{0..5}.png"
}

for kind in "${KINDS[@]}"; do break_sheet "$kind"; done

# ==============================================================================
# The prism's idle turn
# ==============================================================================
# TURN_FRAMES (8) frames of one full revolution, drawn rather than tweened: each
# frame narrows the kite by the cosine of its angle and rotates the fan of split
# colors by one band, so the cut reads as turning and catching the light rather
# than as a card flipping. The cycle closes on itself, so the sequence loops.
TURN_FRAMES=8
newsheet "$OUT/prism-turn" "[0,1,2,3,4,5,6,7]"
for ((f = 0; f < TURN_FRAMES; f++)); do
  GEM_EXTRA=(--frame "$f")
  SHAPE_SX=$(awk -v f="$f" -v n="$TURN_FRAMES" 'BEGIN {
    c = cos(2 * 3.14159265 * f / n); if (c < 0) c = -c;
    if (c < 0.28) c = 0.28; printf "%.4f\n", c }')
  PRISM_BAND_SHIFT=$((f % 6))
  draw_gem prism 0

  # the light the turning cut throws: a streak that runs across the face and
  # back over the cycle, clipped to the stone so it never leaves the silhouette
  read -r hx alpha < <(awk -v f="$f" -v n="$TURN_FRAMES" 'BEGIN {
    printf "%d %02x\n", 31.5 + 13 * sin(2 * 3.14159265 * f / n) + 0.5,
      int(90 + 90 * cos(2 * 3.14159265 * f / n) * cos(2 * 3.14159265 * f / n)) }')
  while read -r y left w; do
    [ "$hx" -ge "$left" ] && [ "$hx" -lt $((left + w - 1)) ] || continue
    gdraw fill-rect --x "$hx" --y "$y" --width 2 --height 1 --color "#ffffff$alpha"
  done < <(shape_rows prism 0.82 -1 -2)
  echo "  gems/prism-turn/$f.png"
done
SHAPE_SX=1
PRISM_BAND_SHIFT=0

echo "gen-sheets.sh: done -> $OUT"
