#!/usr/bin/env bash
# Arc Foundry — produce the PROJECTILE sprites and the HUD/shop/inspector ICONS with the
# on-PATH `draw` tool (specs/assets.md). One-time, committed step: the game loads these
# from assets/projectiles/ and assets/icons/ via src/assets.ts and NEVER invokes `draw`
# at build time.
#
#   Projectiles (single-bolt shots, drawn EAST-facing like the component heads so the game
#   rotates each to its heading, specs/towers.md):
#     assets/projectiles/capacitor.png   crisp blue-white bolt   (#8fc4ff / core #eaf6ff)
#     assets/projectiles/emitter.png     fast little teal spark  (#7fe0c0)
#     assets/projectiles/discharge.png   fat, violent heavy slug (#ff5470) — visibly fatter
#   (The Coil chain and the Arc-Node ring are particle effects, not projectile sprites.)
#
#   Icons (16-24 px HUD marks, specs/board.md/flow.md), in the specs/overview.md palette:
#     assets/icons/charge.png     Charge / money        (gold bolt,  #ffcf4a)
#     assets/icons/integrity.png  Grid Integrity / lives (teal grid-shield, #46d6e6)
#     assets/icons/{capacitor,coil,emitter,arcnode,discharge}.png  one glyph per type
#     assets/icons/{mote,spark,slug,cluster,filament,dynamo}.png   optional Load preview marks
#
# Usage:  bash scripts/gen-projectiles-icons.sh   (draw must be on PATH, or built under
#         $CARGO_TARGET_DIR/release — the devcontainer's cargo target volume, exactly as
#         Valence's scripts/gen-assets.sh resolves it).
set -euo pipefail

# Resolve the tool: prefer PATH, else the cargo target release dir.
if ! command -v draw >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/draw" ] || { echo "draw not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/assets/projectiles"
ICON="$ROOT/assets/icons"
mkdir -p "$PROJ" "$ICON"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CFG="$TMP/cfg.json"

# newsprite <w> <h> <out.png> : start a fresh transparent canvas of the given size.
newsprite() {
  printf '{ "width": %s, "height": %s, "background": "transparent", "actions": "%s", "preview": "%s" }\n' \
    "$1" "$2" "$TMP/log.json" "$3" > "$CFG"
  draw init --config "$CFG" >/dev/null
}
d() { draw "$@" --config "$CFG" >/dev/null; }

# =========================================================================================
# PROJECTILES — 16x16, nose pointing EAST (+x), centered on row y=8. The game rotates the
# whole sprite to the shot's heading; the muzzle/head sits at the +x nose.
# =========================================================================================

# --- Capacitor bolt: a crisp blue-white lance, thin and hot ------------------------------
newsprite 16 16 "$PROJ/capacitor.png"
d fill-circle --cx 9 --cy 8 --r 5 --color '#8fc4ff33'   # soft halo
d fill-rect --x 2 --y 7 --width 12 --height 2 --color '#4a86d8'  # dim outer streak
d fill-rect --x 3 --y 7 --width 10 --height 2 --color '#8fc4ff'  # body
d line --x0 4 --y0 7 --x1 12 --y1 7 --color '#bcdcff'    # upper glint
d line --x0 5 --y0 8 --x1 14 --y1 8 --color '#eaf6ff'    # hot core
d fill-circle --cx 14 --cy 8 --r 2 --color '#eaf6ff'     # nose flare
d fill-circle --cx 14 --cy 8 --r 1 --color '#ffffff'
d line --x0 3 --y0 8 --x1 0 --y1 5 --color '#8fc4ff'     # forked tail
d line --x0 3 --y0 8 --x1 0 --y1 11 --color '#8fc4ff'
d set-pixel --x 7 --y 6 --color '#eaf6ff'                # crackle
d set-pixel --x 9 --y 10 --color '#bcdcff'

# --- Emitter spark: small, fast, teal ----------------------------------------------------
newsprite 16 16 "$PROJ/emitter.png"
d fill-circle --cx 10 --cy 8 --r 3 --color '#7fe0c033'
d fill-rect --x 6 --y 7 --width 7 --height 2 --color '#3fae8e'
d fill-rect --x 7 --y 7 --width 6 --height 2 --color '#7fe0c0'
d line --x0 8 --y0 8 --x1 13 --y1 8 --color '#eaf6ff'
d fill-circle --cx 13 --cy 8 --r 2 --color '#baf5e2'
d fill-circle --cx 13 --cy 8 --r 1 --color '#ffffff'
d set-pixel --x 5 --y 7 --color '#7fe0c0'                # trailing sparks
d set-pixel --x 4 --y 9 --color '#3fae8e'
d set-pixel --x 5 --y 9 --color '#baf5e2'

# --- Discharge Rig heavy slug: fat, violent, red-pink — visibly heavier than the bolt ----
newsprite 16 16 "$PROJ/discharge.png"
d fill-circle --cx 9 --cy 8 --r 6 --color '#ff547040'    # big violent halo
d fill-rect --x 2 --y 5 --width 12 --height 6 --color '#a83048'  # dim outer slug
d fill-rect --x 3 --y 6 --width 11 --height 4 --color '#ff5470'  # body
d fill-rect --x 5 --y 7 --width 9 --height 2 --color '#ffb0c0'   # hot band
d line --x0 5 --y0 8 --x1 14 --y1 8 --color '#eaf6ff'    # incandescent core
d fill-circle --cx 14 --cy 8 --r 3 --color '#ff8fa0'     # heavy nose
d fill-circle --cx 14 --cy 8 --r 2 --color '#ffd0d8'
d fill-circle --cx 14 --cy 8 --r 1 --color '#ffffff'
d line --x0 3 --y0 8 --x1 0 --y1 3 --color '#ff5470'     # wide forked tail
d line --x0 3 --y0 8 --x1 0 --y1 13 --color '#ff5470'
d set-pixel --x 8 --y 6 --color '#ffd0d8'                # crackle
d set-pixel --x 10 --y 10 --color '#ffb0c0'
d set-pixel --x 6 --y 10 --color '#ff8fa0'

# --- Choke bolt: an icy-cyan slow round, a heavy frosted drag-slug ------------------------
newsprite 16 16 "$PROJ/choke.png"
d fill-circle --cx 9 --cy 8 --r 5 --color '#66d9e833'    # frosty halo
d fill-rect --x 3 --y 6 --width 11 --height 4 --color '#2f7d8a'  # dim outer slug
d fill-rect --x 4 --y 6 --width 10 --height 4 --color '#66d9e8'  # body
d fill-rect --x 5 --y 7 --width 9 --height 2 --color '#a6ecf3'   # frost band
d line --x0 5 --y0 8 --x1 14 --y1 8 --color '#eaf6ff'    # cold core
d fill-circle --cx 14 --cy 8 --r 3 --color '#a6ecf3'     # heavy nose
d fill-circle --cx 14 --cy 8 --r 1 --color '#ffffff'
d line --x0 3 --y0 8 --x1 0 --y1 4 --color '#66d9e8'     # frost-fork tail
d line --x0 3 --y0 8 --x1 0 --y1 12 --color '#66d9e8'
d set-pixel --x 8 --y 5 --color '#e6fbff'               # frost crystals
d set-pixel --x 10 --y 11 --color '#a6ecf3'
d set-pixel --x 6 --y 11 --color '#e6fbff'

# --- Rectifier bolt: an ember burn round, glowing hot with a smouldering trail ------------
newsprite 16 16 "$PROJ/rectifier.png"
d fill-circle --cx 9 --cy 8 --r 5 --color '#ff6b3d33'    # ember halo
d fill-rect --x 3 --y 6 --width 11 --height 4 --color '#a8401c'  # dim outer ember
d fill-rect --x 4 --y 6 --width 10 --height 4 --color '#ff6b3d'  # body
d fill-rect --x 5 --y 7 --width 9 --height 2 --color '#ff9e72'   # hot band
d line --x0 5 --y0 8 --x1 14 --y1 8 --color '#fff0d6'    # white-hot core
d fill-circle --cx 14 --cy 8 --r 2 --color '#ffc79e'     # burning nose
d fill-circle --cx 14 --cy 8 --r 1 --color '#ffffff'
d line --x0 3 --y0 8 --x1 0 --y1 5 --color '#ff6b3d'     # smouldering fork tail
d line --x0 3 --y0 8 --x1 0 --y1 11 --color '#c9531f'
d set-pixel --x 7 --y 5 --color '#ffd0a8'               # sparks
d set-pixel --x 9 --y 11 --color '#ff9e72'
d set-pixel --x 5 --y 10 --color '#ffb680'

echo "produced projectile sprites under $PROJ"

# =========================================================================================
# ICONS — 24x24 HUD/inspector marks, small and readable at a glance, in the overview palette.
# =========================================================================================

# --- Charge (money): a bold gold lightning bolt ------------------------------------------
newsprite 24 24 "$ICON/charge.png"
d fill-rect --x 14 --y 3  --width 4 --height 4 --color '#ffcf4a'  # top-right stroke
d fill-rect --x 12 --y 6  --width 4 --height 4 --color '#ffcf4a'
d fill-rect --x 10 --y 9  --width 7 --height 3 --color '#ffcf4a'  # bright flash / kink
d fill-rect --x 12 --y 11 --width 4 --height 3 --color '#ffcf4a'  # lower tail
d fill-rect --x 10 --y 14 --width 4 --height 3 --color '#ffcf4a'
d fill-rect --x 8  --y 17 --width 4 --height 3 --color '#ffcf4a'
d fill-rect --x 15 --y 4  --width 2 --height 3 --color '#ffe89a'  # hot highlight core
d fill-rect --x 13 --y 7  --width 2 --height 3 --color '#ffe89a'
d fill-rect --x 11 --y 10 --width 3 --height 2 --color '#ffe89a'
d fill-rect --x 11 --y 12 --width 2 --height 2 --color '#ffe89a'
d fill-rect --x 9  --y 15 --width 2 --height 2 --color '#ffe89a'
d set-pixel --x 12 --y 10 --color '#ffffff'

# --- Grid Integrity (lives): a teal shield with a grid cross -----------------------------
newsprite 24 24 "$ICON/integrity.png"
d fill-rect --x 4  --y 4  --width 16 --height 10 --color '#2a8f9c'  # rim: crown
d fill-rect --x 5  --y 14 --width 14 --height 1  --color '#2a8f9c'  # rim: taper
d fill-rect --x 6  --y 15 --width 12 --height 1  --color '#2a8f9c'
d fill-rect --x 7  --y 16 --width 10 --height 1  --color '#2a8f9c'
d fill-rect --x 8  --y 17 --width 8  --height 1  --color '#2a8f9c'
d fill-rect --x 9  --y 18 --width 6  --height 1  --color '#2a8f9c'
d fill-rect --x 10 --y 19 --width 4  --height 1  --color '#2a8f9c'
d fill-rect --x 11 --y 20 --width 2  --height 1  --color '#2a8f9c'
d fill-rect --x 6  --y 6  --width 12 --height 8  --color '#46d6e6'  # bright body
d fill-rect --x 7  --y 14 --width 10 --height 1  --color '#46d6e6'  # bright taper
d fill-rect --x 8  --y 15 --width 8  --height 1  --color '#46d6e6'
d fill-rect --x 9  --y 16 --width 6  --height 1  --color '#46d6e6'
d fill-rect --x 10 --y 17 --width 4  --height 1  --color '#46d6e6'
d fill-rect --x 11 --y 18 --width 2  --height 1  --color '#46d6e6'
d fill-rect --x 6  --y 6  --width 12 --height 1  --color '#a8f0f7'  # top edge glint
d fill-rect --x 11 --y 6  --width 1  --height 11 --color '#12161b'  # grid: vertical
d fill-rect --x 6  --y 9  --width 12 --height 1  --color '#12161b'  # grid: horizontal

# --- Capacitor glyph: the schematic two-plate symbol with an arc jumping the gap ---------
newsprite 24 24 "$ICON/capacitor.png"
d fill-rect --x 3  --y 11 --width 7  --height 2  --color '#8fc4ff'  # left lead
d fill-rect --x 16 --y 11 --width 6  --height 2  --color '#8fc4ff'  # right lead
d fill-rect --x 10 --y 5  --width 2  --height 14 --color '#8fc4ff'  # plate 1
d fill-rect --x 14 --y 5  --width 2  --height 14 --color '#8fc4ff'  # plate 2
d fill-rect --x 10 --y 5  --width 2  --height 3  --color '#bcdcff'  # plate glints
d fill-rect --x 14 --y 5  --width 2  --height 3  --color '#bcdcff'
d set-pixel --x 12 --y 9  --color '#eaf6ff'                          # arc across the gap
d set-pixel --x 13 --y 11 --color '#ffffff'
d set-pixel --x 12 --y 13 --color '#eaf6ff'

# --- Coil glyph: an inductor's series of loops -------------------------------------------
newsprite 24 24 "$ICON/coil.png"
d fill-rect --x 2  --y 14 --width 3 --height 2 --color '#b98cff'     # left lead
d fill-rect --x 19 --y 14 --width 3 --height 2 --color '#b98cff'     # right lead
d stroke-circle --cx 7  --cy 12 --r 3 --color '#b98cff'             # coil loops
d stroke-circle --cx 12 --cy 12 --r 3 --color '#b98cff'
d stroke-circle --cx 17 --cy 12 --r 3 --color '#b98cff'
d set-pixel --x 7  --y 9 --color '#d8c4ff'                           # loop-top glints
d set-pixel --x 12 --y 9 --color '#d8c4ff'
d set-pixel --x 17 --y 9 --color '#d8c4ff'

# --- Emitter glyph: a node spraying a fast fan of sparks ---------------------------------
newsprite 24 24 "$ICON/emitter.png"
d line --x0 13 --y0 12 --x1 21 --y1 12 --color '#7fe0c0'            # spray fan (rightward)
d line --x0 13 --y0 10 --x1 20 --y1 6  --color '#7fe0c0'
d line --x0 13 --y0 14 --x1 20 --y1 18 --color '#7fe0c0'
d line --x0 13 --y0 11 --x1 21 --y1 9  --color '#baf5e2'
d line --x0 11 --y0 12 --x1 4  --y1 12 --color '#7fe0c0'            # short back-flare
d fill-circle --cx 11 --cy 12 --r 3 --color '#7fe0c0'              # emitter node
d fill-circle --cx 11 --cy 12 --r 2 --color '#baf5e2'
d set-pixel --x 11 --y 12 --color '#ffffff'
d set-pixel --x 21 --y 12 --color '#eaf6ff'                          # spark tips
d set-pixel --x 20 --y 6  --color '#eaf6ff'
d set-pixel --x 20 --y 18 --color '#eaf6ff'

# --- Arc-Node glyph: expanding discharge rings around a core -----------------------------
newsprite 24 24 "$ICON/arcnode.png"
d stroke-circle --cx 12 --cy 12 --r 10 --color '#ff9a4670'          # faint outer ring
d stroke-circle --cx 12 --cy 12 --r 8  --color '#ff9a46b0'
d stroke-circle --cx 12 --cy 12 --r 5  --color '#ff9a46'
d fill-circle --cx 12 --cy 12 --r 2 --color '#ff9a46'               # core node
d fill-circle --cx 12 --cy 12 --r 1 --color '#ffe0c0'
d set-pixel --x 19 --y 6  --color '#ffe0c0'                          # arc crackle on rings
d set-pixel --x 5  --y 18 --color '#ffe0c0'
d set-pixel --x 18 --y 18 --color '#ffd8a8'

# --- Discharge Rig glyph: a heavy red bolt cracking into a bank bar -----------------------
newsprite 24 24 "$ICON/discharge.png"
d fill-rect --x 13 --y 3  --width 4 --height 3 --color '#ff5470'    # bolt
d fill-rect --x 11 --y 6  --width 4 --height 3 --color '#ff5470'
d fill-rect --x 12 --y 9  --width 4 --height 3 --color '#ff5470'
d fill-rect --x 10 --y 12 --width 4 --height 3 --color '#ff5470'
d fill-rect --x 14 --y 4  --width 1 --height 2 --color '#ffb0c0'    # hot core
d fill-rect --x 12 --y 7  --width 1 --height 2 --color '#ffb0c0'
d fill-rect --x 13 --y 10 --width 1 --height 2 --color '#ffb0c0'
d fill-rect --x 11 --y 13 --width 1 --height 2 --color '#ffb0c0'
d fill-rect --x 4  --y 17 --width 16 --height 4 --color '#ff5470'   # capacitor-bank bar
d fill-rect --x 5  --y 18 --width 14 --height 2 --color '#ff8fa0'
d set-pixel --x 11 --y 16 --color '#ffffff'                          # strike point

# --- Choke glyph: a narrowing throat with a frosted slow-arrow (icy cyan) -----------------
newsprite 24 24 "$ICON/choke.png"
d line --x0 3  --y0 4  --x1 11 --y1 12 --color '#3d8a99'            # converging throat walls
d line --x0 3  --y0 20 --x1 11 --y1 12 --color '#3d8a99'
d line --x0 21 --y0 4  --x1 13 --y1 12 --color '#66d9e8'
d line --x0 21 --y0 20 --x1 13 --y1 12 --color '#66d9e8'
d fill-circle --cx 12 --cy 12 --r 3 --color '#66d9e8'              # constricted core
d fill-circle --cx 12 --cy 12 --r 2 --color '#a6ecf3'
d set-pixel --x 12 --y 12 --color '#ffffff'
d set-pixel --x 6  --y 6  --color '#e6fbff'                          # frost specks
d set-pixel --x 6  --y 18 --color '#e6fbff'
d set-pixel --x 18 --y 6  --color '#a6ecf3'
d set-pixel --x 18 --y 18 --color '#a6ecf3'

# --- Rectifier glyph: a diode triangle-bar cracking into an ember flare (ember orange) ----
newsprite 24 24 "$ICON/rectifier.png"
d fill-rect --x 4  --y 11 --width 4  --height 2 --color '#ff6b3d'   # left lead
d fill-rect --x 16 --y 11 --width 4  --height 2 --color '#ff6b3d'   # right lead
d line --x0 8  --y0 5  --x1 8  --y1 19 --color '#ff6b3d'            # diode triangle (anode side)
d line --x0 8  --y0 5  --x1 15 --y1 12 --color '#ff6b3d'
d line --x0 8  --y0 19 --x1 15 --y1 12 --color '#ff6b3d'
d fill-rect --x 15 --y 5  --width 2  --height 14 --color '#ff6b3d'  # cathode bar
d fill-rect --x 15 --y 5  --width 2  --height 4  --color '#ff9e72'  # bar glint
d fill-circle --cx 11 --cy 12 --r 2 --color '#ff9e72'              # ember heat in the junction
d set-pixel --x 11 --y 12 --color '#fff0d6'
d set-pixel --x 17 --y 9  --color '#ffd0a8'                          # heat sparks
d set-pixel --x 6  --y 15 --color '#ffb680'

# --- Regulator glyph: an aura node with concentric support rings, NO barrel (lime) --------
newsprite 24 24 "$ICON/regulator.png"
d stroke-circle --cx 12 --cy 12 --r 10 --color '#7d9a3470'          # faint outer support ring
d stroke-circle --cx 12 --cy 12 --r 7  --color '#b6e05a'           # aura ring
d fill-circle --cx 12 --cy 12 --r 3 --color '#b6e05a'              # emitter core
d fill-circle --cx 12 --cy 12 --r 2 --color '#d3ee96'
d set-pixel --x 12 --y 12 --color '#ffffff'
d fill-circle --cx 12 --cy 2  --r 1 --color '#d3ee96'              # four antenna prongs
d fill-circle --cx 22 --cy 12 --r 1 --color '#d3ee96'
d fill-circle --cx 12 --cy 22 --r 1 --color '#d3ee96'
d fill-circle --cx 2  --cy 12 --r 1 --color '#d3ee96'

echo "produced HUD/type/Load icons under $ICON"

# =========================================================================================
# COMBO ICONS (optional) — one gold-ringed accent glyph per combination tower, so a combo
# reads as a "superior" mark next to the base-type glyphs. 12x, keyed combo_<comboId>.
# =========================================================================================
combo_ids=(fusecluster staticweb slagdriver corroder ionprism forkarray \
           nullcore rupturenode blightcoil reactorpile auroralance singularity)
combo_acc=(  '#ff6b3d' '#9b7bff' '#ff5470' '#b6e05a' '#5ac8ff' '#7fe6b0' \
             '#8fe0b0' '#ffb347' '#c46bff' '#9be07a' '#66d9e8' '#a45cff')
combo_hot=(  '#ffb694' '#cbb8ff' '#ff9aac' '#dcef9e' '#a6e2ff' '#b6f2d6' \
             '#c4f0d8' '#ffd28a' '#e0b6ff' '#cff0b0' '#a6ecf3' '#d8b0ff')
for i in "${!combo_ids[@]}"; do
  id=${combo_ids[$i]}; acc=${combo_acc[$i]}; hot=${combo_hot[$i]}
  newsprite 24 24 "$ICON/combo_$id.png"
  d fill-circle --cx 12 --cy 12 --r 10 --color '#c9a24e'            # gold badge ring
  d fill-circle --cx 12 --cy 12 --r 9  --color '#0d141b'           # dark field
  d stroke-circle --cx 12 --cy 12 --r 9 --color '#ffe9a8'          # bright gold rim
  d fill-circle --cx 12 --cy 12 --r 6  --color "$acc"              # accent core
  d fill-circle --cx 12 --cy 12 --r 3  --color "$hot"
  d set-pixel --x 12 --y 12 --color '#ffffff'
  d set-pixel --x 12 --y 3  --color '#ffe9a8'                       # gold cardinal studs
  d set-pixel --x 21 --y 12 --color '#ffe9a8'
  d set-pixel --x 12 --y 21 --color '#ffe9a8'
  d set-pixel --x 3  --y 12 --color '#ffe9a8'
done

echo "produced combo icons under $ICON"

# --- Load-type preview marks (optional, next-wave preview) --------------------------------
# Mote — a plain charge blob.
newsprite 24 24 "$ICON/mote.png"
d fill-circle --cx 12 --cy 12 --r 6 --color '#6b7280'
d fill-circle --cx 12 --cy 12 --r 5 --color '#c4cbd6'
d fill-circle --cx 12 --cy 12 --r 3 --color '#e8eef5'
d set-pixel --x 10 --y 10 --color '#ffffff'

# Spark — small, fast, with a motion streak behind it.
newsprite 24 24 "$ICON/spark.png"
d line --x0 4 --y0 12 --x1 11 --y1 12 --color '#7fe0c0'
d line --x0 6 --y0 10 --x1 11 --y1 11 --color '#3fae8e'
d fill-circle --cx 14 --cy 12 --r 4 --color '#8fb0c0'
d fill-circle --cx 14 --cy 12 --r 3 --color '#c4cbd6'
d fill-circle --cx 14 --cy 12 --r 1 --color '#eaf6ff'

# Slug — a big, heavy, plated tank.
newsprite 24 24 "$ICON/slug.png"
d fill-circle --cx 12 --cy 12 --r 9 --color '#565c66'
d fill-circle --cx 12 --cy 12 --r 8 --color '#9aa2ad'
d fill-circle --cx 12 --cy 12 --r 6 --color '#c4cbd6'
d fill-rect --x 4 --y 11 --width 16 --height 2 --color '#565c66'   # plating seam
d fill-rect --x 11 --y 4 --width 2 --height 16 --color '#565c66'
d fill-circle --cx 12 --cy 12 --r 2 --color '#e8eef5'

# Cluster — a knot of tiny units.
newsprite 24 24 "$ICON/cluster.png"
d fill-circle --cx 8  --cy 9  --r 3 --color '#8b93a0'
d fill-circle --cx 8  --cy 9  --r 2 --color '#c4cbd6'
d fill-circle --cx 15 --cy 8  --r 3 --color '#8b93a0'
d fill-circle --cx 15 --cy 8  --r 2 --color '#c4cbd6'
d fill-circle --cx 11 --cy 15 --r 3 --color '#8b93a0'
d fill-circle --cx 11 --cy 15 --r 2 --color '#c4cbd6'
d fill-circle --cx 16 --cy 15 --r 2 --color '#c4cbd6'
d set-pixel --x 8  --y 9  --color '#eaf6ff'
d set-pixel --x 15 --y 8  --color '#eaf6ff'

# Filament — the flyer: an airborne mote with wings and a ground shadow.
newsprite 24 24 "$ICON/filament.png"
d fill-circle --cx 12 --cy 19 --r 4 --color '#00000038'            # ground shadow (airborne cue)
d line --x0 4  --y0 8 --x1 9  --y1 10 --color '#9aa2ad'            # wings
d line --x0 20 --y0 8 --x1 15 --y1 10 --color '#9aa2ad'
d line --x0 5  --y0 10 --x1 9 --y1 11 --color '#c4cbd6'
d line --x0 19 --y0 10 --x1 15 --y1 11 --color '#c4cbd6'
d fill-circle --cx 12 --cy 10 --r 4 --color '#8b93a0'             # body
d fill-circle --cx 12 --cy 10 --r 3 --color '#c4cbd6'
d fill-circle --cx 12 --cy 10 --r 1 --color '#eaf6ff'

# Dynamo — the boss: an unstable overload core, spiked and crackling.
newsprite 24 24 "$ICON/dynamo.png"
d line --x0 12 --y0 1  --x1 12 --y1 23 --color '#a45cff'           # spikes
d line --x0 1  --y0 12 --x1 23 --y1 12 --color '#a45cff'
d line --x0 4  --y0 4  --x1 20 --y1 20 --color '#7a3fd0'
d line --x0 20 --y0 4  --x1 4  --y1 20 --color '#7a3fd0'
d fill-circle --cx 12 --cy 12 --r 8 --color '#3f2170'             # core
d fill-circle --cx 12 --cy 12 --r 6 --color '#a45cff'
d fill-circle --cx 12 --cy 12 --r 3 --color '#d8b0ff'
d fill-circle --cx 12 --cy 12 --r 1 --color '#ffffff'
d set-pixel --x 9  --y 9  --color '#eaf6ff'                         # crackle
d set-pixel --x 15 --y 14 --color '#eaf6ff'

echo "produced Load-preview icons under $ICON"
