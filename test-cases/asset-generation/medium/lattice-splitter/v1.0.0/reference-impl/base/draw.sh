#!/bin/sh
# Reference implementation — Lattice Splitter (variant `base`).
#
# Draws the eight-frame East-flowing splitter sheet with `draw-sheet`, one
# operation at a time, exactly as a model would. Run from a seeded asset
# workspace (see `tcab publish-reference`): `draw.config.json`, the empty
# per-frame action logs, the blank previews, and an empty `layers.json` are
# already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The sprite is built in TWO LAYERS, which is how the brief describes the device
# and what lets the renderer pass items *under* the machine instead of fading
# them out:
#
#   1. The belt bed — the base. A continuous transport-belt surface laid straight
#      into every frame across the *whole* width of both lanes, unbroken from the
#      West edge to the East edge, INCLUDING the stretch beneath the machine. This
#      is the surface items ride, so it has to run whole under the mechanism.
#   2. The mechanism — a sheet-wide `mechanism` layer composited on top of the
#      belt bed, carrying the housing, its output arrow, and (on a second
#      `shuttle` layer above it) the one moving part. The layer OCCLUDES the belt
#      beneath it in the flat sprite, but because it is a genuine separate layer
#      with the belt whole underneath, the game renderer draws items BETWEEN the
#      belt bed and this layer — an item slides from an input, under the
#      mechanism, and out an output without the belt ever breaking.
#
# The belt mouths that stay visible at the left and right edges are, pixel for
# pixel, a Lattice transport belt; the flat composited preview looks just as it
# would if the housing were painted on — the difference is structural, and it is
# the whole point.

set -eu

# --- The belt cross-section (shared with the transport-belt tile) --------------
#
# These rows are copied from the Lattice transport belt's reference sheet and
# must stay identical to it: a belt tile butted against an input or an output
# mouth has to line up flush, edge to edge, with no step in the rails or in the
# surface. Each 32-row cell of this frame is one belt width.
CELL=32        # one tile cell across the flow; the frame is two of them stacked
RAIL_H=2       # rail band height, at the top and bottom of every cell
SURFACE_TOP=3  # first surface row of a cell, below the top rail and its outline
SURFACE_BOT=28 # last surface row of a cell, above the bottom outline and rail
# The blades stop one row short at each end, leaving a contact shadow where the
# belt meets each rail — the same single dark row the transport belt has.
BLADE_TOP=$((SURFACE_TOP + 1))
BLADE_H=$((SURFACE_BOT - BLADE_TOP))

# Stacking the two cells puts rail-outline-outline-rail back to back around the
# frame's horizontal centre line, which is exactly the lane divider the brief
# asks for at y 31–32: it falls out of the belt geometry rather than being drawn
# on top of it, so each mouth reads as its own single-belt lane.

# --- The scrolling surface -----------------------------------------------------
#
# Same pitches and the same per-frame step as the transport belt, so the two
# animations run locked together: the chevron pitch is the repeat the pattern is
# measured in, the blade pitch divides it exactly, and one-eighth of a chevron
# pitch per frame means every frame sits at a distinct offset and frame 7 hands
# back to frame 0 exactly one full pitch on.
FRAMES=8
CHEVRON_PITCH=16
BLADE_PITCH=8
STEP=$((CHEVRON_PITCH / FRAMES))

# --- The bands across the flow -------------------------------------------------
#
# 9 px of input mouth, then the housing — 14 px of flat body, widening to 21
# where its arrow points — then 9 px of output mouth. The mouths are deliberately
# the widest the housing can spare: with a 16 px chevron pitch and a 5 px chevron
# a narrower stub would sit in the gap between two chevrons for several frames
# running and the mouth would look stalled.
MOUTH_W=9
HOUSE_X=$MOUTH_W                    # the housing's west face (the intake seam)
HOUSE_E=$((32 - MOUTH_W - 1))       # its east face, before the arrow steps out
# The beam is a recessed track laid on the closed lid right where the housing
# starts on the intake side; the lid proper begins east of it.
BEAM_X=$((HOUSE_X + 1))
BEAM_W=3
LID_X=$((BEAM_X + BEAM_W + 1))      # first lid column, east of the beam outline
LID_W=$((HOUSE_E - LID_X))          # lid columns before the arrow's step-out

# The output end is an East-pointing arrowhead. The face is flat at the frame's
# top and bottom and then rakes east on a steady 1-in-2 diagonal to a point on
# the frame's centre line, so the housing's own silhouette is a bold chevron
# aimed at the outputs. What makes a point that bold affordable in a 32 px-wide
# sprite is where it lands: the deep end comes out into the *divider* between the
# two output lanes, which carries rails rather than belt surface, so the arrow
# takes its depth out of the seam and leaves both output mouths their full width
# where it matters — across the chevron rows the mouth never narrows past 6 px,
# more than a whole chevron. A step at or past `ARROW_AMBER` carries a thin amber
# edge instead of the shade — the
# small moving-parts accent the brief allows, kept to the raked point itself,
# where it draws the eye into a bright East-pointing V.
ARROW_AMBER=5

# The shuttle rides the beam. Height, and its travel: it parks just inside the
# top rail and reaches just inside the bottom one.
SHUTTLE_W=5
SHUTTLE_H=7

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
# frame $1: a two-pixel raised face in the metal mid tone with the dark outline
# down its trailing edge, spanning the full surface height between the rails.
# Columns off-canvas are clipped by the binary, which is how the wrapped copies
# below cost nothing.
#
# Note the `--x=…` form on every column: a wrapped copy's column is negative,
# and `--x -32` would be read as a flag rather than a value.
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
# row is $3, in frame $1, centred on that cell's horizontal centre line. Four
# lines: the two arms in the amber mover tone, with the highlight along the
# leading/top edge and the shadow along the trailing/bottom edge. Identical to
# the transport belt's chevron, because a belt and this splitter's mouths have
# to visibly carry the same items in the same style.
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

# Lay one full transport-belt cell — the whole 32 px width of the frame — with
# its surface advanced east by $3, into the cell whose top row is $4 of frame
# $1. Wrapped copies a full cell to either side make the pattern re-enter from
# the left as it leaves at the right, which is what lets the mouths tile
# horizontally with the belts plugged into them.
belt_cell() {
	frame=$1
	offset=$2
	top=$3

	# 1. The belt body: the metal base across the whole cell.
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$top" \
		--width "$CELL" --height "$CELL" --color "$BASE"

	# 2. The tread blades, at the blade pitch, shifted east by this frame's
	#    offset. They are the cue that the surface itself is running, and at
	#    an 8 px pitch every mouth carries one in every frame.
	base=$((-CELL))
	while [ "$base" -le "$CELL" ]; do
		blade "$frame" "$((base + offset))" "$top"
		base=$((base + BLADE_PITCH))
	done

	# 3. The rails, drawn after the surface so they stay crisp: a lighter band
	#    along each long edge of the cell, separated from the belt by the dark
	#    outline, plus the contact shadow the blades left room for.
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

	# 4. The chevrons, painted last so they sit on top of the tread blades they
	#    share a surface with — one central row per cell at the chevron pitch,
	#    wrapped the same way and advanced by the same offset, so the whole
	#    surface moves as one locked pattern.
	base=$((-CELL))
	while [ "$base" -le "$CELL" ]; do
		chevron "$frame" "$((base + offset))" "$top"
		base=$((base + CHEVRON_PITCH))
	done
}

# One horizontal band of the housing's east face, on the `mechanism` layer: rows
# $1..$1+$2-1 stepped $3 px east of the flat face. Fills the step in the housing
# mid tone, shades its outer column, and closes the silhouette with the dark
# outline. Rows deep enough into the arrow get the amber edge instead of the
# shade. Painted with `--layer mechanism` (no `--frame`): the housing is static,
# so it is drawn once and composited over every frame.
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

# The same band mirrored about the frame's centre line, so the arrow is
# symmetric and comes to its point exactly on the divider between the two lanes.
# $1 is the distance of the band's first row from the *nearer* end of the frame.
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

# The whole static mechanism, painted ONCE onto the `mechanism` layer: the closed
# lid over the middle of both cells, its bevels, the east-facing output arrow, the
# intake seam, the balancer beam, and the lid's machine detail. None of it changes
# frame to frame, so it is a single sheet-wide paint rather than eight identical
# per-frame ones — and it composites above the belt bed, occluding the belt it
# covers while the belt runs on whole underneath.
draw_mechanism() {
	# The lid: one unbroken mass from the top of the frame to the bottom, so the
	# two tile cells are visibly bracketed into a single machine.
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width "$LID_W" --height "$((2 * CELL))" --color "$HOUSE_MID"

	# Depth on the lid: the light bevel along its top and west edges, the dark
	# tone along the bottom. (Its east edge is the arrow, shaded below.)
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width 1 --height "$((2 * CELL))" --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y 0 \
		--width "$LID_W" --height 1 --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$LID_X" --y "$((2 * CELL - 1))" \
		--width "$LID_W" --height 1 --color "$HOUSE_DARK"

	# The arrow, tabulated as bands of rows and how far east each steps the face,
	# mirrored top to bottom about the centre line. Seventeen flat rows of
	# shoulder, then one column of step every two rows — a clean 1-in-2 rake — and
	# a single row at full depth for the point. The band heights sum to the
	# half-height, so the two halves meet exactly on the divider.
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

	# The balancer beam: a recessed track in the housing-dark tone, running the
	# full height across both lanes, closed off from the lid by the outline. This
	# is the track the shuttle rides.
	draw-sheet fill-rect --layer mechanism --x "$BEAM_X" --y 0 \
		--width "$BEAM_W" --height "$((2 * CELL))" --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$((BEAM_X + BEAM_W))" --y 0 \
		--width 1 --height "$((2 * CELL))" --color "$OUTLINE"

	# Machine details on the lid: a faint inspection seam across each end, and a
	# bolt at each of its four corners.
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 1))" --y 5 \
		--width "$((LID_W - 1))" --height 1 --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 1))" --y "$((2 * CELL - 6))" \
		--width "$((LID_W - 1))" --height 1 --color "$HOUSE_DARK"
	bolt "$((LID_X + 2))" 2
	bolt "$((HOUSE_E - 3))" 2
	bolt "$((LID_X + 2))" "$((2 * CELL - 4))"
	bolt "$((HOUSE_E - 3))" "$((2 * CELL - 4))"

	# A long recessed inspection hatch down the middle of the lid — dark along its
	# top and west edges, lit along its bottom and east ones, so it reads as sunk
	# into the plate. It deliberately straddles the frame's centre line, reaching
	# well into both tile cells: a single panel that belongs to neither lane is the
	# clearest statement that this is one machine over both of them.
	draw-sheet stroke-rect --layer mechanism --x "$((LID_X + 2))" --y 20 \
		--width 5 --height 24 --color "$HOUSE_DARK"
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 3))" --y 43 \
		--width 4 --height 1 --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer mechanism --x "$((LID_X + 6))" --y 21 \
		--width 1 --height 22 --color "$HOUSE_LIGHT"
}

# The shuttle — the one moving part — painted ONCE onto its own `shuttle` layer at
# its home (top) position, then swept down and back by keyframing the layer's Y.
# A compact block riding the beam: dark-outlined so it reads against the housing,
# housing-light bodied, with the amber accent across its middle — the same amber
# as the movers, marking what moves. It sits on the `shuttle` layer (above
# `mechanism`), so like the housing it composites over the belt and over items.
SHUTTLE_HOME=2
draw_shuttle() {
	draw-sheet fill-rect --layer shuttle --x "$HOUSE_X" --y "$SHUTTLE_HOME" \
		--width "$SHUTTLE_W" --height "$SHUTTLE_H" --color "$OUTLINE"
	draw-sheet fill-rect --layer shuttle --x "$((HOUSE_X + 1))" --y "$((SHUTTLE_HOME + 1))" \
		--width "$((SHUTTLE_W - 2))" --height "$((SHUTTLE_H - 2))" --color "$HOUSE_LIGHT"
	draw-sheet fill-rect --layer shuttle --x "$((HOUSE_X + 1))" --y "$((SHUTTLE_HOME + 3))" \
		--width "$((SHUTTLE_W - 2))" --height 1 --color "$AMBER"
}

# One Y keyframe for the shuttle layer: place the shuttle's top at canvas row $2
# on frame $1. The layer's Y is its top edge on the canvas, and the shuttle was
# painted at row SHUTTLE_HOME, so the key value is the desired row minus that
# home. `constant` interp is used because every frame carries its own key — the
# eight stops are the authored animation, not points to tween between.
shuttle_to() {
	draw-sheet animate-layer --layer shuttle --property y \
		--frame "$1" --value "$(($2 - SHUTTLE_HOME))" --interp constant
}

# ── Pass 1: the belt bed (the base surface items ride) ─────────────────────────
#
# Two stacked transport-belt cells per frame at that frame's scroll offset: the
# top lane's input+output and the bottom lane's, laid across the whole frame.
# Most of this is about to be occluded by the mechanism layer, which is the
# point — the belt runs whole *under* the machine, and only the four mouths stay
# visible in the flat sprite.
frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	offset=$((frame * STEP))
	belt_cell "$frame" "$offset" 0
	belt_cell "$frame" "$offset" "$CELL"
	frame=$((frame + 1))
done

# ── Pass 2: the mechanism layers, over the belt bed ────────────────────────────
#
# Register the two sheet-wide layers above the belt log (z 0 then z 1, so the
# shuttle rides above the housing), then paint them. `mechanism` is static;
# `shuttle` is painted once and animated.
draw-sheet register-layer --name mechanism --x 0 --y 0 --width 32 --height 64 --z 0
draw-sheet register-layer --name shuttle --x 0 --y 0 --width 32 --height 64 --z 1

draw_mechanism
draw_shuttle

# The shuttle parks at the top lane in frame 0, reaches the bottom lane by frame 4
# and climbs back, so frame 7 hands to frame 0 with no jump. The eight stops are
# all distinct — the descent and the climb are eased slightly differently, which
# is what keeps the sweep from landing twice on the same row and collapsing into a
# jitter between a handful of spots.
shuttle_to 0 2
shuttle_to 1 14
shuttle_to 2 28
shuttle_to 3 43
shuttle_to 4 55
shuttle_to 5 47
shuttle_to 6 32
shuttle_to 7 16
