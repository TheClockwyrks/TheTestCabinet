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

# ===============================================================================
# The machine items (frames 7-15)
#
# Nine placeable-machine inventory icons: three machine TYPES (belt, assembler,
# inserter), each in three TIERS. A type is read from its silhouette; a tier is
# read from its accent colour and how much detail it carries. The three tiers of a
# type share one silhouette and construction — only the accent pair and a little
# added detail change — so each machine is drawn once, parameterised by tier, and
# the tier's accent + detail level are the only per-tier inputs. Every machine sits
# on the shared steel-chassis tones (the same neutral blue-grey range as the iron
# items) so the nine read as one family with the base seven, and each accent is a
# colour already in the base set (amber = the circuit's gold, red = its contact
# dots, cyan = the copper ore's teal flecks).
# ===============================================================================

# --- The machine table ----------------------------------------------------------
BELT_T1=7
BELT_T2=8
BELT_T3=9
ASM_T1=10
ASM_T2=11
ASM_T3=12
INS_T1=13
INS_T2=14
INS_T3=15

# --- Machine palette (the brief's machine tables, and nothing else) -------------
# One shared chassis for all nine, plus the belt's dark running band. Each icon
# also takes exactly one tier accent pair, passed in.
CHASSIS='#5a6472'
CHASSIS_HI='#828c9b'
CHASSIS_LO='#3a404b'
BAND='#2c3038'

T1_A='#e0a92e'   # tier 1 amber
T1_AH='#f6cf6b'
T2_A='#d6473a'   # tier 2 red
T2_AH='#f0715c'
T3_A='#3a9ed6'   # tier 3 cyan
T3_AH='#78cff0'

line() { # frame x0 y0 x1 y1 color
	draw-sheet line --frame "$1" --x0 "$2" --y0 "$3" --x1 "$4" --y1 "$5" --color "$6"
}

# --- The belt segment (frames 7-9) ----------------------------------------------
#
# Wider than it is tall: a dark running band between two grey side rails, with
# forward-pointing (rightward) chevrons marching along the band. Tier is the number
# of chevrons plus a small rail detail: T1 one chevron, plain rails; T2 two chevrons
# + a bolt stud on each rail; T3 three chevrons + ribbed rails.
#   $1 frame   $2 accent   $3 accent-hi   $4 tier
belt_chev() { # frame cx accent accent-hi — one rightward chevron on the band
	f=$1; cx=$2; a=$3; ah=$4
	line "$f" "$cx" 13 "$((cx + 3))" 15 "$a"
	line "$f" "$((cx + 3))" 15 "$cx" 17 "$a"
	line "$f" "$cx" 14 "$((cx + 3))" 16 "$a"
	line "$f" "$((cx + 3))" 16 "$cx" 18 "$a"
	dot "$f" "$((cx + 3))" 15 "$ah"   # lit tip
}
belt_body() {
	f=$1; a=$2; ah=$3; tier=$4
	# outline box, then the chassis rails inside it
	frect "$f" 2 8 28 16 "$OUTLINE"
	frect "$f" 3 9 26 14 "$CHASSIS"
	frect "$f" 3 9 26 1 "$CHASSIS_HI"    # top rail highlight
	frect "$f" 3 22 26 1 "$CHASSIS_LO"   # bottom rail shadow
	# the dark running band between the two rails
	frect "$f" 3 12 26 1 "$OUTLINE"
	frect "$f" 3 13 26 6 "$BAND"
	frect "$f" 3 19 26 1 "$OUTLINE"
	# chevrons: one per tier, marching to the right
	case $tier in
	1) belt_chev "$f" 13 "$a" "$ah" ;;
	2) belt_chev "$f" 8 "$a" "$ah"; belt_chev "$f" 17 "$a" "$ah" ;;
	3) belt_chev "$f" 5 "$a" "$ah"; belt_chev "$f" 14 "$a" "$ah"; belt_chev "$f" 23 "$a" "$ah" ;;
	esac
	# tier 2+: a bolt stud on each rail
	if [ "$tier" -ge 2 ]; then
		frect "$f" 6 10 2 1 "$ah"; frect "$f" 23 10 2 1 "$ah"
		frect "$f" 6 21 2 1 "$ah"; frect "$f" 23 21 2 1 "$ah"
	fi
	# tier 3: ribbed rails
	if [ "$tier" -ge 3 ]; then
		for x in 5 9 13 17 21 25; do dot "$f" "$x" 9 "$OUTLINE"; dot "$f" "$x" 22 "$OUTLINE"; done
	fi
}

# --- The assembler (frames 10-12) -----------------------------------------------
#
# A roughly square boxy machine: a rounded casing with two feet, and a domed panel
# on top carrying a cog motif (the accent). Tier is the cog count plus a vent: T1
# one cog, plain casing; T2 two interlocking cogs + a vent grille; T3 three cogs +
# corner pipes.
#   $1 frame   $2 accent   $3 accent-hi   $4 tier
cog() { # frame cx cy r accent accent-hi — a small gear in the accent tone
	f=$1; cx=$2; cy=$3; r=$4; a=$5; ah=$6
	dot "$f" "$cx" "$((cy - r - 1))" "$a"; dot "$f" "$cx" "$((cy + r + 1))" "$a"   # N/S teeth
	dot "$f" "$((cx - r - 1))" "$cy" "$a"; dot "$f" "$((cx + r + 1))" "$cy" "$a"   # W/E teeth
	fdisc "$f" "$cx" "$cy" "$r" "$OUTLINE"
	fdisc "$f" "$cx" "$cy" "$((r - 1))" "$a"
	dot "$f" "$((cx - 1))" "$((cy - 1))" "$ah"   # lit upper-left
	dot "$f" "$cx" "$cy" "$OUTLINE"              # hub hole
}
asm_body() {
	f=$1; a=$2; ah=$3; tier=$4
	# main casing
	frect "$f" 6 10 21 18 "$OUTLINE"
	frect "$f" 7 11 19 16 "$CHASSIS"
	frect "$f" 7 11 19 1 "$CHASSIS_HI"    # top + left light
	frect "$f" 7 11 1 16 "$CHASSIS_HI"
	frect "$f" 7 26 19 1 "$CHASSIS_LO"    # bottom + right shade
	frect "$f" 25 11 1 16 "$CHASSIS_LO"
	# two feet
	frect "$f" 6 27 4 2 "$OUTLINE"; frect "$f" 6 27 3 1 "$CHASSIS"
	frect "$f" 22 27 4 2 "$OUTLINE"; frect "$f" 23 27 3 1 "$CHASSIS"
	# domed panel on top
	fdisc "$f" 16 9 6 "$OUTLINE"
	fdisc "$f" 16 9 5 "$CHASSIS"
	dot "$f" 13 6 "$CHASSIS_HI"
	# the cog motif on the dome — the accent, one cog per tier
	case $tier in
	1) cog "$f" 16 9 3 "$a" "$ah" ;;
	2) cog "$f" 13 9 2 "$a" "$ah"; cog "$f" 19 8 2 "$a" "$ah" ;;
	3) cog "$f" 13 10 2 "$a" "$ah"; cog "$f" 19 10 2 "$a" "$ah"; cog "$f" 16 6 2 "$a" "$ah" ;;
	esac
	# tier 2+: a vent grille on the casing
	if [ "$tier" -ge 2 ]; then
		frect "$f" 10 21 12 3 "$OUTLINE"
		frect "$f" 11 22 3 1 "$a"; frect "$f" 15 22 3 1 "$a"; frect "$f" 19 22 2 1 "$a"
	fi
	# tier 3: accent corner pipes rising from the casing top
	if [ "$tier" -ge 3 ]; then
		frect "$f" 7 8 2 4 "$a"; dot "$f" 7 8 "$ah"
		frect "$f" 24 8 2 4 "$a"; dot "$f" 24 8 "$ah"
	fi
}

# --- The inserter (frames 13-15) ------------------------------------------------
#
# Taller than it is wide: a base plate with a round accent joint, an upright arm
# rising from it, ending in a claw (the accent) reaching up. Tier changes the arm's
# articulation and the claw: T1 a straight arm + two-prong claw; T2 an elbowed arm +
# a reinforced two-prong claw; T3 a taller multi-segment arm + a wide three-prong
# claw and a counterweight.
#   $1 frame   $2 accent   $3 accent-hi   $4 tier
ins_body() {
	f=$1; a=$2; ah=$3; tier=$4
	# base plate
	frect "$f" 5 25 22 5 "$OUTLINE"
	frect "$f" 6 26 20 3 "$CHASSIS"
	frect "$f" 6 26 20 1 "$CHASSIS_HI"
	frect "$f" 6 28 20 1 "$CHASSIS_LO"
	case $tier in
	1)
		# straight arm, two-prong claw opening upward
		frect "$f" 14 7 4 18 "$OUTLINE"
		frect "$f" 15 7 2 17 "$CHASSIS"
		frect "$f" 15 7 1 17 "$CHASSIS_HI"
		frect "$f" 12 6 8 2 "$a"        # claw crossbar
		frect "$f" 12 3 2 4 "$a"; frect "$f" 18 3 2 4 "$a"   # two prongs
		dot "$f" 12 3 "$ah"; dot "$f" 18 3 "$ah"
		;;
	2)
		# elbowed arm: up, then over to the right; reinforced claw at the elbow's end
		frect "$f" 14 12 4 13 "$OUTLINE"
		frect "$f" 15 13 2 11 "$CHASSIS"
		frect "$f" 13 7 13 6 "$OUTLINE"
		frect "$f" 14 8 11 4 "$CHASSIS"
		frect "$f" 14 8 11 1 "$CHASSIS_HI"
		frect "$f" 20 6 7 2 "$a"        # reinforced claw crossbar
		frect "$f" 20 3 2 3 "$a"; frect "$f" 25 3 2 3 "$a"   # two thick prongs, open gap
		dot "$f" 20 3 "$ah"; dot "$f" 25 3 "$ah"
		;;
	3)
		# taller multi-segment arm with an accent joint band, wide three-prong claw,
		# and a counterweight balancing the base
		frect "$f" 14 15 4 10 "$OUTLINE"
		frect "$f" 15 16 2 9 "$CHASSIS"
		frect "$f" 12 12 8 3 "$OUTLINE"      # mid joint
		frect "$f" 13 13 6 1 "$a"
		frect "$f" 14 3 4 10 "$OUTLINE"
		frect "$f" 15 4 2 9 "$CHASSIS"
		frect "$f" 15 4 1 9 "$CHASSIS_HI"
		frect "$f" 10 3 12 2 "$a"            # wide claw crossbar
		frect "$f" 10 1 2 3 "$a"; frect "$f" 15 1 2 3 "$a"; frect "$f" 20 1 2 3 "$a"  # three prongs
		dot "$f" 10 1 "$ah"; dot "$f" 15 1 "$ah"; dot "$f" 20 1 "$ah"
		frect "$f" 20 18 7 7 "$OUTLINE"      # counterweight
		frect "$f" 21 19 5 5 "$CHASSIS"
		frect "$f" 21 19 5 1 "$CHASSIS_HI"
		frect "$f" 22 21 3 1 "$a"            # accent band on the weight
		;;
	esac
	# round accent joint at the base of the arm, drawn last so it sits on top
	fdisc "$f" 16 24 3 "$OUTLINE"
	fdisc "$f" 16 24 2 "$a"
	dot "$f" 15 23 "$ah"
}

# ===============================================================================
# Frames 7-9 — belt tiers 1/2/3
# ===============================================================================
belt_body "$BELT_T1" "$T1_A" "$T1_AH" 1
belt_body "$BELT_T2" "$T2_A" "$T2_AH" 2
belt_body "$BELT_T3" "$T3_A" "$T3_AH" 3

# ===============================================================================
# Frames 10-12 — assembler tiers 1/2/3
# ===============================================================================
asm_body "$ASM_T1" "$T1_A" "$T1_AH" 1
asm_body "$ASM_T2" "$T2_A" "$T2_AH" 2
asm_body "$ASM_T3" "$T3_A" "$T3_AH" 3

# ===============================================================================
# Frames 13-15 — inserter tiers 1/2/3
# ===============================================================================
ins_body "$INS_T1" "$T1_A" "$T1_AH" 1
ins_body "$INS_T2" "$T2_A" "$T2_AH" 2
ins_body "$INS_T3" "$T3_A" "$T3_AH" 3
