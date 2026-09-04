#!/bin/sh
# Reference implementation — Lattice Transport Belt (variant `base`).
#
# Draws the sixteen-frame sheet with `draw-sheet`, one operation at a time,
# exactly as a model would: frames 0-7 are the straight belt flowing East, and
# frames 8-15 are the 90-degree curve that takes it from a West entry round to a
# South exit. Run from a seeded asset workspace (see `tcab publish-reference`):
# `draw.config.json`, the empty per-frame action logs, and the blank previews are
# already in place, so this script only draws.
#
# The two forms are ONE belt in two shapes, and this script is written to make
# that literal rather than merely claimed. The palette, the cross-section, the
# tread-blade profile, the chevron profile, the pitches, and the per-frame scroll
# step are declared ONCE below and consumed by both halves; the halves differ
# only in how a belt coordinate is placed on the tile. Change a number up here
# and the straight belt and the curve change together — which is exactly the
# property this case is testing.

set -eu

# --- Belt coordinates ----------------------------------------------------------
#
# Both forms are described in the same two coordinates, so one description draws
# either:
#
#   u  ALONG the direction of travel, in pixels. On the straight belt this is
#      simply the column. On the curve it is arc length measured at the belt's
#      centre line, so one pixel of travel is one pixel of travel on both.
#   t  ACROSS the belt, in pixels, counted from the belt's OUTER edge inward.
#      On the straight belt (flowing East) the outer edge is the top, so t is
#      the row. On the curve the outer edge is the convex arc, so t is measured
#      inward from it and the radius at t is `OUTER_T - t`.
#
# The cross-section below is therefore shared verbatim: wherever the straight
# belt has rail, outline, or surface at some t, so does the curve. That is what
# makes a straight tile butt against a curve tile with no seam.

RAIL_T=2      # rail band, at each edge
OUTLINE_T=2   # dark outline separating a rail from the surface
SURF_IN=4     # first surface row/ring (just inside the outer outline)
SURF_OUT=27   # last surface row/ring (just outside the inner outline)
# The far edge of the belt, which is also the far edge of the tile: the belt
# fills its tile exactly, so a belt and the machines it connects to line up
# flush. Everything about the tile's extent is derived from this one number.
OUTER_T=$((SURF_OUT + OUTLINE_T + RAIL_T))
TILE=$((OUTER_T + 1))

# --- The moving surface, in belt coordinates -----------------------------------
#
# The chevron pitch is the repeat the whole surface pattern is measured in, and
# the blade pitch divides it exactly (two blades per chevron). Because they share
# that factor the two patterns advance locked together and come back into
# register at the wrap, which is what keeps each loop seamless.
SEQ_FRAMES=8      # frames per sequence — the two declared `[[sheet.sequence]]`s
CURVE_FRAME=8     # frames 0..7 are the straight belt; 8..15 are the curve
CHEVRON_PITCH=16
BLADE_PITCH=8
# One-eighth of the chevron pitch per frame: every frame lands on a distinct
# offset, and after the eighth the pattern has advanced exactly one full pitch. A
# larger step (half a pitch, say) would collapse a sequence into two alternating
# images — the failure the brief calls out. BOTH sequences use this same step on
# the same pitches, which is what lets a straight tile and a curve tile animate
# in phase with each other.
STEP=$((CHEVRON_PITCH / SEQ_FRAMES))

# The tread blade's profile, across the direction of travel: a raised face in the
# metal mid tone with the dark outline down its LEADING edge, spanning the whole
# surface band. Both forms use these two numbers, so a cleat reads the same
# weight on a straight tile and on a curve.
BLADE_FACE=3
BLADE_EDGE=1

# How far a chevron's arms trail back upstream from its tip.
CHEVRON_LEN=4

# --- Palette (the brief's table, and nothing else) -----------------------------
#
# The shared metal body is identical in every tier: the same dark outline, the
# same metal base and mid, the same rail. ONLY the movers — the chevrons — carry
# the tier's accent, and the tier-3 energy glow is the one tone that appears in a
# single tier. `set_tier` below swaps the mover trio (and nothing else) so a
# higher tier is unmistakably the same belt, only its accent recoloured.
OUTLINE='#1b1d21'
BASE='#34383d'
MID='#4a4f55'
RAIL='#6b7178'
GLOW='#bfeeff' # tier-3 energy glow only

# Select the mover trio (chevron / highlight / shadow) for the tier being drawn.
# The metal tones above never change; that is what keeps the three tiers one
# family. Amber, then red-orange, then blue-cyan — a glance at the accent alone
# tells the tiers apart.
set_tier() {
	case $1 in
	1) MOVER='#e6b329' MOVER_HI='#f6d96b' MOVER_LO='#b88410' ;;
	2) MOVER='#e6602a' MOVER_HI='#f59a5a' MOVER_LO='#b8400f' ;;
	3) MOVER='#2ab0e6' MOVER_HI='#7fd8f6' MOVER_LO='#1069b8' ;;
	esac
	# Rebuild the chevron stroke table from this tier's mover trio (see below).
	CHEVRON_STROKES="10 14 $MOVER_HI 11 15 $MOVER 20 16 $MOVER 21 17 $MOVER_LO"
}

# The chevron, as four strokes in belt coordinates: `t_back t_tip tone`. Each
# stroke runs from an arm's back end — CHEVRON_LEN upstream, at across-position
# `t_back` — in to the tip at `t_tip`. The two arms open back upstream from a
# leading tip; the highlight rides the OUTER edge and the shadow the inner one,
# so the arrowhead reads with a little depth. Straddling t = 15.5, it sits on the
# centre line of the SURF_IN..SURF_OUT band.
#
# This one table is the whole chevron, and `set_tier` rebuilds it from the current
# tier's mover trio — the GEOMETRY (the four `t_back t_tip` pairs) is identical in
# every tier, only the tones change. Both halves iterate it, so the curve cannot
# drift into a different arrowhead than the straight belt's, and a tier cannot
# drift into a different chevron shape than tier 1's. It is set by `set_tier`
# before either half runs; the placeholder here keeps `set -u` happy if read early.
CHEVRON_STROKES=""

# ==============================================================================
# The straight belt — frames 0..7
# ==============================================================================
#
# Placement is the identity: u is the column, t is the row.

# Draw one tread blade (cleat) with its trailing edge at column $2 of frame $1,
# spanning the full surface height between the rails. Columns off-canvas are
# clipped by the binary, which is how the wrapped copies below cost nothing.
#
# Note the `--x=…` form on every column: a wrapped copy's column is negative, and
# `--x -32` would be read as a flag rather than a value.
blade_straight() {
	draw-sheet fill-rect --frame "$1" --x="$2" --y "$SURF_IN" \
		--width "$BLADE_FACE" --height "$((SURF_OUT - SURF_IN + 1))" --color "$MID"
	draw-sheet fill-rect --frame "$1" --x="$(($2 + BLADE_FACE))" --y "$SURF_IN" \
		--width "$BLADE_EDGE" --height "$((SURF_OUT - SURF_IN + 1))" --color "$OUTLINE"
}

# Draw one East-pointing chevron with its tip at column $2 of frame $1, from the
# shared stroke table: on a straight belt a stroke is just a line from
# (tip - CHEVRON_LEN, t_back) to (tip, t_tip).
chevron_straight() {
	chev_frame=$1
	chev_tip=$2
	chev_back=$((chev_tip - CHEVRON_LEN))
	# Deliberately unquoted: the table is split into one word per field.
	# shellcheck disable=SC2086
	set -- $CHEVRON_STROKES
	while [ "$#" -ge 3 ]; do
		draw-sheet line --frame "$chev_frame" --x0="$chev_back" --y0="$1" \
			--x1="$chev_tip" --y1="$2" --color "$3"
		shift 3
	done
}

# The rails and their outlines, in the shared cross-section: a lighter band along
# each edge, separated from the belt by the dark outline. These are the only
# pixels that do not move frame to frame. The outline is laid a row at a time —
# one recorded operation per row, the way it would be drawn by hand — rather than
# as one band per edge.
rails_straight() {
	draw-sheet fill-rect --frame "$1" --x 0 --y 0 \
		--width "$TILE" --height "$RAIL_T" --color "$RAIL"
	row=0
	while [ "$row" -lt "$OUTLINE_T" ]; do
		draw-sheet fill-rect --frame "$1" --x 0 --y "$((RAIL_T + row))" \
			--width "$TILE" --height 1 --color "$OUTLINE"
		row=$((row + 1))
	done
	row=0
	while [ "$row" -lt "$OUTLINE_T" ]; do
		draw-sheet fill-rect --frame "$1" --x 0 --y "$((SURF_OUT + 1 + row))" \
			--width "$TILE" --height 1 --color "$OUTLINE"
		row=$((row + 1))
	done
	draw-sheet fill-rect --frame "$1" --x 0 --y "$((SURF_OUT + 1 + OUTLINE_T))" \
		--width "$TILE" --height "$RAIL_T" --color "$RAIL"
}

# --- Higher-tier reinforcement, straight belt ----------------------------------
#
# Tiers 2 and 3 are the SAME belt with more mechanical detail worked onto it — the
# body, the cross-section, and the pitches are untouched, so the extra marks obey
# every rule the base belt does: they stay inside the rail band, they tile
# horizontally, and any mark on the surface scrolls with the offset.

# A line of bolt studs worked into each rail: a dark tick across the rail band at
# a fixed pitch, structural so it holds still frame to frame. Tier 2 studs the
# rail at the blade pitch; tier 3 doubles the density. The pitch divides the tile
# evenly, so the studs tile edge-to-edge like everything else.
rail_studs_straight() {
	sf=$1
	spitch=$BLADE_PITCH
	[ "$2" -ge 3 ] && spitch=$((BLADE_PITCH / 2))
	c=0
	while [ "$c" -lt "$TILE" ]; do
		draw-sheet fill-rect --frame "$sf" --x "$c" --y 0 \
			--width 1 --height "$RAIL_T" --color "$OUTLINE"
		draw-sheet fill-rect --frame "$sf" --x "$c" --y "$((TILE - RAIL_T))" \
			--width 1 --height "$RAIL_T" --color "$OUTLINE"
		c=$((c + spitch))
	done
}

# A finer secondary tread mark on each blade, on the SAME blade pitch: a light
# catch-light down the leading face (tier 2), plus a fine shadow groove across the
# face (tier 3), so the tread reads denser and more refined without changing its
# pitch or the belt's cross-section. It sits on the surface, so it scrolls by the
# same offset as the blades and stays locked to them.
tread_detail_straight() {
	tf=$1
	tt=$2
	toff=$3
	surfh=$((SURF_OUT - SURF_IN + 1))
	base=$((-TILE))
	while [ "$base" -le "$TILE" ]; do
		draw-sheet fill-rect --frame "$tf" --x="$((base + toff))" --y "$SURF_IN" \
			--width 1 --height "$surfh" --color "$RAIL"
		if [ "$tt" -ge 3 ]; then
			draw-sheet fill-rect --frame "$tf" --x="$((base + toff + 2))" \
				--y "$SURF_IN" --width 1 --height "$surfh" --color "$BASE"
		fi
		base=$((base + BLADE_PITCH))
	done
}

# Tier 3 only: a subtle energy glow along the chevron row — a thin bloom of pale
# cyan leading each chevron tip down the centre line. Kept to two pixels a chevron
# so it stays a bloom, not a stripe. It scrolls with the chevrons it leads.
glow_straight() {
	gf=$1
	goff=$2
	base=$((-TILE))
	while [ "$base" -le "$TILE" ]; do
		draw-sheet set-pixel --frame "$gf" --x="$((base + goff + 1))" --y 15 --color "$GLOW"
		draw-sheet set-pixel --frame "$gf" --x="$((base + goff + 1))" --y 16 --color "$GLOW"
		base=$((base + CHEVRON_PITCH))
	done
}

# $2 is the frame's position 0..7 within its tier's loop, $3 the tier. The mover
# trio is already selected by `set_tier`; the loop position (not the absolute
# frame) drives the scroll, so every tier's loop is in phase with tier 1's.
straight_frame() {
	frame=$1
	loop=$2
	tier=$3
	# How far the whole surface pattern has advanced east in this frame.
	offset=$((loop * STEP))

	# 1. The belt body: the metal base across the whole tile. The mid tone that
	#    keeps this from reading as a flat fill arrives with the blades below,
	#    which is also where the brief puts it.
	draw-sheet fill-rect --frame "$frame" --x 0 --y 0 \
		--width "$TILE" --height "$TILE" --color "$BASE"

	# 2. The tread blades, at the blade pitch, shifted east by this frame's
	#    offset. Copies are drawn a full tile to either side so a blade leaving
	#    the right edge re-enters from the left: that is what makes the tile
	#    scroll without gaps and tile horizontally edge-to-edge.
	base=$((-TILE))
	while [ "$base" -le "$TILE" ]; do
		blade_straight "$frame" "$((base + offset))"
		base=$((base + BLADE_PITCH))
	done

	# 2b. Higher tiers: the finer secondary tread, on the same pitch and scroll.
	[ "$tier" -ge 2 ] && tread_detail_straight "$frame" "$tier" "$offset"

	# 3. The rails, drawn after the surface so they stay crisp.
	rails_straight "$frame"

	# 3b. Higher tiers: the bolt-stud reinforcement worked into each rail.
	[ "$tier" -ge 2 ] && rail_studs_straight "$frame" "$tier"

	# 4. The chevrons, painted last so they sit on top of the tread blades they
	#    share a surface with — one central row at the chevron pitch, wrapped the
	#    same way as the blades, advancing by the same offset so the whole
	#    surface moves as one locked pattern.
	base=$((-TILE))
	while [ "$base" -le "$TILE" ]; do
		chevron_straight "$frame" "$((base + offset))"
		base=$((base + CHEVRON_PITCH))
	done

	# 4b. Tier 3 only: the energy glow leading the chevrons.
	[ "$tier" -ge 3 ] && glow_straight "$frame" "$offset"
	return 0 # a false trailing `&&` must not fail the function under `set -e`
}

# ==============================================================================
# The curve — frames 8..15
# ==============================================================================
#
# Placement is polar about the tile's South-West corner, which is the inside of
# the turn: a belt coordinate (u, t) lands at radius `OUTER_T - t` and at the
# angle u pixels of arc along the belt's centre line. At the West mouth that
# mapping is the identity — angle 0 puts the radial direction straight up and the
# travel direction due East — so the mouth reproduces the straight belt's
# cross-section and its blade EXACTLY, pixel for pixel. At the South mouth the
# same is true a quarter turn on.

CX=0            # centre of the turn: the tile's South-West corner
CY=$OUTER_T

# Sub-pixel resolution. A blade only comes out solid if the parallel lines it is
# swept from overlap, and on a curve lines a whole pixel apart run at an angle to
# the pixel grid and leave a dotted gap between them; a sixth of a pixel is fine
# enough that they never can.
SUB=6
DEN=$((1000 * SUB))

# --- Polar arithmetic ----------------------------------------------------------
#
# Sine and cosine of the angle for each whole pixel of arc, scaled by 1000, for
# u = -24 through 48. The angle for u is `u / 15.5` radians: 15.5 is the belt's
# centre line, the midpoint of the SURF_IN..SURF_OUT band, so arc length is
# measured exactly where the chevrons ride. Measuring u there is what makes a
# pitch of 8 px on the curve the SAME 8 px as on the straight belt, and so what
# lets the two share a scroll phase. The quarter turn is 24.35 px of centre-line
# arc; the table runs a chevron pitch past each end so pattern pieces part-way
# through entering or leaving the tile are drawn too. Anything outside the turn
# maps off the canvas and is clipped by the binary: upstream of the West mouth
# the column is negative, downstream of the South mouth the row is past the
# bottom edge.
TRIG='
	-1000 22  -996 87  -989 151  -977 214  -961 277  -941 338
	-917 398  -890 456  -858 513  -824 567  -785 619  -744 668
	-699 715  -652 759  -601 799  -549 836  -494 870  -436 900
	-378 926  -317 948  -255 967  -192 981  -129 992  -64 998
	0 1000  64 998  129 992  192 981  255 967  317 948
	378 926  436 900  494 870  549 836  601 799  652 759
	699 715  744 668  785 619  824 567  858 513  890 456
	917 398  941 338  961 277  977 214  989 151  996 87
	1000 22  999 -42  994 -106  985 -170  972 -233  955 -296
	934 -357  909 -416  881 -474  848 -530  812 -583  773 -634
	730 -683  685 -729  637 -771  585 -811  532 -847  476 -879
	419 -908  359 -933  298 -954  236 -972  173 -985  109 -994
	45 -999
'
TRIG_FIRST=-24

# Look up the angle a whole pixel of arc $1 along, leaving sin in S and cos in C
# (both scaled by 1000). A shell function has its own positional parameters, so
# the `set --` here cannot disturb a caller iterating the chevron table.
trig() {
	pair=$(((($1) - TRIG_FIRST) * 2))
	# Deliberately unquoted: the table is split into one word per number.
	# shellcheck disable=SC2086
	set -- $TRIG
	shift "$pair"
	S=$1
	C=$2
}

# Round $1 (a value scaled by DEN) to the nearest whole pixel, leaving it in R.
# Written out longhand because shell division truncates toward zero, and half the
# coordinates here are negative — a pattern piece part-way off the West mouth.
rnd() {
	n=$(($1 + DEN / 2))
	if [ "$n" -ge 0 ]; then
		R=$((n / DEN))
	else
		R=$((-((-n + DEN - 1) / DEN)))
	fi
}

# The point a whole pixel of arc $1 along the curve, at radius $2 (in sub-pixels)
# from the corner, displaced $3 sub-pixels along the direction of travel, as
# PX, PY. Radius runs outward along (sin, -cos); travel runs along (cos, sin),
# which is East at the West mouth and South at the South mouth — the turn, in
# two lines.
polar() {
	trig "$1"
	rnd $(($2 * S + $3 * C))
	PX=$((CX + R))
	rnd $(($3 * S - $2 * C))
	PY=$((CY + R))
}

# The blade spans the same SURF_IN..SURF_OUT band as on the straight belt, pulled
# a third of a pixel inside each end so that rounding around the arc can never
# spill a cleat into the outline band it butts against. At the mouths that third
# of a pixel rounds away, so the blade lands on exactly the straight belt's rows.
# R_BLADE_MID is the belt's centre line, where the cleat is exactly the straight
# belt's width and where the taper below begins.
R_BLADE_OUT=$(((OUTER_T - SURF_IN) * SUB - 2))
R_BLADE_IN=$(((OUTER_T - SURF_OUT) * SUB + 2))
R_BLADE_MID=$(((2 * OUTER_T - SURF_IN - SURF_OUT) * SUB / 2))

# One ray of a tread blade, in frame $1 a whole pixel of arc $2 along, displaced
# $3 sub-pixels along travel, in colour $4, drawn as two joined segments.
#
# Cleats on a curve are spokes, so the gap between neighbours shrinks in
# proportion to the radius: at the belt's centre line consecutive cleats sit a
# full blade pitch apart, but down at the pivot they are only a quarter of that,
# and a cleat of fixed width would swallow the gap entirely and turn the inside of
# the bend into a solid field of metal. So the cleat is a WEDGE, exactly as a real
# curved conveyor's slats are: full width from the rim in to the centre line, then
# tapering in proportion to the radius the rest of the way. Because width and gap
# then shrink together, the cleat takes the same HALF of every pitch at every
# radius that it does on the straight belt, and the tread stays countable all the
# way to the pivot.
#
#   outer segment  rim -> centre line, at a constant displacement (a parallel
#                  offset), so cleats here are the straight belt's own bars
#   inner segment  centre line -> pivot, with the displacement scaled by the
#                  radius. Scaling the offset in proportion to the radius is the
#                  same thing as a fixed change of ANGLE, so this segment is a
#                  true ray from the corner and the two segments meet flush.
#
# The trailing edge (displacement 0) is unscaled at both ends, so it stays the
# pure radial line — which is what keeps the mouth column identical to the
# straight belt's whatever the taper does to the rest of the cleat.
#
# Note the `--x0=…` form on every coordinate: a blade part-way off the West mouth
# has negative columns, and `--x0 -6` would be read as a flag rather than a value.
# $5 is how far in the ray reaches. The raised face runs the whole width of the
# belt; the dark leading edge stops at the centre line, because below that the
# taper would take it under a pixel and a sub-pixel edge drawn last over every
# converging cleat is exactly what turns the pivot into a dark smear. Inside the
# centre line a cleat is a plain raised tick on the base tone, which stays
# countable all the way in.
spoke() {
	polar "$2" "$R_BLADE_OUT" "$3"
	spoke_x=$PX
	spoke_y=$PY
	polar "$2" "$R_BLADE_MID" "$3"
	draw-sheet line --frame "$1" --x0="$spoke_x" --y0="$spoke_y" \
		--x1="$PX" --y1="$PY" --color "$4"
	if [ "$5" -ge "$R_BLADE_MID" ]; then
		return 0
	fi
	spoke_x=$PX
	spoke_y=$PY
	polar "$2" "$5" "$((($3 * $5 + R_BLADE_MID / 2) / R_BLADE_MID))"
	draw-sheet line --frame "$1" --x0="$spoke_x" --y0="$spoke_y" \
		--x1="$PX" --y1="$PY" --color "$4"
}

# Draw one tread blade (cleat) across the belt a whole pixel of arc $2 along, in
# frame $1: the same BLADE_FACE-wide raised face and BLADE_EDGE-wide leading
# outline as the straight belt's, here aimed at the South-West corner so it stays
# perpendicular to travel all the way round the bend. Each band is swept a
# sub-pixel at a time so it comes out solid, and the half-pixel margin puts the
# rounded result on exactly the columns the straight belt's rects cover.
blade_curved() {
	d=0
	while [ "$d" -lt "$((BLADE_FACE * SUB - SUB / 2))" ]; do
		spoke "$1" "$2" "$d" "$MID" "$R_BLADE_IN"
		d=$((d + 1))
	done
	while [ "$d" -lt "$(((BLADE_FACE + BLADE_EDGE) * SUB - SUB / 2))" ]; do
		spoke "$1" "$2" "$d" "$OUTLINE" "$R_BLADE_MID"
		d=$((d + 1))
	done
	# $3 is the tier: tiers 2 and 3 carry the same finer catch-light the straight
	# belt's blades do, a light ray down the cleat's trailing edge (only the outer
	# half, so it never smears the pivot). Same recipe, so a straight tile and a
	# curve tile of the tier read as one denser tread through the join.
	if [ "${3:-1}" -ge 2 ]; then
		spoke "$1" "$2" 0 "$RAIL" "$R_BLADE_MID"
	fi
}

# Draw one chevron on the belt's centre line a whole pixel of arc $2 along, in
# frame $1, from the SAME stroke table the straight belt uses — so it is the same
# arrowhead, only turned to the arc. Its tip therefore leads along the direction
# of travel at that point on the curve and its arms open back upstream: it points
# East where flow enters at the West mouth and has rotated round to point South
# where it leaves.
#
# Both ends of a stroke are taken at the chevron's OWN angle, with the arm's back
# end displaced CHEVRON_LEN upstream along the tangent there. Backing the arms off
# by an arc position instead would be wrong: a step of arc measured on the centre
# line is a longer step out at the rim than it is in at the hub, which stretches
# the outer arm, squashes the inner one, and collapses the arrowhead into a bent
# elbow. Displacing along the tangent keeps the two arms the same length and
# symmetric about the direction of travel, exactly as on the straight belt.
#
# Each stroke is SWEPT across its own width a sub-pixel at a time rather than
# drawn as a single line. On the straight belt a stroke runs at a clean 45 degrees
# and rasterises as an even diagonal, but turned to the arc it lands at every
# angle to the pixel grid, and neighbouring strokes a whole pixel apart then merge
# in places and part in others — which is what makes an arm read as a ragged hook
# instead of an arrowhead. Sweeping each stroke gives every arm the same solid,
# even weight all the way round the bend.
chevron_curved() {
	chev_frame=$1
	chev_arc=$2
	# shellcheck disable=SC2086
	set -- $CHEVRON_STROKES
	while [ "$#" -ge 3 ]; do
		across=$((-SUB / 2))
		while [ "$across" -lt "$((SUB - SUB / 2))" ]; do
			polar "$chev_arc" "$((SUB * (OUTER_T - $1) - across))" \
				"$((-SUB * CHEVRON_LEN))"
			chev_x=$PX
			chev_y=$PY
			polar "$chev_arc" "$((SUB * (OUTER_T - $2) - across))" 0
			draw-sheet line --frame "$chev_frame" --x0="$chev_x" --y0="$chev_y" \
				--x1="$PX" --y1="$PY" --color "$3"
			across=$((across + 1))
		done
		shift 3
	done
}

# Higher-tier bolt studs worked into the curve's outer rail, the curved twin of
# `rail_studs_straight`: a dark tick every `spitch` px of arc along the convex
# rim. Structural, so it holds still; the binary clips the ticks that fall past
# the South mouth.
rail_studs_curved() {
	sf=$1
	spitch=$BLADE_PITCH
	[ "$2" -ge 3 ] && spitch=$((BLADE_PITCH / 2))
	a=0
	while [ "$a" -le "$OUTER_T" ]; do
		polar "$a" "$((OUTER_T * SUB))" 0
		draw-sheet set-pixel --frame "$sf" --x="$PX" --y="$PY" --color "$OUTLINE"
		a=$((a + spitch))
	done
}

# Tier 3 only: the energy-glow bloom leading each chevron round the arc — the
# curved twin of `glow_straight`, one pale-cyan pixel just downstream of each
# chevron along the centre line.
glow_curved() {
	gf=$1
	goff=$2
	arc=$((goff - CHEVRON_PITCH))
	while [ "$arc" -le "$((goff + TILE))" ]; do
		polar "$arc" "$R_BLADE_MID" "$((SUB / 2))"
		draw-sheet set-pixel --frame "$gf" --x="$PX" --y="$PY" --color "$GLOW"
		arc=$((arc + CHEVRON_PITCH))
	done
}

curved_frame() {
	frame=$1
	loop=$2
	tier=$3
	# How far the whole surface pattern has advanced around the bend — measured
	# along the belt's centre line, and by the SAME step as the straight belt, so
	# a straight tile feeding this curve stays in phase with it frame for frame.
	# The loop position (not the absolute frame) drives it, so every tier's curve
	# loop is in phase with tier 1's.
	offset=$((loop * STEP))

	# 1. The belt's fixed structure, as nested discs about the corner: each disc
	#    paints over the one before it, so what survives of each is a band. The
	#    radii are the shared cross-section read as `OUTER_T - t`, which is why
	#    both mouths come out with the straight belt's rails, outlines, and
	#    surface band on exactly the same rows. Only the far North-East corner,
	#    beyond the arc, stays transparent.
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$OUTER_T" --color "$RAIL"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$((OUTER_T - RAIL_T))" --color "$OUTLINE"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$SURF_OUT" --color "$BASE"

	# 2. The tread blades, at the blade pitch, swept around the arc by this
	#    frame's offset. These are the main "it is running" cue: the surface
	#    itself travels, not just the arrows over it.
	#
	#    The range starts TWO pitches upstream of the entry, not one. The blades
	#    sit at whole pitches from the offset, so one pitch of run-up leaves the
	#    first blade anywhere from a whole pitch to nothing upstream of the mouth,
	#    depending on the frame — and on the frames where it lands closest, the
	#    blade before it is still part-way through the mouth and has to be drawn.
	#    A second pitch of run-up covers that case for every offset; the extra
	#    blades fall outside the tile and the binary clips them.
	arc=$((offset - 2 * BLADE_PITCH))
	while [ "$arc" -le "$((offset + TILE))" ]; do
		blade_curved "$frame" "$arc" "$tier"
		arc=$((arc + BLADE_PITCH))
	done

	# 3. The inner rail and its outline: the small quarter-round nub at the
	#    corner, which is the pivot of the turn and the continuation of the
	#    straight belt's inner rail. They go down AFTER the blades so a cleat
	#    cannot bleed into the pivot, and they are what make the curve's two
	#    mouths match the straight belt's cross-section on BOTH sides rather than
	#    only the outer one.
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$((OUTER_T - SURF_OUT - 1))" --color "$OUTLINE"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$((OUTER_T - SURF_OUT - 1 - OUTLINE_T))" --color "$RAIL"

	# 4. The chevrons, painted last so they sit on top of the tread blades they
	#    share a surface with — one row down the centre line at the chevron
	#    pitch, advancing by the same offset, so the whole surface moves as one
	#    locked pattern.
	arc=$((offset - CHEVRON_PITCH))
	while [ "$arc" -le "$((offset + TILE))" ]; do
		chevron_curved "$frame" "$arc"
		arc=$((arc + CHEVRON_PITCH))
	done

	# 3b/4b as on the straight belt: the outer-rail bolt studs (tiers 2-3) and the
	#      tier-3 chevron glow, so a straight tile and a curve tile of the same
	#      tier carry the same reinforcement.
	[ "$tier" -ge 2 ] && rail_studs_curved "$frame" "$tier"
	[ "$tier" -ge 3 ] && glow_curved "$frame" "$offset"
	return 0 # a false trailing `&&` must not fail the function under `set -e`
}

# ==============================================================================
# The sheet
# ==============================================================================
#
# Three tiers of sixteen frames each: a straight loop then a curve loop. Every
# tier is drawn by the SAME two functions above from the SAME per-frame geometry
# — only `set_tier` (the mover accent) and the tier-gated detail passes differ,
# which is exactly what the brief asks the three tiers to be. `loop` (0..7) is the
# position within each eight-frame loop and drives the scroll, so all three tiers
# stay in phase; the renderer plays the higher tiers back faster.

tier=1
while [ "$tier" -le 3 ]; do
	set_tier "$tier"
	straight_base=$(((tier - 1) * 2 * SEQ_FRAMES)) # 0, 16, 32
	curve_base=$((straight_base + CURVE_FRAME))    # 8, 24, 40

	loop=0
	while [ "$loop" -lt "$SEQ_FRAMES" ]; do
		straight_frame "$((straight_base + loop))" "$loop" "$tier"
		loop=$((loop + 1))
	done

	loop=0
	while [ "$loop" -lt "$SEQ_FRAMES" ]; do
		curved_frame "$((curve_base + loop))" "$loop" "$tier"
		loop=$((loop + 1))
	done

	tier=$((tier + 1))
done
