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
#
# At 32x32 there is room to build the icons from real primitives — discs for the
# ores, a cut ring with teeth for the gear, looped strands for the cable — rather
# than hand-placing every pixel. The whole set shares one dark outline and one
# top-left light so the seven read as one family.

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
fdisc() { # frame cx cy r color — a filled disc
	draw-sheet fill-circle --frame "$1" --cx "$2" --cy "$3" --r "$4" --color "$5"
}
sdisc() { # frame cx cy r color — a 1px circle outline
	draw-sheet stroke-circle --frame "$1" --cx "$2" --cy "$3" --r "$4" --color "$5"
}
frect() { # frame x y w h color
	draw-sheet fill-rect --frame "$1" --x="$2" --y="$3" --width "$4" --height "$5" --color "$6"
}
dot() { # frame x y color
	draw-sheet set-pixel --frame "$1" --x="$2" --y="$3" --color "$4"
}

# --- The ore cluster (frames 0 and 3) -------------------------------------------
#
# The two ores are one silhouette in two metals: three overlapping nuggets built
# from discs. Each nugget is an outline ring a pixel larger than its fill, so a
# nugget drawn over an earlier one creases it and the pile reads as loose rock
# rather than one smooth blob. Highlights sit up-left and shadows down-right on
# every nugget, matching the shared light. Drawing both frames from this one
# function is what guarantees the pair is separated by colour alone.
#   $1 frame   $2 base   $3 highlight   $4 shadow (or the outline, for copper)
ore_body() {
	# nugget: cx cy r
	set -- "$1" "$2" "$3" "$4" 11 18 7   # left/low nugget
	_nugget "$@"
	set -- "$1" "$2" "$3" "$4" 20 20 6   # right/low nugget
	_nugget "$@"
	set -- "$1" "$2" "$3" "$4" 17 11 7   # upper nugget, drawn last so it sits on top
	_nugget "$@"
}
_nugget() { # frame base hi shadow cx cy r
	fr=$1; base=$2; hi=$3; sh=$4; cx=$5; cy=$6; r=$7
	sdisc "$fr" "$cx" "$cy" "$((r + 1))" "$OUTLINE"
	fdisc "$fr" "$cx" "$cy" "$r" "$base"
	sdisc "$fr" "$cx" "$cy" "$r" "$OUTLINE"
	fdisc "$fr" "$cx" "$cy" "$((r - 1))" "$base"
	# shadow crescent, lower-right
	fdisc "$fr" "$((cx + 2))" "$((cy + 2))" "$((r - 3))" "$sh"
	# body reasserted so the shadow is a crescent, not a full inner disc
	fdisc "$fr" "$((cx - 1))" "$((cy - 1))" "$((r - 3))" "$base"
	# highlight, upper-left
	fdisc "$fr" "$((cx - 2))" "$((cy - 2))" "$((r - 4))" "$hi"
}

# Copper ore only: a few teal-green flecks scattered over the nuggets.
ore_flecks() { # frame
	frect "$1" 9 20 2 2 "$FLECK"
	frect "$1" 18 9 2 2 "$FLECK"
	frect "$1" 22 21 2 2 "$FLECK"
	dot "$1" 14 15 "$FLECK"
}

# --- The flat plate (frames 1 and 4) --------------------------------------------
#
# One stamped rectangle with clipped corners, a bright top and left edge and a
# dark bottom and right one — the "slight 3D edge" of the brief — plus a diagonal
# specular streak up-left toward the light. The two plates differ only in the
# tones passed in.
#   $1 frame   $2 base   $3 highlight   $4 shadow
plate_body() {
	fr=$1; base=$2; hi=$3; sh=$4
	# outline box with the four corners knocked off
	frect "$fr" 5 4 22 24 "$OUTLINE"
	frect "$fr" 4 5 24 22 "$OUTLINE"
	# base fill, inset one pixel from the outline
	frect "$fr" 6 5 20 22 "$base"
	frect "$fr" 5 6 22 20 "$base"
	# top + left highlight edges
	frect "$fr" 6 5 20 1 "$hi"
	frect "$fr" 5 6 1 20 "$hi"
	frect "$fr" 6 6 1 1 "$hi"
	# bottom + right shadow edges
	frect "$fr" 6 26 20 1 "$sh"
	frect "$fr" 26 6 1 20 "$sh"
	# a specular streak across the metal, running up-left
	for i in 0 1 2 3 4 5; do
		dot "$fr" "$((10 + i))" "$((20 - i))" "$hi"
		dot "$fr" "$((11 + i))" "$((20 - i))" "$hi"
	done
}

# ===============================================================================
# Frame 0 — iron ore
# ===============================================================================
ore_body "$IRON_ORE" "$ORE_FE" "$ORE_FE_HI" "$ORE_FE_LO"

# ===============================================================================
# Frame 1 — iron plate
# ===============================================================================
plate_body "$IRON_PLATE" "$PLATE_FE" "$PLATE_FE_HI" "$PLATE_FE_LO"

# ===============================================================================
# Frame 2 — iron gear wheel
#
# A ring with a hole punched clean through it and eight square teeth stepping out
# around the rim. The hole is what separates a gear from a coin, so it is drawn
# big and dark, ringed by the outline. Teeth are laid first, the body disc is
# stamped over their inner ends, then the rim outline and the hub.
# ===============================================================================
CX=16
CY=16
# 1. Eight teeth around the rim (N, S, E, W and the four diagonals), each an
#    outlined block poking past where the rim outline will land.
tooth() { # x y w h
	frect "$IRON_GEAR" "$(($1 - 1))" "$(($2 - 1))" "$(($3 + 2))" "$(($4 + 2))" "$OUTLINE"
	frect "$IRON_GEAR" "$1" "$2" "$3" "$4" "$GEAR_FE"
}
tooth 13 1 6 5    # N
tooth 13 26 6 5   # S
tooth 1 13 5 6    # W
tooth 26 13 5 6   # E
tooth 5 5 5 5     # NW
tooth 22 5 5 5    # NE
tooth 5 22 5 5    # SW
tooth 22 22 5 5   # SE
# 2. The body disc, outlined then filled, stamped over the teeth's inner ends.
fdisc "$IRON_GEAR" "$CX" "$CY" 12 "$OUTLINE"
fdisc "$IRON_GEAR" "$CX" "$CY" 11 "$GEAR_FE"
# 3. Rim shading: a highlight arc up-left, a shadow arc down-right.
sdisc "$IRON_GEAR" "$((CX - 1))" "$((CY - 1))" 10 "$GEAR_FE_HI"
sdisc "$IRON_GEAR" "$((CX + 1))" "$((CY + 1))" 10 "$GEAR_FE_LO"
sdisc "$IRON_GEAR" "$CX" "$CY" 11 "$OUTLINE"
# 4. The hub: a dark hole ringed so it reads as punched through, not painted on.
fdisc "$IRON_GEAR" "$CX" "$CY" 5 "$GEAR_FE_LO"
fdisc "$IRON_GEAR" "$CX" "$CY" 4 "$OUTLINE"
dot "$IRON_GEAR" "$((CX - 2))" "$((CY - 2))" "$GEAR_FE"

# ===============================================================================
# Frame 3 — copper ore
#
# The iron ore's silhouette exactly, in copper. Having no shadow tone of its own
# it shades against the shared outline, then takes its teal-green flecks.
# ===============================================================================
ore_body "$COPPER_ORE" "$ORE_CU" "$ORE_CU_HI" "$OUTLINE"
ore_flecks "$COPPER_ORE"

# ===============================================================================
# Frame 4 — copper plate
#
# The iron plate's silhouette exactly, in copper: the pair is told apart by tone.
# ===============================================================================
plate_body "$COPPER_PLATE" "$CU" "$CU_HI" "$CU_LO"

# ===============================================================================
# Frame 5 — copper cable
#
# The same three copper tones as the plate, so only the shape can separate them:
# two loose loops of wire with open middles you can see through, and a loose end
# trailing off at the lower right. The see-through holes in the loops are what a
# solid plate can never have, which is the whole distinction the brief asks for.
# Each loop is a double-stroked ring (2px of wire) with a highlight on its upper
# left and the shadow tone on its lower right.
# ===============================================================================
loop() { # cx cy r
	cx=$1; cy=$2; r=$3
	sdisc "$COPPER_CABLE" "$cx" "$cy" "$((r + 1))" "$OUTLINE"
	sdisc "$COPPER_CABLE" "$cx" "$cy" "$r" "$CU"
	sdisc "$COPPER_CABLE" "$cx" "$cy" "$((r - 1))" "$CU"
	sdisc "$COPPER_CABLE" "$cx" "$cy" "$((r - 2))" "$OUTLINE"
}
loop 12 12 7
loop 20 19 7
# highlight the upper-left of each loop, shade the lower-right
dot "$COPPER_CABLE" 8 9 "$CU_HI"
dot "$COPPER_CABLE" 9 8 "$CU_HI"
dot "$COPPER_CABLE" 16 16 "$CU_HI"
dot "$COPPER_CABLE" 24 23 "$CU_LO"
dot "$COPPER_CABLE" 16 24 "$CU_LO"
# a loose end trailing off the lower-right loop
frect "$COPPER_CABLE" 24 24 2 4 "$CU"
dot "$COPPER_CABLE" 26 27 "$OUTLINE"
dot "$COPPER_CABLE" 24 24 "$CU_HI"

# ===============================================================================
# Frame 6 — electronic circuit
#
# A green board (a rounded rectangle) with two gold traces routed across it with
# square corners, and three red contact pads where they land.
# ===============================================================================
# board blank
frect "$CIRCUIT" 5 4 22 24 "$OUTLINE"
frect "$CIRCUIT" 4 5 24 22 "$OUTLINE"
frect "$CIRCUIT" 6 5 20 22 "$BOARD"
frect "$CIRCUIT" 5 6 22 20 "$BOARD"
# top + left highlight bevel
frect "$CIRCUIT" 6 5 20 1 "$BOARD_HI"
frect "$CIRCUIT" 5 6 1 20 "$BOARD_HI"
# gold traces (an L and a T), 1px lines
draw-sheet line --frame "$CIRCUIT" --x0 9 --y0 9 --x1 9 --y1 20 --color "$TRACE"
draw-sheet line --frame "$CIRCUIT" --x0 9 --y0 20 --x1 20 --y1 20 --color "$TRACE"
draw-sheet line --frame "$CIRCUIT" --x0 22 --y0 8 --x1 22 --y1 22 --color "$TRACE"
draw-sheet line --frame "$CIRCUIT" --x0 13 --y0 13 --x1 22 --y1 13 --color "$TRACE"
# three red contact pads
frect "$CIRCUIT" 8 8 3 3 "$CONTACT"
frect "$CIRCUIT" 19 19 3 3 "$CONTACT"
frect "$CIRCUIT" 21 7 3 3 "$CONTACT"
