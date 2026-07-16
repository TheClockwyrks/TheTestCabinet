#!/usr/bin/env bash
# Deepcore — produce the WORLD sprites with the on-PATH `draw` (+ `draw-sheet` for the
# lava shimmer and the drill-damage crack progression) tools (specs/assets.md,
# "Environment sprites" / "Animations"; specs/world.md; specs/hazards.md). This script
# owns the environment the mine is built from — everything the vertical camera scrolls
# past as the miner digs down through the four depth bands (specs/world.md). Every sprite
# is authored at the tile's NATIVE display size (a tile is 80x80 — specs/world.md); we
# author AT that size and never upscale.
#
#   • the 80x80 band TILES the bands and their bounds are drawn from — THREE tileable
#     variants per band ("<band>-0/1/2.png") so a wall of the same band does NOT visibly
#     repeat one texture (topsoil earth, rockbed grey stone, deepstone near-black,
#     coreshell red-glowing). CRITICAL: the texture is a roughly UNIFORM, fine, even grain
#     — many small, evenly-distributed specks/flecks/short cracks of slightly darker and
#     slightly lighter shades of the band fill, covering the whole tile with NO big empty
#     areas and NO single large blob (real dirt/rock, not patchy blotches — specs/assets.md,
#     specs/world.md). The 3 variants share the band fill + palette and differ ONLY in the
#     fine-grain LAYOUT (a different PRNG seed), so every variant reads as the same even
#     dirt. Grain reaches all edges evenly so neighbouring tiles seam.
#   • the unminable BEDROCK border, the carved-out dark TUNNEL interior fill, and the NEW
#     unbreakable STONE boulder (two variants) — a hard, cold, SMOOTH dark block that reads
#     clearly as a DIFFERENT, HARDER material than the grainy band dirt (specs/world.md).
#   • the NEW drill-damage CRACK sheet (`draw-sheet`, 4 frames, transparent overlay) — a
#     front-to-back progression from a couple of faint hairlines to a shattered face, drawn
#     over the tile being drilled (specs/assets.md, specs/character.md).
#   • the six 80x80 ORE VEINS (Ferron, Cuprite, Argenite, Voltite, Pyronium, Adamite)
#     as transparent overlays the renderer lays over the band rock — each an embedded
#     SMEAR spread through the dirt (not a discrete dot) that feathers into transparency at
#     the edges so adjacent ore cells read continuous (specs/mining.md).
#   • the MATERIAL NODES — the Resonite (blue crystal) and Cryenite (violet crystal)
#     buried nodes, the glowing CORE in its chamber, and the extracted, unstable CORE
#     SAMPLE icon it yields (specs/mining.md, specs/hazards.md).
#   • the molten LAVA shimmer sheet (`draw-sheet`, one PNG per frame) — the molten interior
#     filling the WHOLE tile edge-to-edge; the code adds the dirt fringe by clipping this
#     full-tile sprite (specs/hazards.md, specs/world.md).
#
# There is NO distinct gas tile (a gas pocket now renders as ordinary band rock, betrayed
# only by the gas-seep particle effect — specs/world.md, specs/hazards.md) and NO tunnel-
# edge sprite (the carved dirt lip is shaped in code); this script removes both.
#
# Every colour matches the palette in specs/overview.md. The miner cycles, the surface
# buildings, the rocket stages, the HUD icons, the particle systems and the audio are
# produced by their own gen scripts; this one produces ONLY the world sprites above.
#
# The build itself is SELF-CONTAINED — it loads these committed PNGs and never invokes
# the tools. Re-run this once to regenerate them.
#
# Usage:  bash scripts/gen-world.sh   (draw / draw-sheet must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume).
set -euo pipefail

# --- Resolve the tools: prefer PATH, else the cargo target release dir. ----------
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  export PATH="$REL:$PATH"
fi
command -v draw       >/dev/null 2>&1 || { echo "draw not found on PATH"       >&2; exit 1; }
command -v draw-sheet >/dev/null 2>&1 || { echo "draw-sheet not found on PATH" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILES="$ROOT/assets/tiles"
CRACK="$TILES/crack"
ORE="$ROOT/assets/ore"
MAT="$ROOT/assets/materials"
HAZ="$ROOT/assets/hazards"
LAVA="$HAZ/lava"
mkdir -p "$TILES" "$CRACK" "$ORE" "$MAT" "$HAZ" "$LAVA"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# --- single-sprite helpers (draw) -----------------------------------------------
# newsprite <w> <h> <out.png> : fresh transparent canvas that renders straight to <out>.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# --- sheet helpers (draw-sheet) --------------------------------------------------
# newsheet <w> <h> <framecount> <dir> : an N-frame set rendered to <dir>/frame{n}.png.
# (frames 0..N-1 render as frame0.png…; a rename pass below zero-pads to frame00.png…
#  so the engine's glob sorts them correctly, per ASSET-LAYOUT.md.)
newsheet() {
  local frames="" i
  for (( i=0; i<$3; i++ )); do frames+="${frames:+,}$i"; done
  printf '{ "width": %s, "height": %s, "background": "transparent", "frames": [%s], "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$frames" "$TMP/f_{frame}.json" "$4/frame{frame}.png" > "$CFG"
  draw-sheet init --config "$CFG" >/dev/null
}
s() { draw-sheet "$@" --config "$CFG" >/dev/null; }

# --- deterministic PRNG (a plain LCG) so the grain is reproducible per seed -------
RSEED=0
rnd() {  # rnd <n> : sets R to a value in [0, n)
  RSEED=$(( (RSEED * 1103515245 + 12345) & 0x7fffffff ))
  R=$(( (RSEED >> 8) % $1 ))
}

# ================================================================================
# BAND ROCK TILES (80x80, tileable) — fine, EVEN grain filling the whole tile.
# ================================================================================
# grain <out> <fill> <seed> <dark0> <dark1> <light0> <light1> :
#   flood the band fill, then stamp a fine, even grain of small darker/lighter specks,
#   3px flecks and 2px "short cracks" over a jittered grid that covers the WHOLE tile —
#   no big empty areas, no single large blob (specs/assets.md). Only the layout (the seed)
#   differs between a band's three variants; the fill + palette are shared.
grain() {
  local out="$1" fill="$2" seed="$3"; shift 3
  local shades=("$@") x y x2 y2 col n
  newsprite 80 80 "$out"
  d fill-background --color "$fill"
  RSEED="$seed"
  n=${#shades[@]}
  local gx gy
  for (( gy=0; gy<80; gy+=6 )); do
    for (( gx=0; gx<80; gx+=6 )); do
      rnd 6; x=$(( gx + R )); (( x > 79 )) && x=79
      rnd 6; y=$(( gy + R )); (( y > 79 )) && y=79
      rnd "$n"; col="${shades[$R]}"
      rnd 10
      if (( R < 2 )); then                 # short 2px crack (adds fracture texture)
        rnd 2
        if (( R == 0 )); then
          x2=$(( x + 1 )); (( x2 > 79 )) && x2=79
          d line --x0 "$x" --y0 "$y" --x1 "$x2" --y1 "$y" --color "$col"
        else
          y2=$(( y + 1 )); (( y2 > 79 )) && y2=79
          d line --x0 "$x" --y0 "$y" --x1 "$x" --y1 "$y2" --color "$col"
        fi
      elif (( R < 4 )); then               # 3px fleck
        d fill-circle --cx "$x" --cy "$y" --r 1 --color "$col"
      else                                 # 1px speck
        d set-pixel --x "$x" --y "$y" --color "$col"
      fi
    done
  done
}

# warm_specks <seed> <warmA> <warmB> : a faint, sparse warm glow tint (coreshell only) —
# a handful of warm flecks over a coarse jittered grid so the glow reads without patching.
warm_specks() {
  local seed="$1" wa="$2" wb="$3" x y col gx gy
  RSEED="$seed"
  for (( gy=4; gy<80; gy+=22 )); do
    for (( gx=4; gx<80; gx+=22 )); do
      rnd 18; x=$(( gx + R )); (( x > 79 )) && x=79
      rnd 18; y=$(( gy + R )); (( y > 79 )) && y=79
      rnd 3
      if (( R == 0 )); then col="$wa"; else col="$wb"; fi
      rnd 2
      if (( R == 0 )); then d fill-circle --cx "$x" --cy "$y" --r 1 --color "$col"
      else d set-pixel --x "$x" --y "$y" --color "$col"; fi
    done
  done
}

# -------- Topsoil (band 1) — warm brown earth, #3a2c1f -----------------------
grain "$TILES/topsoil-0.png"   '#3a2c1f' 101 '#30241a' '#281d13' '#47372a' '#52412f'
grain "$TILES/topsoil-1.png"   '#3a2c1f' 102 '#30241a' '#281d13' '#47372a' '#52412f'
grain "$TILES/topsoil-2.png"   '#3a2c1f' 103 '#30241a' '#281d13' '#47372a' '#52412f'

# -------- Rockbed (band 2) — grey stone, #3a3d44 -----------------------------
grain "$TILES/rockbed-0.png"   '#3a3d44' 201 '#313339' '#292b31' '#454951' '#51555e'
grain "$TILES/rockbed-1.png"   '#3a3d44' 202 '#313339' '#292b31' '#454951' '#51555e'
grain "$TILES/rockbed-2.png"   '#3a3d44' 203 '#313339' '#292b31' '#454951' '#51555e'

# -------- Deepstone (band 3) — near-black rock, #20242c ----------------------
grain "$TILES/deepstone-0.png" '#20242c' 301 '#191c23' '#131519' '#2a2e37' '#343945'
grain "$TILES/deepstone-1.png" '#20242c' 302 '#191c23' '#131519' '#2a2e37' '#343945'
grain "$TILES/deepstone-2.png" '#20242c' 303 '#191c23' '#131519' '#2a2e37' '#343945'

# -------- Coreshell (band 4) — red-glowing rock, #3a1512 (+ faint #ff6a2a glow) --
grain "$TILES/coreshell-0.png" '#3a1512' 401 '#300f0c' '#280b09' '#481d18' '#55251f'
warm_specks 401 '#ff6a2a' '#c4451f'
grain "$TILES/coreshell-1.png" '#3a1512' 402 '#300f0c' '#280b09' '#481d18' '#55251f'
warm_specks 402 '#ff6a2a' '#c4451f'
grain "$TILES/coreshell-2.png" '#3a1512' 403 '#300f0c' '#280b09' '#481d18' '#55251f'
warm_specks 403 '#ff6a2a' '#c4451f'

# -------- Bedrock border — unminable, near-black, #0c0f14 (80x80) ------------
# The hard, impassable bound of the playable space. Reads clearly denser & inert vs the
# minable rock — a flat near-black wall with a subtle even dark grain and a few hard
# beveled facets + recessed seams so it reads as a solid impassable block, no glow.
grain "$TILES/bedrock.png" '#0c0f14' 501 '#06080b' '#04060a' '#141821' '#1a1f28'
# hard angular facets (a blocky, solid read)
d fill-rect --x 6  --y 6  --width 28 --height 24 --color '#131722'
d fill-rect --x 6  --y 6  --width 28 --height 2  --color '#1a1f28'
d fill-rect --x 44 --y 12 --width 28 --height 30 --color '#101520'
d fill-rect --x 44 --y 12 --width 2  --height 30 --color '#1a1f28'
d fill-rect --x 14 --y 44 --width 24 --height 28 --color '#131722'
d fill-rect --x 48 --y 50 --width 24 --height 22 --color '#101520'
# recessed seams between the blocks
d line --x0 38 --y0 2  --x1 40 --y1 78 --color '#05070a'
d line --x0 2  --y0 40 --x1 78 --y1 42 --color '#05070a'
# a few beveled highlights + pits so the facets catch the lamp
d set-pixel --x 20 --y 20 --color '#1a1f28'
d set-pixel --x 58 --y 26 --color '#1a1f28'
d set-pixel --x 24 --y 58 --color '#1a1f28'
d set-pixel --x 60 --y 60 --color '#05070a'
d set-pixel --x 50 --y 32 --color '#05070a'

# -------- Tunnel — the carved-out empty cell interior fill, #0a0d12 (80x80) --
# The DARK carved-tunnel interior fill the code paints inside a carved hole (the dirt lip
# is shaped in code). A flat-ish dark rubble texture, edge to edge: very subtle darker
# noise so a dug shaft reads as carved rubble, not a flat void.
grain "$TILES/tunnel.png" '#0a0d12' 601 '#070a0e' '#05080c' '#0e1218' '#10141a'

# ================================================================================
# UNBREAKABLE STONE (80x80) — a hard, cold, SMOOTH dark boulder that reads as a DIFFERENT,
# HARDER material than the grainy band dirt (specs/world.md): base #4c5360, a rounded,
# slightly-riveted block with a lighter top-left sheen and a darker bottom for volume, NO
# fine grain. It fills the whole tile (a solid block, not inset). Two variants differ only
# in the sheen/rivet placement.
# ================================================================================
stone() {
  local out="$1" v="$2"
  newsprite 80 80 "$out"
  d fill-background --color '#4c5360'
  # vertical volume gradient: lighter toward the top, darker toward the bottom
  d fill-rect --x 0 --y 0  --width 80 --height 14 --color '#565d6b'
  d fill-rect --x 0 --y 0  --width 80 --height 6  --color '#5f6675'
  d fill-rect --x 0 --y 56 --width 80 --height 24 --color '#434852'
  d fill-rect --x 0 --y 64 --width 80 --height 16 --color '#3b404a'
  d fill-rect --x 0 --y 72 --width 80 --height 8  --color '#33383f'
  # round the corners a touch (darker) so it reads as a boulder, not a flat square
  d fill-circle --cx 2  --cy 2  --r 5 --color '#3b404a'
  d fill-circle --cx 78 --cy 2  --r 5 --color '#3b404a'
  d fill-circle --cx 2  --cy 78 --r 5 --color '#33383f'
  d fill-circle --cx 78 --cy 78 --r 5 --color '#33383f'
  if (( v == 0 )); then
    # broad top-left sheen (a soft white catch), then a smaller bright glint
    d fill-circle --cx 28 --cy 24 --r 12 --color '#5a6170'
    d fill-circle --cx 26 --cy 22 --r 7  --color '#646b7a'
    d fill-circle --cx 24 --cy 20 --r 3  --color '#7a808c'
    d set-pixel   --x 23 --y 19 --color '#9aa0ac'
    # a couple of rivets (highlight dot + shadow) for the wrought-stone read
    d fill-circle --cx 56 --cy 30 --r 2 --color '#40454f'; d set-pixel --x 55 --y 29 --color '#646b7a'
    d fill-circle --cx 38 --cy 54 --r 2 --color '#40454f'; d set-pixel --x 37 --y 53 --color '#5f6675'
    d fill-circle --cx 60 --cy 58 --r 2 --color '#3b404a'; d set-pixel --x 59 --y 57 --color '#565d6b'
  else
    d fill-circle --cx 32 --cy 22 --r 12 --color '#5a6170'
    d fill-circle --cx 30 --cy 20 --r 7  --color '#646b7a'
    d fill-circle --cx 28 --cy 18 --r 3  --color '#7a808c'
    d set-pixel   --x 27 --y 17 --color '#9aa0ac'
    d fill-circle --cx 26 --cy 52 --r 2 --color '#40454f'; d set-pixel --x 25 --y 51 --color '#646b7a'
    d fill-circle --cx 58 --cy 34 --r 2 --color '#40454f'; d set-pixel --x 57 --y 33 --color '#5f6675'
    d fill-circle --cx 52 --cy 60 --r 2 --color '#3b404a'; d set-pixel --x 51 --y 59 --color '#565d6b'
  fi
}
stone "$TILES/stone-0.png" 0
stone "$TILES/stone-1.png" 1

# ================================================================================
# DRILL-DAMAGE CRACK SHEET (80x80, TRANSPARENT overlay) — `draw-sheet`, 4 frames.
# A front-to-back PROGRESSION (not a loop) composited over the tile being drilled: faint
# hairlines from the centre → deeper, branching cracks → a shattered, about-to-break face
# with a few light chip highlights (specs/assets.md, specs/character.md).
# ================================================================================
CRACK_FRAMES=4
newsheet 80 80 "$CRACK_FRAMES" "$CRACK"
# frame 00 — a couple of faint dark hairline cracks from the centre
s line --frame 0 --x0 40 --y0 40 --x1 22 --y1 20 --color '#181c22'
s line --frame 0 --x0 40 --y0 40 --x1 58 --y1 60 --color '#181c22'
# frame 01 — the two deepen + two more radial cracks appear
s line --frame 1 --x0 40 --y0 40 --x1 20 --y1 18 --color '#121519'
s line --frame 1 --x0 40 --y0 40 --x1 60 --y1 62 --color '#121519'
s line --frame 1 --x0 40 --y0 40 --x1 62 --y1 22 --color '#151920'
s line --frame 1 --x0 40 --y0 40 --x1 18 --y1 58 --color '#151920'
# frame 02 — cracks reach the edges and branch; the face is fracturing
s line --frame 2 --x0 40 --y0 40 --x1 16 --y1 14 --color '#0d1014'
s line --frame 2 --x0 40 --y0 40 --x1 64 --y1 66 --color '#0d1014'
s line --frame 2 --x0 40 --y0 40 --x1 66 --y1 18 --color '#0d1014'
s line --frame 2 --x0 40 --y0 40 --x1 14 --y1 62 --color '#0d1014'
s line --frame 2 --x0 22 --y0 20 --x1 12 --y1 30 --color '#101318'   # branch
s line --frame 2 --x0 58 --y0 60 --x1 70 --y1 54 --color '#101318'   # branch
s line --frame 2 --x0 40 --y0 40 --x1 40 --y1 12 --color '#101318'
s line --frame 2 --x0 40 --y0 40 --x1 70 --y1 42 --color '#101318'
# frame 03 — a shattered, about-to-break web of cracks + a few light chip highlights
s line --frame 3 --x0 40 --y0 40 --x1 14 --y1 12 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 66 --y1 68 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 68 --y1 16 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 12 --y1 64 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 40 --y1 10 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 72 --y1 40 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 10 --y1 40 --color '#080a0d'
s line --frame 3 --x0 40 --y0 40 --x1 42 --y1 72 --color '#080a0d'
s line --frame 3 --x0 22 --y0 18 --x1 10 --y1 28 --color '#0b0e12'   # branches
s line --frame 3 --x0 60 --y0 62 --x1 72 --y1 56 --color '#0b0e12'
s line --frame 3 --x0 64 --y0 20 --x1 74 --y1 30 --color '#0b0e12'
s line --frame 3 --x0 16 --y0 60 --x1 26 --y1 70 --color '#0b0e12'
# light chip highlights (spalled flakes about to fall out)
s set-pixel --frame 3 --x 30 --y 30 --color '#8a909c'
s set-pixel --frame 3 --x 52 --y 48 --color '#8a909c'
s set-pixel --frame 3 --x 46 --y 30 --color '#b0b6c2'
s set-pixel --frame 3 --x 34 --y 52 --color '#b0b6c2'
s fill-circle --frame 3 --cx 30 --cy 30 --r 1 --color '#767c88'
s fill-circle --frame 3 --cx 52 --cy 48 --r 1 --color '#767c88'
# zero-pad frame{n}.png -> frameNN.png
for (( f=0; f<CRACK_FRAMES; f++ )); do
  mv "$CRACK/frame$f.png" "$CRACK/$(printf 'frame%02d.png' "$f")"
done

# ================================================================================
# ORE VEINS (80x80, transparent overlays) — each an embedded SMEAR run through the dirt
# that feathers into transparency at the edges (specs/mining.md). Each keeps its ore's
# character on top of the shared smear.
# ================================================================================
# smear <base> <hi> <dk> : the shared ore-vein body — a diagonal streak of overlapping
# soft lobes with offshoots, darker grain threaded through, and feathered specks bleeding
# the ore out toward the tile edges so adjacent ore cells read as one continuous vein.
smear() {
  local base="$1" hi="$2" dk="$3"
  # main diagonal streak (upper-left -> lower-right), overlapping lobes
  d fill-circle --cx 22 --cy 25 --r 8  --color "$base"
  d fill-circle --cx 33 --cy 33 --r 10 --color "$base"
  d fill-circle --cx 47 --cy 45 --r 10 --color "$base"
  d fill-circle --cx 58 --cy 55 --r 8  --color "$base"
  # short offshoots so the smear branches like a real vein
  d fill-circle --cx 55 --cy 27 --r 5  --color "$base"
  d fill-circle --cx 18 --cy 50 --r 5  --color "$base"
  # darker rock grain threaded through the mass (breaks up the solid blob)
  d line --x0 23 --y0 27 --x1 37 --y1 37 --color "$dk"
  d line --x0 40 --y0 40 --x1 57 --y1 53 --color "$dk"
  d fill-circle --cx 37 --cy 35 --r 3 --color "$dk"
  d fill-circle --cx 50 --cy 47 --r 2 --color "$dk"
  # feathered specks bleeding the ore out toward the tile edges (continuous vein)
  d set-pixel --x 12 --y 20 --color "$base"
  d set-pixel --x 67 --y 63 --color "$base"
  d set-pixel --x 70 --y 37 --color "$base"
  d set-pixel --x 15 --y 63 --color "$base"
  d set-pixel --x 63 --y 17 --color "$base"
  d set-pixel --x 8  --y 40 --color "$base"
  d set-pixel --x 40 --y 70 --color "$base"
  d set-pixel --x 73 --y 50 --color "$base"
  d set-pixel --x 30 --y 12 --color "$base"
  d set-pixel --x 50 --y 74 --color "$base"
  # bright specular glints on the ore
  d set-pixel --x 27 --y 27 --color "$hi"
  d set-pixel --x 43 --y 42 --color "$hi"
  d set-pixel --x 57 --y 53 --color "$hi"
  d set-pixel --x 20 --y 48 --color "$hi"
}

# -------- Ferron — dull rust-brown flecks, #b8794a (common) -----------------
newsprite 80 80 "$ORE/ferron.png"
smear '#b8794a' '#e0b488' '#6e4123'
d set-pixel --x 30 --y 40 --color '#a86a3e'
d set-pixel --x 50 --y 33 --color '#a86a3e'
d set-pixel --x 60 --y 43 --color '#cf9968'
d set-pixel --x 23 --y 57 --color '#cf9968'
d set-pixel --x 44 --y 50 --color '#a86a3e'

# -------- Cuprite — teal-green nodules, #4fb0a0 -----------------------------
newsprite 80 80 "$ORE/cuprite.png"
smear '#4fb0a0' '#9ce6d8' '#235f56'
d fill-circle --cx 33 --cy 33 --r 3 --color '#7fd6c6'
d fill-circle --cx 50 --cy 47 --r 3 --color '#7fd6c6'
d set-pixel --x 33 --y 33 --color '#c4f4ec'
d set-pixel --x 50 --y 47 --color '#c4f4ec'

# -------- Argenite — bright silver seams, #cdd6e0 ---------------------------
newsprite 80 80 "$ORE/argenite.png"
smear '#cdd6e0' '#f2f6fb' '#7a828e'
d line --x0 17 --y0 27 --x1 40 --y1 37 --color '#eef2f7'
d line --x0 40 --y0 37 --x1 60 --y1 53 --color '#eef2f7'
d line --x0 23 --y0 50 --x1 50 --y1 40 --color '#eef2f7'
d set-pixel --x 40 --y 37 --color '#ffffff'
d set-pixel --x 57 --y 50 --color '#ffffff'

# -------- Voltite — electric-blue crystals, #5a8cff -------------------------
newsprite 80 80 "$ORE/voltite.png"
smear '#5a8cff' '#b8d0ff' '#2a4488'
d line --x0 33 --y0 25 --x1 40 --y1 33 --color '#a8c4ff'
d line --x0 40 --y0 33 --x1 33 --y1 41 --color '#a8c4ff'
d line --x0 33 --y0 41 --x1 26 --y1 33 --color '#a8c4ff'
d line --x0 26 --y0 33 --x1 33 --y1 25 --color '#a8c4ff'
d set-pixel --x 33 --y 33 --color '#e8f0ff'
d set-pixel --x 50 --y 47 --color '#e8f0ff'

# -------- Pyronium — glowing orange ore, #ff8a3a (deep) ---------------------
newsprite 80 80 "$ORE/pyronium.png"
smear '#ff8a3a' '#ffd98a' '#a3491a'
d fill-circle --cx 40 --cy 38 --r 5 --color '#ffb347'
d fill-circle --cx 40 --cy 38 --r 2 --color '#ffcf4a'
d set-pixel --x 40 --y 38 --color '#fff2d6'
d set-pixel --x 55 --y 52 --color '#ffcf4a'

# -------- Adamite — rare aquamarine gem, #8affda ----------------------------
newsprite 80 80 "$ORE/adamite.png"
smear '#8affda' '#e8fff4' '#3f8f76'
d fill-circle --cx 40 --cy 38 --r 5 --color '#8affda'
d line --x0 40 --y0 30 --x1 48 --y1 38 --color '#c4ffe8'
d line --x0 48 --y0 38 --x1 40 --y1 46 --color '#c4ffe8'
d line --x0 40 --y0 46 --x1 32 --y1 38 --color '#c4ffe8'
d line --x0 32 --y0 38 --x1 40 --y1 30 --color '#c4ffe8'
d set-pixel --x 38 --y 37 --color '#ffffff'

# ================================================================================
# GEMSTONES (80x80, transparent overlays) — a CUT, FACETED JEWEL sitting in a dark rock
# socket (specs/mining.md). Deliberately unlike an ore SMEAR (a diffuse streak) and unlike a
# raw MATERIAL crystal cluster: a brilliant-cut stone — flat table on top, crown facets down to
# a wide girdle, pavilion facets to a culet point — shaded so light reads from the upper-right,
# with a bright glint, so a gem reads at a glance as the rarer, richer find. One per band below
# the topsoil, in the band's jewel color.
# ================================================================================
# gem <base> <hi> <dk> <edge> : draw the faceted jewel. Silhouette: table y22, girdle y38
# (widest, half-width 18), culet y60. Body filled row-by-row from the outline, then facet
# shading + cut edges + a table highlight + a sparkle.
gem() {
  local base="$1" hi="$2" dk="$3" edge="$4" y hw xl xr
  # dark rock socket so the gem is embedded, not floating on the rock
  d fill-circle --cx 40 --cy 42 --r 19 --color '#161a20'
  d fill-circle --cx 40 --cy 42 --r 16 --color '#20252d'
  # body — one horizontal line per row across the faceted silhouette
  for (( y=22; y<=60; y++ )); do
    if   (( y <= 26 )); then hw=10
    elif (( y <= 38 )); then hw=$(( 10 + (8*(y-26))/12 ))
    else                     hw=$(( (18*(60-y))/22 )); fi
    (( hw < 0 )) && hw=0
    xl=$(( 40 - hw )); xr=$(( 40 + hw ))
    d line --x0 "$xl" --y0 "$y" --x1 "$xr" --y1 "$y" --color "$base"
  done
  # left facets in shadow (darker), right facets lit (highlight) — light from the upper-right
  d line --x0 24 --y0 38 --x1 40 --y1 58 --color "$dk"
  d line --x0 28 --y0 34 --x1 40 --y1 52 --color "$dk"
  d line --x0 56 --y0 38 --x1 41 --y1 30 --color "$hi"
  d line --x0 52 --y0 42 --x1 41 --y1 50 --color "$hi"
  # table facet — a bright top plate with a thin base inlay
  d fill-rect --x 32 --y 23 --width 16 --height 5 --color "$hi"
  d fill-rect --x 33 --y 24 --width 14 --height 2 --color "$base"
  # cut edges (the gem's outline + girdle + centre ridge)
  d line --x0 30 --y0 22 --x1 50 --y1 22 --color "$edge"
  d line --x0 30 --y0 22 --x1 22 --y1 38 --color "$edge"
  d line --x0 50 --y0 22 --x1 58 --y1 38 --color "$edge"
  d line --x0 22 --y0 38 --x1 40 --y1 60 --color "$edge"
  d line --x0 58 --y0 38 --x1 40 --y1 60 --color "$edge"
  d line --x0 22 --y0 38 --x1 58 --y1 38 --color "$edge"
  # bright glint on the table + an off-stone sparkle
  d set-pixel  --x 44 --y 25 --color '#ffffff'
  d fill-circle --cx 45 --cy 26 --r 1 --color "$hi"
  d set-pixel  --x 62 --y 20 --color '#ffffff'
  d set-pixel  --x 63 --y 19 --color '#ffffff'
}

# -------- Verdite — emerald-green jewel, #2fe36a (rockbed) -------------------
newsprite 80 80 "$ORE/verdite.png"
gem '#2fe36a' '#b6ffce' '#12703a' '#0c4a26'

# -------- Roselite — rose-crimson jewel, #ff4f7a (deepstone) -----------------
newsprite 80 80 "$ORE/roselite.png"
gem '#ff4f7a' '#ffc2d4' '#8f2140' '#5c1329'

# -------- Aurite — golden jewel, #ffca28 (coreshell) ------------------------
newsprite 80 80 "$ORE/aurite.png"
gem '#ffca28' '#fff2c0' '#a5760a' '#6b4c06'

# ================================================================================
# MATERIAL NODES (80x80) — richer & rarer than an ore vein (specs/mining.md).
# ================================================================================
# crystal_node <out> <socket> <glow> <body> <shadow> <hi> <tip> : a big crystal cluster.
crystal_node() {
  newsprite 80 80 "$1"
  d fill-circle --cx 40 --cy 43 --r 25 --color "$2"   # dark rock socket
  d fill-circle --cx 40 --cy 43 --r 22 --color "$3"   # faint glow halo
  d fill-circle --cx 40 --cy 43 --r 12 --color "$2"
  # three angular crystals pointing up out of the socket
  # centre crystal
  d fill-rect --x 37 --y 17 --width 8 --height 37 --color "$4"
  d fill-rect --x 37 --y 17 --width 3 --height 37 --color "$6"
  d fill-rect --x 42 --y 17 --width 3 --height 37 --color "$5"
  d line --x0 37 --y0 17 --x1 40 --y1 8  --color "$4"
  d line --x0 44 --y0 17 --x1 40 --y1 8  --color "$4"
  d set-pixel --x 40 --y 10 --color "$7"
  # left crystal
  d fill-rect --x 22 --y 33 --width 7 --height 27 --color "$4"
  d fill-rect --x 22 --y 33 --width 2 --height 27 --color "$6"
  d fill-rect --x 27 --y 33 --width 2 --height 27 --color "$5"
  d line --x0 22 --y0 33 --x1 25 --y1 25 --color "$4"
  d line --x0 28 --y0 33 --x1 25 --y1 25 --color "$4"
  d set-pixel --x 25 --y 27 --color "$7"
  # right crystal
  d fill-rect --x 52 --y 37 --width 7 --height 23 --color "$4"
  d fill-rect --x 52 --y 37 --width 2 --height 23 --color "$6"
  d fill-rect --x 57 --y 37 --width 2 --height 23 --color "$5"
  d line --x0 52 --y0 37 --x1 55 --y1 30 --color "$4"
  d line --x0 58 --y0 37 --x1 55 --y1 30 --color "$4"
  d set-pixel --x 55 --y 32 --color "$7"
  # inner glints
  d set-pixel --x 40 --y 27 --color "$7"
  d set-pixel --x 40 --y 40 --color "$6"
}

# -------- Resonite — blue crystal (rockbed) ---------------------------------
crystal_node "$MAT/resonite.png" '#0e2230' '#1d5a72' '#4ad0ff' '#1d6a8c' '#a8ecff' '#eaf9ff'

# -------- Cryenite — violet crystal (deepstone) -----------------------------
crystal_node "$MAT/cryenite.png" '#1a1430' '#4a2f7a' '#b98cff' '#6a4aa0' '#e0ccff' '#f2e8ff'

# -------- Core — the glowing molten Core in its chamber (80x80) --------------
newsprite 80 80 "$MAT/core.png"
d fill-circle --cx 40 --cy 40 --r 37 --color '#3a0f08'   # outer heat bloom
d fill-circle --cx 40 --cy 40 --r 30 --color '#6a1a0c'
d fill-circle --cx 40 --cy 40 --r 23 --color '#a82a12'
d fill-circle --cx 40 --cy 40 --r 18 --color '#ff4a2a'
d fill-circle --cx 40 --cy 40 --r 13 --color '#ff6a2a'
d fill-circle --cx 40 --cy 40 --r 8  --color '#ff8a3a'
d fill-circle --cx 40 --cy 40 --r 5  --color '#ffcf4a'
d fill-circle --cx 40 --cy 40 --r 2  --color '#fff2d6'
# radiating fissures cracking out of the molten core
d line --x0 40 --y0 40 --x1 17 --y1 20 --color '#ffcf4a'
d line --x0 40 --y0 40 --x1 67 --y1 23 --color '#ff8a3a'
d line --x0 40 --y0 40 --x1 20 --y1 63 --color '#ff8a3a'
d line --x0 40 --y0 40 --x1 63 --y1 60 --color '#ffcf4a'
d set-pixel --x 17 --y 20 --color '#fff2d6'
d set-pixel --x 67 --y 23 --color '#fff2d6'

# -------- Core Sample — the extracted, unstable icon (80x80) ----------------
newsprite 80 80 "$MAT/core-sample.png"
d fill-circle --cx 40 --cy 40 --r 30 --color '#3a0f08'   # unstable heat halo
d fill-circle --cx 40 --cy 40 --r 22 --color '#6a1a0c'
# jagged unstable shard
d line --x0 40 --y0 8  --x1 60 --y1 40 --color '#ff4a2a'
d line --x0 60 --y0 40 --x1 40 --y1 72 --color '#ff4a2a'
d line --x0 40 --y0 72 --x1 20 --y1 40 --color '#ff4a2a'
d line --x0 20 --y0 40 --x1 40 --y1 8  --color '#ff4a2a'
d fill-circle --cx 40 --cy 40 --r 12 --color '#ff4a2a'
d fill-circle --cx 40 --cy 40 --r 8  --color '#ff8a3a'
d fill-circle --cx 40 --cy 40 --r 3  --color '#ffcf4a'
# energy cracks arcing across the shard (the "unstable" read)
d line --x0 40 --y0 40 --x1 55 --y1 20 --color '#fff2d6'
d line --x0 40 --y0 40 --x1 25 --y1 55 --color '#fff2d6'
d set-pixel --x 40 --y 8  --color '#ffcf4a'
d set-pixel --x 40 --y 72 --color '#ffcf4a'

# ================================================================================
# LAVA shimmer sheet (80x80, looping) — molten orange filling the WHOLE tile edge to
# edge (specs/hazards.md). No dirt border on the sprite — the code clips this full-tile
# sprite to add the dirt fringe. Dark crust islands drift and bright pools brighten/fade
# on a ping-pong phase so frame 5 loops back to frame 0 seamlessly.
# ================================================================================
LAVA_FRAMES=6
newsheet 80 80 "$LAVA_FRAMES" "$LAVA"
phase=(0 1 2 3 2 1)   # ping-pong phase per frame (0..3..0) so the loop reads continuous
for (( f=0; f<LAVA_FRAMES; f++ )); do
  ph=${phase[$f]}
  # molten base filling the whole tile
  s fill-background --frame "$f" --color '#ff5220'
  # drifting dark crust islands (position drifts with the phase)
  s fill-circle --frame "$f" --cx 24 --cy $(( 20 + ph * 5 )) --r 10 --color '#c43a16'
  s fill-circle --frame "$f" --cx 24 --cy $(( 20 + ph * 5 )) --r 5  --color '#a32e10'
  s fill-circle --frame "$f" --cx 60 --cy $(( 60 - ph * 5 )) --r 12 --color '#c43a16'
  s fill-circle --frame "$f" --cx 60 --cy $(( 60 - ph * 5 )) --r 6  --color '#a32e10'
  s fill-circle --frame "$f" --cx $(( 50 + ph * 2 )) --cy 24 --r 7  --color '#c43a16'
  # bright churn pools welling up (brightness/position shift with the phase)
  s fill-circle --frame "$f" --cx $(( 37 + ph * 2 )) --cy $(( 47 - ph * 2 )) --r 8 --color '#ff8a3a'
  s fill-circle --frame "$f" --cx $(( 37 + ph * 2 )) --cy $(( 47 - ph * 2 )) --r 5 --color '#ffb347'
  s fill-circle --frame "$f" --cx $(( 37 + ph * 2 )) --cy $(( 47 - ph * 2 )) --r 2 --color '#ffd278'
  s fill-circle --frame "$f" --cx $(( 58 - ph * 2 )) --cy $(( 37 + ph * 2 )) --r 5 --color '#ff8a3a'
  s fill-circle --frame "$f" --cx $(( 58 - ph * 2 )) --cy $(( 37 + ph * 2 )) --r 2 --color '#ffd278'
  # rising sparks (drift up as the phase advances)
  s set-pixel --frame "$f" --x 30 --y $(( 67 - ph * 7 )) --color '#ffd278'
  s set-pixel --frame "$f" --x 67 --y $(( 50 - ph * 5 )) --color '#ffcf4a'
  s set-pixel --frame "$f" --x 47 --y $(( 60 - ph * 8 )) --color '#ffb347'
done
# zero-pad frame{n}.png -> frameNN.png (ASSET-LAYOUT.md: frame00.png, frame01.png, …)
for (( f=0; f<LAVA_FRAMES; f++ )); do
  mv "$LAVA/frame$f.png" "$LAVA/$(printf 'frame%02d.png' "$f")"
done

# --- Retire the old distinct gas tile and the tunnel-edge trim (now done in code) ---
rm -f "$HAZ/gas.png" "$TILES/tunnel-edge.png"

echo "produced Deepcore world assets:"
echo "  tiles/       {topsoil,rockbed,deepstone,coreshell}-{0,1,2} bedrock tunnel stone-{0,1}"
echo "  tiles/crack/ frame00..$(printf '%02d' $(( CRACK_FRAMES - 1 ))) (drill-damage progression)"
echo "  ore/         ferron cuprite argenite voltite pyronium adamite (embedded smears)
                 + verdite roselite aurite (faceted gemstones)"
echo "  materials/   resonite cryenite core core-sample"
echo "  hazards/     lava/frame00..$(printf '%02d' $(( LAVA_FRAMES - 1 )))  (gas tile removed)"
