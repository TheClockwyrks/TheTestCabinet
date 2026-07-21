#!/bin/sh
# Reference implementation — Lattice Items (variant `base`).
#
# Draws the seven Lattice item icons with `draw-sheet`, one operation at a time,
# exactly as a model would. Run from a seeded asset workspace (see
# `tcab publish-reference`): `draw.config.json`, the empty per-frame action logs
# and the blank previews are already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The seven frames hold seven separate static icons, not an animation. Their
# order is the simulation's own item table, so a frame index *is* an item index;
# each one is named below rather than written as a bare number at the call site.

set -eu

# --- The item table ------------------------------------------------------------
IRON_ORE=0
IRON_PLATE=1
IRON_GEAR=2
COPPER_ORE=3
COPPER_PLATE=4
COPPER_CABLE=5
CIRCUIT=6

# --- Palette (the brief's table, and nothing else) ------------------------------
#
# One outline tone is shared by all seven, which is most of what makes them read
# as a family. Two icons — copper ore and the circuit board — are given no shadow
# tone of their own, so they bind their shadow slot to that same outline.
OUTLINE='#1b1d21'

ORE_FE='#8c98a8'
ORE_FE_HI='#b4bdc9'
ORE_FE_LO='#5d6776'

PLATE_FE='#b9c0cb'
PLATE_FE_HI='#e3e8ef'
PLATE_FE_LO='#6f7884'

GEAR_FE='#7d8794'
GEAR_FE_HI='#aab3bf'
GEAR_FE_LO='#4d5560'

ORE_CU='#c98a4a'
ORE_CU_HI='#e3b079'
FLECK='#3a8f86'

CU='#cf7a3c'
CU_HI='#f0a96a'
CU_LO='#8a4a1f'

BOARD='#3f9e57'
BOARD_HI='#6fce86'
TRACE='#e6b329'
CONTACT='#d6473a'

# --- Mark-making ----------------------------------------------------------------
#
# Every icon is built from horizontal runs and single pixels, which is all a
# 16x16 sprite needs. `row` takes the run's row and its inclusive first and last
# column — note that `line` names its endpoints x0/y0/x1/y1, not x1/y1/x2/y2.
row() {
	draw-sheet line --frame "$1" --y0 "$2" --y1 "$2" --x0 "$3" --x1 "$4" --color "$5"
}

dot() {
	draw-sheet set-pixel --frame "$1" --x "$2" --y "$3" --color "$4"
}

# --- The ore cluster (frames 0 and 3) -------------------------------------------
#
# The two ores are one silhouette in two metals: three overlapping nuggets, the
# nearer ones creasing the ones behind with the shared outline so the shape reads
# as a pile of rock rather than one smooth blob, and a bumpy, irregular edge the
# whole way round. Drawing both frames from this one function is what guarantees
# the pair is separated by colour alone, which is what the brief asks for.
#
# This pass lays the outline, the upper-left highlight and a flat base over
# everything; `ore_shade` then re-tones the lower-right.
#   $1 frame   $2 base   $3 highlight
ore_body() {
	row "$1" 1 9 11 "$OUTLINE"
	row "$1" 2 7 8 "$OUTLINE"
	row "$1" 2 9 11 "$3"
	row "$1" 2 12 12 "$OUTLINE"
	row "$1" 3 6 6 "$OUTLINE"
	row "$1" 3 7 9 "$3"
	row "$1" 3 10 11 "$2"
	row "$1" 3 12 12 "$3"
	row "$1" 3 13 13 "$OUTLINE"
	row "$1" 4 6 6 "$OUTLINE"
	row "$1" 4 7 7 "$3"
	row "$1" 4 8 12 "$2"
	row "$1" 4 13 13 "$OUTLINE"
	row "$1" 5 6 6 "$OUTLINE"
	row "$1" 5 7 7 "$3"
	row "$1" 5 8 12 "$2"
	row "$1" 5 13 13 "$OUTLINE"
	row "$1" 6 3 7 "$OUTLINE"
	row "$1" 6 8 8 "$3"
	row "$1" 6 9 12 "$2"
	row "$1" 6 13 13 "$OUTLINE"
	row "$1" 7 2 2 "$OUTLINE"
	row "$1" 7 3 7 "$3"
	row "$1" 7 8 8 "$OUTLINE"
	row "$1" 7 9 9 "$3"
	row "$1" 7 10 10 "$2"
	row "$1" 7 11 13 "$OUTLINE"
	row "$1" 8 2 2 "$OUTLINE"
	row "$1" 8 3 3 "$3"
	row "$1" 8 4 7 "$2"
	row "$1" 8 8 8 "$3"
	row "$1" 8 9 10 "$OUTLINE"
	row "$1" 8 11 13 "$3"
	row "$1" 8 14 14 "$OUTLINE"
	row "$1" 9 1 1 "$OUTLINE"
	row "$1" 9 2 3 "$3"
	row "$1" 9 4 8 "$2"
	row "$1" 9 9 9 "$OUTLINE"
	row "$1" 9 10 11 "$3"
	row "$1" 9 12 13 "$2"
	row "$1" 9 14 14 "$OUTLINE"
	row "$1" 10 1 1 "$OUTLINE"
	row "$1" 10 2 2 "$3"
	row "$1" 10 3 7 "$2"
	row "$1" 10 8 8 "$OUTLINE"
	row "$1" 10 9 10 "$3"
	row "$1" 10 11 13 "$2"
	row "$1" 10 14 14 "$OUTLINE"
	row "$1" 11 2 2 "$OUTLINE"
	row "$1" 11 3 3 "$3"
	row "$1" 11 4 7 "$2"
	row "$1" 11 8 8 "$OUTLINE"
	row "$1" 11 9 9 "$3"
	row "$1" 11 10 13 "$2"
	row "$1" 11 14 14 "$OUTLINE"
	row "$1" 12 2 2 "$OUTLINE"
	row "$1" 12 3 3 "$3"
	row "$1" 12 4 7 "$2"
	row "$1" 12 8 9 "$OUTLINE"
	row "$1" 12 10 10 "$3"
	row "$1" 12 11 13 "$2"
	row "$1" 12 14 14 "$OUTLINE"
	row "$1" 13 3 7 "$OUTLINE"
	row "$1" 13 10 13 "$OUTLINE"
}

# The cluster's lower-right shadow, in iron's own shadow tone.
#   $1 frame   $2 shadow tone
ore_shade() {
	row "$1" 4 12 12 "$2"
	row "$1" 5 12 12 "$2"
	row "$1" 6 10 12 "$2"
	row "$1" 7 10 10 "$2"
	row "$1" 9 7 8 "$2"
	row "$1" 9 13 13 "$2"
	row "$1" 10 7 7 "$2"
	row "$1" 10 13 13 "$2"
	row "$1" 11 7 7 "$2"
	row "$1" 11 13 13 "$2"
	row "$1" 12 4 7 "$2"
	row "$1" 12 11 13 "$2"
}

# Copper ore has no shadow tone of its own, so it shades against the shared
# outline instead — but only on the deepest cells of the lower-right, because the
# outline is far darker than a shadow tone and would otherwise eat the nuggets.
#   $1 frame   $2 outline
ore_shade_deep() {
	row "$1" 6 12 12 "$2"
	row "$1" 7 10 10 "$2"
	row "$1" 9 8 8 "$2"
	row "$1" 12 7 7 "$2"
	row "$1" 12 13 13 "$2"
}

# Copper ore only: a few teal-green flecks scattered over the nuggets.
#   $1 frame   $2 fleck colour
ore_flecks() {
	dot "$1" 10 4 "$2"
	dot "$1" 4 9 "$2"
	dot "$1" 12 11 "$2"
	dot "$1" 6 11 "$2"
}

# --- The flat plate (frames 1 and 4, and the circuit board on 6) ----------------
#
# One stamped rectangle with its corners clipped, a bright top and left edge and
# a dark bottom and right one — the "slight 3D edge" of the brief. The two plates
# differ only in the tones passed in; the circuit board reuses the same blank and
# has its traces and contacts laid over it afterwards.
#   $1 frame   $2 base   $3 highlight
plate_body() {
	row "$1" 2 2 13 "$OUTLINE"
	row "$1" 3 1 1 "$OUTLINE"
	row "$1" 3 2 13 "$3"
	row "$1" 3 14 14 "$OUTLINE"
	row "$1" 4 1 1 "$OUTLINE"
	row "$1" 4 2 2 "$3"
	row "$1" 4 3 13 "$2"
	row "$1" 4 14 14 "$OUTLINE"
	row "$1" 5 1 1 "$OUTLINE"
	row "$1" 5 2 2 "$3"
	row "$1" 5 3 13 "$2"
	row "$1" 5 14 14 "$OUTLINE"
	row "$1" 6 1 1 "$OUTLINE"
	row "$1" 6 2 2 "$3"
	row "$1" 6 3 13 "$2"
	row "$1" 6 14 14 "$OUTLINE"
	row "$1" 7 1 1 "$OUTLINE"
	row "$1" 7 2 2 "$3"
	row "$1" 7 3 13 "$2"
	row "$1" 7 14 14 "$OUTLINE"
	row "$1" 8 1 1 "$OUTLINE"
	row "$1" 8 2 2 "$3"
	row "$1" 8 3 13 "$2"
	row "$1" 8 14 14 "$OUTLINE"
	row "$1" 9 1 1 "$OUTLINE"
	row "$1" 9 2 2 "$3"
	row "$1" 9 3 13 "$2"
	row "$1" 9 14 14 "$OUTLINE"
	row "$1" 10 1 1 "$OUTLINE"
	row "$1" 10 2 2 "$3"
	row "$1" 10 3 13 "$2"
	row "$1" 10 14 14 "$OUTLINE"
	row "$1" 11 1 1 "$OUTLINE"
	row "$1" 11 2 2 "$3"
	row "$1" 11 3 13 "$2"
	row "$1" 11 14 14 "$OUTLINE"
	row "$1" 12 1 1 "$OUTLINE"
	row "$1" 12 2 2 "$3"
	row "$1" 12 3 13 "$2"
	row "$1" 12 14 14 "$OUTLINE"
	row "$1" 13 2 13 "$OUTLINE"
}

#   $1 frame   $2 shadow tone
plate_shade() {
	row "$1" 4 13 13 "$2"
	row "$1" 5 13 13 "$2"
	row "$1" 6 13 13 "$2"
	row "$1" 7 13 13 "$2"
	row "$1" 8 13 13 "$2"
	row "$1" 9 13 13 "$2"
	row "$1" 10 13 13 "$2"
	row "$1" 11 13 13 "$2"
	row "$1" 12 3 13 "$2"
}

# The board green has no shadow tone either, so it takes the same deep-cells-only
# treatment as copper ore.
#   $1 frame   $2 outline
plate_shade_deep() {
	row "$1" 12 13 13 "$2"
}

# A specular streak across the metal, running up-left to match the light. The
# circuit board does not get one — it is not polished stock.
#   $1 frame   $2 highlight
plate_sheen() {
	dot "$1" 3 9 "$2"
	dot "$1" 4 9 "$2"
	dot "$1" 4 8 "$2"
	dot "$1" 5 8 "$2"
	dot "$1" 5 7 "$2"
	dot "$1" 6 7 "$2"
	dot "$1" 6 6 "$2"
	dot "$1" 7 6 "$2"
	dot "$1" 7 5 "$2"
	dot "$1" 8 5 "$2"
}

# ===============================================================================
# Frame 0 — iron ore
# ===============================================================================
ore_body "$IRON_ORE" "$ORE_FE" "$ORE_FE_HI"
ore_shade "$IRON_ORE" "$ORE_FE_LO"

# ===============================================================================
# Frame 1 — iron plate
# ===============================================================================
plate_body "$IRON_PLATE" "$PLATE_FE" "$PLATE_FE_HI"
plate_shade "$IRON_PLATE" "$PLATE_FE_LO"
plate_sheen "$IRON_PLATE" "$PLATE_FE_HI"

# ===============================================================================
# Frame 2 — iron gear wheel
#
# A ring with a hole punched clean through it and eight square teeth stepping out
# around the rim. The hole is what separates a gear from a coin at this size, so
# it is drawn big enough to survive: a dark core ringed by the outline.
# ===============================================================================
row "$IRON_GEAR" 1 6 9 "$OUTLINE"
row "$IRON_GEAR" 2 6 6 "$OUTLINE"
row "$IRON_GEAR" 2 7 8 "$GEAR_FE_HI"
row "$IRON_GEAR" 2 9 9 "$OUTLINE"
row "$IRON_GEAR" 3 3 5 "$OUTLINE"
row "$IRON_GEAR" 3 6 7 "$GEAR_FE_HI"
row "$IRON_GEAR" 3 8 8 "$GEAR_FE"
row "$IRON_GEAR" 3 9 9 "$GEAR_FE_HI"
row "$IRON_GEAR" 3 10 12 "$OUTLINE"
row "$IRON_GEAR" 4 2 2 "$OUTLINE"
row "$IRON_GEAR" 4 3 6 "$GEAR_FE_HI"
row "$IRON_GEAR" 4 7 8 "$GEAR_FE_LO"
row "$IRON_GEAR" 4 9 9 "$GEAR_FE"
row "$IRON_GEAR" 4 10 12 "$GEAR_FE_HI"
row "$IRON_GEAR" 4 13 13 "$OUTLINE"
row "$IRON_GEAR" 5 3 3 "$OUTLINE"
row "$IRON_GEAR" 5 4 4 "$GEAR_FE_HI"
row "$IRON_GEAR" 5 5 6 "$GEAR_FE_LO"
row "$IRON_GEAR" 5 7 8 "$OUTLINE"
row "$IRON_GEAR" 5 9 9 "$GEAR_FE_HI"
row "$IRON_GEAR" 5 10 10 "$GEAR_FE"
row "$IRON_GEAR" 5 11 11 "$GEAR_FE_LO"
row "$IRON_GEAR" 5 12 12 "$OUTLINE"
row "$IRON_GEAR" 6 3 3 "$OUTLINE"
row "$IRON_GEAR" 6 4 4 "$GEAR_FE_HI"
row "$IRON_GEAR" 6 5 5 "$GEAR_FE_LO"
row "$IRON_GEAR" 6 6 6 "$OUTLINE"
row "$IRON_GEAR" 6 9 9 "$OUTLINE"
row "$IRON_GEAR" 6 10 10 "$GEAR_FE_HI"
row "$IRON_GEAR" 6 11 11 "$GEAR_FE_LO"
row "$IRON_GEAR" 6 12 12 "$OUTLINE"
row "$IRON_GEAR" 7 1 2 "$OUTLINE"
row "$IRON_GEAR" 7 3 4 "$GEAR_FE_HI"
row "$IRON_GEAR" 7 5 5 "$OUTLINE"
row "$IRON_GEAR" 7 10 10 "$OUTLINE"
row "$IRON_GEAR" 7 11 12 "$GEAR_FE_HI"
row "$IRON_GEAR" 7 13 14 "$OUTLINE"
row "$IRON_GEAR" 8 1 2 "$OUTLINE"
row "$IRON_GEAR" 8 3 3 "$GEAR_FE_HI"
row "$IRON_GEAR" 8 4 4 "$GEAR_FE_LO"
row "$IRON_GEAR" 8 5 5 "$OUTLINE"
row "$IRON_GEAR" 8 10 10 "$OUTLINE"
row "$IRON_GEAR" 8 11 11 "$GEAR_FE_HI"
row "$IRON_GEAR" 8 12 12 "$GEAR_FE_LO"
row "$IRON_GEAR" 8 13 14 "$OUTLINE"
row "$IRON_GEAR" 9 3 3 "$OUTLINE"
row "$IRON_GEAR" 9 4 5 "$GEAR_FE_HI"
row "$IRON_GEAR" 9 6 6 "$OUTLINE"
row "$IRON_GEAR" 9 9 9 "$OUTLINE"
row "$IRON_GEAR" 9 10 11 "$GEAR_FE_HI"
row "$IRON_GEAR" 9 12 12 "$OUTLINE"
row "$IRON_GEAR" 10 3 3 "$OUTLINE"
row "$IRON_GEAR" 10 4 4 "$GEAR_FE_HI"
row "$IRON_GEAR" 10 5 5 "$GEAR_FE"
row "$IRON_GEAR" 10 6 6 "$GEAR_FE_HI"
row "$IRON_GEAR" 10 7 8 "$OUTLINE"
row "$IRON_GEAR" 10 9 10 "$GEAR_FE_HI"
row "$IRON_GEAR" 10 11 11 "$GEAR_FE_LO"
row "$IRON_GEAR" 10 12 12 "$OUTLINE"
row "$IRON_GEAR" 11 2 2 "$OUTLINE"
row "$IRON_GEAR" 11 3 4 "$GEAR_FE_HI"
row "$IRON_GEAR" 11 5 5 "$GEAR_FE_LO"
row "$IRON_GEAR" 11 6 6 "$GEAR_FE"
row "$IRON_GEAR" 11 7 9 "$GEAR_FE_HI"
row "$IRON_GEAR" 11 10 11 "$GEAR_FE_LO"
row "$IRON_GEAR" 11 12 12 "$GEAR_FE_HI"
row "$IRON_GEAR" 11 13 13 "$OUTLINE"
row "$IRON_GEAR" 12 3 5 "$OUTLINE"
row "$IRON_GEAR" 12 6 6 "$GEAR_FE_HI"
row "$IRON_GEAR" 12 7 7 "$GEAR_FE"
row "$IRON_GEAR" 12 8 9 "$GEAR_FE_LO"
row "$IRON_GEAR" 12 10 12 "$OUTLINE"
row "$IRON_GEAR" 13 6 6 "$OUTLINE"
row "$IRON_GEAR" 13 7 7 "$GEAR_FE_HI"
row "$IRON_GEAR" 13 8 8 "$GEAR_FE_LO"
row "$IRON_GEAR" 13 9 9 "$OUTLINE"
row "$IRON_GEAR" 14 6 9 "$OUTLINE"

# ===============================================================================
# Frame 3 — copper ore
#
# The iron ore's silhouette exactly, in copper. Having no shadow tone of its own
# it shades against the shared outline, then takes its teal-green flecks.
# ===============================================================================
ore_body "$COPPER_ORE" "$ORE_CU" "$ORE_CU_HI"
ore_shade_deep "$COPPER_ORE" "$OUTLINE"
ore_flecks "$COPPER_ORE" "$FLECK"

# ===============================================================================
# Frame 4 — copper plate
#
# The iron plate's silhouette exactly, in copper: the pair is told apart by tone.
# ===============================================================================
plate_body "$COPPER_PLATE" "$CU" "$CU_HI"
plate_shade "$COPPER_PLATE" "$CU_LO"
plate_sheen "$COPPER_PLATE" "$CU_HI"

# ===============================================================================
# Frame 5 — copper cable
#
# The same three copper tones as the plate, so only the shape can separate them:
# a wire wound twice round with an open middle, gaps you can see between the
# turns, and a loose end trailing off at the lower left. A one-pixel strand
# cannot carry an outline the whole way round without swallowing the wire, so the
# shared dark tone hangs off its lower-right instead — the same colour, and the
# same top-left light, as every other icon.
# ===============================================================================
row "$COPPER_CABLE" 2 7 10 "$CU_HI"
row "$COPPER_CABLE" 2 11 11 "$OUTLINE"
row "$COPPER_CABLE" 3 5 6 "$CU_HI"
row "$COPPER_CABLE" 3 7 8 "$CU"
row "$COPPER_CABLE" 3 9 10 "$CU_LO"
row "$COPPER_CABLE" 3 11 12 "$CU_HI"
row "$COPPER_CABLE" 3 13 13 "$OUTLINE"
row "$COPPER_CABLE" 4 3 4 "$CU_HI"
row "$COPPER_CABLE" 4 5 6 "$OUTLINE"
row "$COPPER_CABLE" 4 7 8 "$CU"
row "$COPPER_CABLE" 4 9 10 "$OUTLINE"
row "$COPPER_CABLE" 4 11 11 "$CU_LO"
row "$COPPER_CABLE" 4 12 12 "$CU"
row "$COPPER_CABLE" 4 13 13 "$CU_HI"
row "$COPPER_CABLE" 4 14 14 "$OUTLINE"
row "$COPPER_CABLE" 5 2 2 "$CU_HI"
row "$COPPER_CABLE" 5 3 3 "$CU_LO"
row "$COPPER_CABLE" 5 4 4 "$OUTLINE"
row "$COPPER_CABLE" 5 5 6 "$CU_HI"
row "$COPPER_CABLE" 5 7 8 "$CU_LO"
row "$COPPER_CABLE" 5 9 10 "$CU_HI"
row "$COPPER_CABLE" 5 11 11 "$OUTLINE"
row "$COPPER_CABLE" 5 12 13 "$CU"
row "$COPPER_CABLE" 5 14 14 "$OUTLINE"
row "$COPPER_CABLE" 6 2 2 "$CU"
row "$COPPER_CABLE" 6 3 3 "$OUTLINE"
row "$COPPER_CABLE" 6 4 4 "$CU_HI"
row "$COPPER_CABLE" 6 5 5 "$CU_LO"
row "$COPPER_CABLE" 6 6 9 "$OUTLINE"
row "$COPPER_CABLE" 6 10 10 "$CU"
row "$COPPER_CABLE" 6 11 11 "$OUTLINE"
row "$COPPER_CABLE" 6 12 13 "$CU"
row "$COPPER_CABLE" 6 14 14 "$OUTLINE"
row "$COPPER_CABLE" 7 1 1 "$CU_HI"
row "$COPPER_CABLE" 7 2 2 "$CU"
row "$COPPER_CABLE" 7 3 3 "$OUTLINE"
row "$COPPER_CABLE" 7 4 4 "$CU"
row "$COPPER_CABLE" 7 5 6 "$OUTLINE"
row "$COPPER_CABLE" 7 10 10 "$CU"
row "$COPPER_CABLE" 7 11 11 "$OUTLINE"
row "$COPPER_CABLE" 7 12 12 "$CU"
row "$COPPER_CABLE" 7 13 13 "$CU_LO"
row "$COPPER_CABLE" 7 14 14 "$OUTLINE"
row "$COPPER_CABLE" 8 1 2 "$CU"
row "$COPPER_CABLE" 8 3 3 "$OUTLINE"
row "$COPPER_CABLE" 8 4 4 "$CU"
row "$COPPER_CABLE" 8 5 5 "$OUTLINE"
row "$COPPER_CABLE" 8 9 9 "$CU_HI"
row "$COPPER_CABLE" 8 10 10 "$CU_LO"
row "$COPPER_CABLE" 8 11 11 "$OUTLINE"
row "$COPPER_CABLE" 8 12 12 "$CU"
row "$COPPER_CABLE" 8 13 14 "$OUTLINE"
row "$COPPER_CABLE" 9 1 2 "$CU"
row "$COPPER_CABLE" 9 3 3 "$OUTLINE"
row "$COPPER_CABLE" 9 4 4 "$CU_LO"
row "$COPPER_CABLE" 9 5 8 "$CU_HI"
row "$COPPER_CABLE" 9 9 9 "$CU_LO"
row "$COPPER_CABLE" 9 10 10 "$OUTLINE"
row "$COPPER_CABLE" 9 11 11 "$CU_HI"
row "$COPPER_CABLE" 9 12 12 "$CU_LO"
row "$COPPER_CABLE" 9 13 13 "$OUTLINE"
row "$COPPER_CABLE" 10 1 1 "$CU_LO"
row "$COPPER_CABLE" 10 2 2 "$CU"
row "$COPPER_CABLE" 10 3 3 "$CU_HI"
row "$COPPER_CABLE" 10 4 5 "$OUTLINE"
row "$COPPER_CABLE" 10 6 7 "$CU"
row "$COPPER_CABLE" 10 8 9 "$OUTLINE"
row "$COPPER_CABLE" 10 10 10 "$CU_HI"
row "$COPPER_CABLE" 10 11 11 "$CU_LO"
row "$COPPER_CABLE" 10 12 13 "$OUTLINE"
row "$COPPER_CABLE" 11 1 1 "$OUTLINE"
row "$COPPER_CABLE" 11 2 2 "$CU_LO"
row "$COPPER_CABLE" 11 3 3 "$CU"
row "$COPPER_CABLE" 11 4 5 "$CU_HI"
row "$COPPER_CABLE" 11 6 7 "$CU"
row "$COPPER_CABLE" 11 8 9 "$CU_HI"
row "$COPPER_CABLE" 11 10 12 "$OUTLINE"
row "$COPPER_CABLE" 12 2 2 "$OUTLINE"
row "$COPPER_CABLE" 12 3 7 "$CU_LO"
row "$COPPER_CABLE" 12 8 10 "$OUTLINE"
row "$COPPER_CABLE" 13 3 8 "$OUTLINE"

# ===============================================================================
# Frame 6 — electronic circuit
#
# The plate blank in board green, then two gold traces routed across it with
# square corners, and three red contacts where they land.
# ===============================================================================
plate_body "$CIRCUIT" "$BOARD" "$BOARD_HI"
plate_shade_deep "$CIRCUIT" "$OUTLINE"

dot "$CIRCUIT" 4 5 "$TRACE"
dot "$CIRCUIT" 5 5 "$TRACE"
dot "$CIRCUIT" 6 5 "$TRACE"
dot "$CIRCUIT" 7 5 "$TRACE"
dot "$CIRCUIT" 7 6 "$TRACE"
dot "$CIRCUIT" 7 7 "$TRACE"
dot "$CIRCUIT" 8 7 "$TRACE"
dot "$CIRCUIT" 9 7 "$TRACE"
dot "$CIRCUIT" 10 7 "$TRACE"
dot "$CIRCUIT" 10 8 "$TRACE"
dot "$CIRCUIT" 10 9 "$TRACE"
dot "$CIRCUIT" 10 10 "$TRACE"
dot "$CIRCUIT" 11 10 "$TRACE"
dot "$CIRCUIT" 4 9 "$TRACE"
dot "$CIRCUIT" 4 10 "$TRACE"
dot "$CIRCUIT" 5 10 "$TRACE"
dot "$CIRCUIT" 6 10 "$TRACE"

dot "$CIRCUIT" 11 4 "$CONTACT"
dot "$CIRCUIT" 4 7 "$CONTACT"
dot "$CIRCUIT" 7 11 "$CONTACT"
