#!/bin/sh
# Reference implementation — Lattice Lane Splitter (variant `base`).
#
# Draws the eight-frame East-flowing lane-splitter sheet with `draw-sheet`, one
# operation at a time, exactly as a model would. Run from a seeded asset workspace
# (see `tcab publish-reference`): `draw.config.json`, the empty per-frame action
# logs, the blank previews, and an empty `layers.json` are already in place, so this
# script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The sprite is built in TWO LAYERS, which is how the brief describes the device
# and what lets the renderer pass items *under* the machine instead of fading them
# out:
#
#   1. The belt bed — the base. A continuous transport-belt surface laid straight
#      into every frame across the *whole* width of both lanes, unbroken from the
#      West edge to the East edge, INCLUDING the stretch beneath the machine.
#   2. The mechanism — a sheet-wide `mechanism` layer over the belt bed, carrying
#      the housing, its output arrow, and the machine's SIGNATURE feature: a raised
#      East-West splitting ridge down the centre seam. Two more layers above it
#      (`spread_top`, `spread_bot`) carry the two spreader heads — the one moving
#      part per lane — that ride OUTWARD toward the outer edges and back, so the
#      pair reads as the machine unzipping the two streams apart to their outer
#      lanes. The layers OCCLUDE the belt beneath them in the flat sprite, but the
#      belt runs whole underneath, so the game renderer draws items BETWEEN the belt
#      bed and them.
#
# The belt mouths that stay visible at the left and right edges are, pixel for
# pixel, a Lattice transport belt; the difference from a plain belt is the housed
# machine in the middle, and the difference from the plain splitter is the
# lengthwise ridge and the two outward-riding heads (not a flat lid and a single
# cross-lane shuttle).

set -eu

# --- The belt cross-section (shared with the transport-belt tile) --------------
#
# These rows are copied from the Lattice transport belt's reference sheet and must
# stay identical to it: a belt tile butted against an input or an output mouth has
# to line up flush, edge to edge, with no step in the rails or in the surface. Each
# 32-row cell of this frame is one belt width.
CELL=32        # one tile cell across the flow; the frame is two of them stacked
RAIL_H=2       # rail band height, at the top and bottom of every cell
SURFACE_TOP=3  # first surface row of a cell, below the top rail and its outline
SURFACE_BOT=28 # last surface row of a cell, above the bottom outline and rail
BLADE_TOP=$((SURFACE_TOP + 1))
BLADE_H=$((SURFACE_BOT - BLADE_TOP))

# Stacking the two cells puts rail-outline-outline-rail back to back around the
# frame's horizontal centre line, which is exactly the lane divider the brief asks
# for at y 31-32: it falls out of the belt geometry rather than being drawn on top.

# --- The scrolling surface -----------------------------------------------------
#
# Same pitches and the same per-frame step as the transport belt, so the two
# animations run locked together: 8 x 2 px = one 16 px chevron pitch, so frame 7
# hands back to frame 0 exactly one full pitch on.
FRAMES=8
CHEVRON_PITCH=16
BLADE_PITCH=8
STEP=$((CHEVRON_PITCH / FRAMES))

# --- The bands across the flow -------------------------------------------------
#
# 9 px of input mouth, then the housing — a flat lid that rakes east into its
# arrow — then 9 px of output mouth. The mouths are the widest the housing can
# spare so a chevron is always visible in every frame.
MOUTH_W=9
HOUSE_X=$MOUTH_W                    # the housing's west face (the intake seam)
HOUSE_E=$((32 - MOUTH_W - 1))       # its east face, before the arrow steps out
LID_X=$((HOUSE_X + 1))              # first lid column, east of the intake seam
LID_W=$((HOUSE_E - LID_X))          # lid columns before the arrow's step-out

# The output end is an East-pointing arrowhead, raking on a 1-in-2 diagonal to a
# point on the frame's centre line, so the housing's own silhouette aims at the
# outputs. Its depth comes out of the divider between the two output lanes, which
# carries rails rather than belt surface, so both output mouths keep their width
# where the chevrons are. A step at or past `ARROW_AMBER` carries a thin amber edge.
ARROW_AMBER=5

# --- The splitting ridge (the signature static feature) ------------------------
#
# A raised spine running ALONG the flow (East-West) down the centre seam, over the
# divider between the two lanes: the blade that parts the flow. Lit along its crown
# and shadowed on its underside so it stands proud of the flat lid, and pointed at
# the intake so it reads as splitting the incoming stream apart. It leads east into
# the output arrow's point.
RIDGE_TOP=27   # top outline row of the ridge
RIDGE_BOT=35   # bottom outline row of the ridge

# --- The spreader heads (the moving parts) -------------------------------------
#
# Two compact heads, one per lane, that ride outward from the ridge toward the two
# outer edges and back, in mirror symmetry. Painted once on their own layers, then
# swept by keyframing each layer's Y.
HEAD_W=6
HEAD_H=6
HEAD_X=13                          # centred over the lid, east of the ridge crown
TOP_HOME=21                        # top head painted just above the ridge
BOT_HOME=$((64 - HEAD_H - TOP_HOME))   # bottom head mirrored about the centre line

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
BASE='#34383d'
MID='#4a4f55'
RAIL='#6b7178'
AMBER='#e6b329'
AMBER_HI='#f6d96b'
AMBER_LO='#b88410'
HOUSE_LIGHT='#6a7884'
HOUSE_MID='#4d5a64'
HOUSE_DARK='#36424b'

# Draw one tread blade (cleat) at column $2 of the cell whose top row is $3, in
# frame $1. Columns off-canvas are clipped by the binary, which is how the wrapped
# copies below cost nothing. The `--x=…` form matters: a wrapped copy's column is
# negative, and `--x -32` would be read as a flag rather than a value.
blade() {
	frame=$1
	x=$2
	top=$3
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$((top + BLADE_TOP))" \
		--width 3 --height "$BLADE_H" --color "$MID"
	draw-sheet fill-rect --frame "$frame" --x="$((x + 3))" --y "$((top + BLADE_TOP))" \
		--width 1 --height "$BLADE_H" --color "$OUTLINE"
}

# Draw one East-pointing chevron with its tip at column $2 of the cell whose top
# row is $3, in frame $1, centred on that cell's horizontal centre line. Identical
# to the transport belt's chevron, so a belt and this machine's mouths carry the
# same items in the same style.
chevron() {
	frame=$1
	tip=$2
	top=$3
	back=$((tip - 4))
	draw-sheet line --frame "$frame" --x0="$back" --y0 "$((top + 10))" \
		--x1="$tip" --y1 "$((top + 14))" --color "$AMBER_HI"
	draw-sheet line --frame "$frame" --x0="$back" --y0 "$((top + 11))" \
		--x1="$tip" --y1 "$((top + 15))" --color "$AMBER"
	draw-sheet line --frame "$frame" --x0="$back" --y0 "$((top + 20))" \
		--x1="$tip" --y1 "$((top + 16))" --color "$AMBER"
	draw-sheet line --frame "$frame" --x0="$back" --y0 "$((top + 21))" \
		--x1="$tip" --y1 "$((top + 17))" --color "$AMBER_LO"
}

# Lay one full transport-belt cell — the whole 32 px width of the frame — with its
# surface advanced east by $2, into the cell whose top row is $3 of frame $1.
# Wrapped copies a full cell to either side make the pattern re-enter from the left
# as it leaves at the right, which is what lets the mouths tile horizontally.
belt_cell() {
	frame=$1
	offset=$2
	top=$3

	draw-sheet fill-rect --frame "$frame" --x 0 --y "$top" \
		--width "$CELL" --height "$CELL" --color "$BASE"

	base=$((-CELL))
	while [ "$base" -le "$CELL" ]; do
		blade "$frame" "$((base + offset))" "$top"
		base=$((base + BLADE_PITCH))
	done

	draw-sheet fill-rect --frame "$frame" --x 0 --y "$top" \
		--width "$CELL" --height "$RAIL_H" --color "$RAIL"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((top + RAIL_H))" \
		--width "$CELL" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((top + SURFACE_TOP))" \
		--width "$CELL" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((top + SURFACE_BOT))" \
		--width "$CELL" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((top + SURFACE_BOT + 1))" \
		--width "$CELL" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((top + SURFACE_BOT + 2))" \
		--width "$CELL" --height "$RAIL_H" --color "$RAIL"

	base=$((-CELL))
	while [ "$base" -le "$CELL" ]; do
		chevron "$frame" "$((base + offset))" "$top"
		base=$((base + CHEVRON_PITCH))
	done
}

# One horizontal band of the housing's east face, on the `mechanism` layer: rows
# $1..$1+$2-1 stepped $3 px east of the flat face. Painted with `--layer mechanism`
# (no `--frame`): the housing is static, drawn once and composited over every frame.
arrow_band() {
	y=$1
	h=$2
	step=$3

	if [ "$step" -gt 0 ]; then
		draw-sheet fill-rect --layer mechanism --x "$((HOUSE_E))" --y "$y" \
			--width "$step" --height "$h" --color "$HOUSE_MID"
	fi
	edge=$HOUSE_DARK
	if [ "$step" -ge "$ARROW_AMBER" ]; then
		edge=$AMBER
	fi
	draw-sheet fill-rect --layer mechanism --x "$((HOUSE_E - 1 + step))" --y "$y" \
		--width 1 --height "$h" --color "$edge"
	draw-sheet fill-rect --layer mechanism --x "$((HOUSE_E + step))" --y "$y" \
		--width 1 --height "$h" --color "$OUTLINE"
}

# The same band mirrored about the frame's centre line, so the arrow is symmetric
# and comes to its point exactly on the divider between the two lanes.
arrow_step() {
	k=$1
	h=$2
	step=$3
	arrow_band "$k" "$h" "$step"
	arrow_band "$((2 * CELL - k - h))" "$h" "$step"
}

# A bolt on the lid at ($1, $2) of the `mechanism` layer: a dark head with a lit
# top-left corner, two pixels square.
bolt() {
	draw-sheet fill-rect --layer mechanism --x "$1" --y "$2" \
		--width 2 --height 2 --color "$OUTLINE"
	draw-sheet set-pixel --layer mechanism --x "$1" --y "$2" --color "$HOUSE_LIGHT"
}

# One recessed diverter rail on the `mechanism` layer — a dark channel the spreader
# head rides — spanning rows $1..$2 in the head's column band, seated with an
# outline down its outer (away-from-centre) edge so it reads as sunk into the lid.
diverter_rail() {
	top=$1
	bot=$2
	edge=$3   # the row the outline shadow sits on (the outer end)
	draw-sheet fill-rect --layer mechanism --x "$((HEAD_X - 1))" --y "$top" \
		--width "$((HEAD_W + 2))" --height "$((bot - top + 1))" --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$((HEAD_X - 1))" --y "$edge" \
		--width "$((HEAD_W + 2))" --height 1 --color "$OUTLINE"
}

# The whole static mechanism, painted ONCE onto the `mechanism` layer: the closed
# lid, its bevels, the east-facing output arrow, the intake seam, the two recessed
# diverter rails, the central splitting ridge, and the lid's machine detail. None of
# it changes frame to frame.
draw_mechanism() {
	# The lid: one unbroken mass from the top of the frame to the bottom, so the two
	# tile cells are visibly bracketed into a single machine.
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width "$LID_W" --height "$((2 * CELL))" --color "$HOUSE_MID"

	# Depth on the lid: light bevel along its top and west edges, dark along the
	# bottom. (Its east edge is the arrow, shaded below.)
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width 1 --height "$((2 * CELL))" --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width "$LID_W" --height 1 --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$((2 * CELL - 1))" \
		--width "$LID_W" --height 1 --color "$HOUSE_DARK"

	# The arrow, tabulated as bands of rows and how far east each steps the face,
	# mirrored top to bottom about the centre line: a clean 1-in-2 rake to a point on
	# the divider.
	arrow_step 0 17 0
	arrow_step 17 2 1
	arrow_step 19 2 2
	arrow_step 21 2 3
	arrow_step 23 2 4
	arrow_step 25 2 5
	arrow_step 27 2 6
	arrow_step 29 2 7
	arrow_step 31 1 8

	# The intake seam: the dark edge where the belt disappears under the lid.
	draw-sheet fill-rect --layer mechanism --x "$HOUSE_X" --y 0 \
		--width 1 --height "$((2 * CELL))" --color "$OUTLINE"

	# The two recessed diverter rails the heads ride — top lane and bottom lane —
	# each with its seating shadow on the outer end, toward the edge the head travels
	# to.
	diverter_rail 5 "$((RIDGE_TOP - 1))" 5
	diverter_rail "$((RIDGE_BOT + 1))" "$((2 * CELL - 6))" "$((2 * CELL - 6))"

	# The splitting ridge: a raised East-West spine down the centre seam. Outlined
	# top and bottom, a lit crown, a mid body, and a shadowed underside, so it stands
	# proud of the lid. Its west end steps to a point at the intake, so it reads as
	# the blade parting the incoming flow; its east end runs into the arrow's point.
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$RIDGE_TOP" \
		--width "$((HOUSE_E - LID_X))" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$((RIDGE_TOP + 1))" \
		--width "$((HOUSE_E - LID_X))" --height 2 --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$((RIDGE_TOP + 3))" \
		--width "$((HOUSE_E - LID_X))" --height 3 --color "$HOUSE_MID"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$((RIDGE_TOP + 6))" \
		--width "$((HOUSE_E - LID_X))" --height 2 --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$RIDGE_BOT" \
		--width "$((HOUSE_E - LID_X))" --height 1 --color "$OUTLINE"
	# The intake point: taper the ridge's west two columns to a wedge on the seam.
	draw-sheet set-pixel --layer mechanism --x "$LID_X" --y "$((RIDGE_TOP + 1))" \
		--color "$OUTLINE"
	draw-sheet set-pixel --layer mechanism --x "$LID_X" --y "$((RIDGE_BOT - 1))" \
		--color "$OUTLINE"

	# Machine details on the lid: a faint inspection seam across each end, and a bolt
	# at each of its four corners.
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 1))" --y 3 \
		--width "$((LID_W - 1))" --height 1 --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 1))" --y "$((2 * CELL - 4))" \
		--width "$((LID_W - 1))" --height 1 --color "$HOUSE_DARK"
	bolt "$((LID_X + 1))" 1
	bolt "$((HOUSE_E - 2))" 1
	bolt "$((LID_X + 1))" "$((2 * CELL - 3))"
	bolt "$((HOUSE_E - 2))" "$((2 * CELL - 3))"
}

# One spreader head, painted ONCE onto layer $1 with its top at row $2. A compact
# dark-outlined block, housing-light bodied, carrying an amber chevron that points
# OUTWARD ($3 is `up` for the top head, `down` for the bottom) — the same amber as
# the belt movers, marking the moving part and its diverging direction.
draw_head() {
	layer=$1
	top=$2
	dir=$3
	draw-sheet fill-rect --layer "$layer" --x "$HEAD_X" --y "$top" \
		--width "$HEAD_W" --height "$HEAD_H" --color "$OUTLINE"
	draw-sheet fill-rect --layer "$layer" --x "$((HEAD_X + 1))" --y "$((top + 1))" \
		--width "$((HEAD_W - 2))" --height "$((HEAD_H - 2))" --color "$HOUSE_LIGHT"
	if [ "$dir" = "up" ]; then
		draw-sheet line --layer "$layer" --x0 "$((HEAD_X + 1))" --y0 "$((top + 3))" \
			--x1 "$((HEAD_X + 2))" --y1 "$((top + 2))" --color "$AMBER"
		draw-sheet line --layer "$layer" --x0 "$((HEAD_X + 4))" --y0 "$((top + 3))" \
			--x1 "$((HEAD_X + 3))" --y1 "$((top + 2))" --color "$AMBER"
	else
		draw-sheet line --layer "$layer" --x0 "$((HEAD_X + 1))" --y0 "$((top + 2))" \
			--x1 "$((HEAD_X + 2))" --y1 "$((top + 3))" --color "$AMBER"
		draw-sheet line --layer "$layer" --x0 "$((HEAD_X + 4))" --y0 "$((top + 2))" \
			--x1 "$((HEAD_X + 3))" --y1 "$((top + 3))" --color "$AMBER"
	fi
}

# One Y keyframe for a spreader head layer: place its top at canvas row $3 on frame
# $2. The layer's Y is its top edge; the head was painted at row $4 (its home), so
# the key value is the desired row minus that home. `constant` interp is used
# because every frame carries its own key.
head_to() {
	draw-sheet animate-layer --layer "$1" --property y \
		--frame "$2" --value="$(($3 - $4))" --interp constant
}

# ── Pass 1: the belt bed (the base surface items ride) ─────────────────────────
frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	offset=$((frame * STEP))
	belt_cell "$frame" "$offset" 0
	belt_cell "$frame" "$offset" "$CELL"
	frame=$((frame + 1))
done

# ── Pass 2: the mechanism layers, over the belt bed ────────────────────────────
#
# Register the sheet-wide layers above the belt log: the housing (z 0), then the two
# spreader heads (z 1, above the housing). Paint them; `mechanism` is static, the
# heads are painted once and animated.
draw-sheet register-layer --name mechanism --x 0 --y 0 --width 32 --height 64 --z 0
draw-sheet register-layer --name spread_top --x 0 --y 0 --width 32 --height 64 --z 1
draw-sheet register-layer --name spread_bot --x 0 --y 0 --width 32 --height 64 --z 1

draw_mechanism
draw_head spread_top "$TOP_HOME" up
draw_head spread_bot "$BOT_HOME" down

# The two heads ride outward from the ridge to the outer edges and draw back in,
# mirror-symmetric about the centre line, so the pair reads as an unzip. The eight
# stops are all distinct — the outward run and the return are eased slightly
# differently, which keeps the sweep from landing twice on the same row and
# collapsing into a jitter. The top head's rows and the bottom head's are exact
# reflections (bottom = 64 - HEAD_H - top), so frame 7 hands to frame 0 with no jump.
head_to spread_top 0 21 "$TOP_HOME"
head_to spread_top 1 17 "$TOP_HOME"
head_to spread_top 2 12 "$TOP_HOME"
head_to spread_top 3 8  "$TOP_HOME"
head_to spread_top 4 6  "$TOP_HOME"
head_to spread_top 5 10 "$TOP_HOME"
head_to spread_top 6 15 "$TOP_HOME"
head_to spread_top 7 19 "$TOP_HOME"

head_to spread_bot 0 37 "$BOT_HOME"
head_to spread_bot 1 41 "$BOT_HOME"
head_to spread_bot 2 46 "$BOT_HOME"
head_to spread_bot 3 50 "$BOT_HOME"
head_to spread_bot 4 52 "$BOT_HOME"
head_to spread_bot 5 48 "$BOT_HOME"
head_to spread_bot 6 43 "$BOT_HOME"
head_to spread_bot 7 39 "$BOT_HOME"
