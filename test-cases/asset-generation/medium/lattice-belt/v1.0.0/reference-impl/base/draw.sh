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
OUTLINE='#1b1d21'
BASE='#34383d'
MID='#4a4f55'
RAIL='#6b7178'
AMBER='#e6b329'
AMBER_HI='#f6d96b'
AMBER_LO='#b88410'

# The chevron, as four strokes in belt coordinates: `t_back t_tip tone`. Each
# stroke runs from an arm's back end — CHEVRON_LEN upstream, at across-position
# `t_back` — in to the tip at `t_tip`. The two arms open back upstream from a
# leading tip; the highlight rides the OUTER edge and the shadow the inner one,
# so the arrowhead reads with a little depth. Straddling t = 15.5, it sits on the
# centre line of the SURF_IN..SURF_OUT band.
#
# This one table is the whole chevron. Both halves iterate it, so the curve
# cannot drift into a different arrowhead than the straight belt's.
CHEVRON_STROKES="10 14 $AMBER_HI 11 15 $AMBER 20 16 $AMBER 21 17 $AMBER_LO"

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

straight_frame() {
	frame=$1
	# How far the whole surface pattern has advanced east in this frame.
	offset=$((frame * STEP))

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

	# 3. The rails, drawn after the surface so they stay crisp.
	rails_straight "$frame"

	# 4. The chevrons, painted last so they sit on top of the tread blades they
	#    share a surface with — one central row at the chevron pitch, wrapped the
	#    same way as the blades, advancing by the same offset so the whole
	#    surface moves as one locked pattern.
	base=$((-TILE))
	while [ "$base" -le "$TILE" ]; do
		chevron_straight "$frame" "$((base + offset))"
		base=$((base + CHEVRON_PITCH))
	done
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

curved_frame() {
	frame=$1
	# How far the whole surface pattern has advanced around the bend — measured
	# along the belt's centre line, and by the SAME step as the straight belt, so
	# a straight tile feeding this curve stays in phase with it frame for frame.
	offset=$(((frame - CURVE_FRAME) * STEP))

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
		blade_curved "$frame" "$arc"
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
}

# ==============================================================================
# The sheet
# ==============================================================================

frame=0
while [ "$frame" -lt "$CURVE_FRAME" ]; do
	straight_frame "$frame"
	frame=$((frame + 1))
done

while [ "$frame" -lt "$((CURVE_FRAME + SEQ_FRAMES))" ]; do
	curved_frame "$frame"
	frame=$((frame + 1))
done
