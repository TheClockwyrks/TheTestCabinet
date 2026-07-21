#!/bin/sh
# Reference implementation — Lattice Inserter (variant `base`).
#
# Draws the twelve-frame swing sheet with `draw-sheet`, one operation at a time,
# exactly as a model would. Run from a seeded asset workspace (see
# `tcab publish-reference`): `draw.config.json`, the empty per-frame action logs,
# and the blank previews are already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The whole sheet is generated from one geometric model rather than twelve
# hand-placed poses: the hand travels a foreshortened circle on the ground plane
# and every frame is that circle sampled at an even angular step. That is what
# makes the twelve frames read as one mechanism instead of twelve drawings, and
# it makes the seamless loop a property of the construction rather than something
# to eyeball at the end.

set -eu

# --- The swing's geometry ------------------------------------------------------
#
# The 64x64 box is a 2x2-tile span (32 px per tile). The mount stands on the
# centre of the box; the pickup tile is the left half and the drop tile the right
# half, both lying flat on the floor beside it.
#
# The hand's path is a circle drawn on the FLOOR, centred on the mount's
# footprint. Seen from the high-angle camera that ground circle projects to an
# ellipse — full width east-west, squashed north-south — so REACH_Y is smaller
# than REACH_X. That squash is the whole pseudo-3D read: a circle with
# REACH_Y == REACH_X would be a camera looking straight down, and a path with
# REACH_Y == 0 would be a flat side-on slide. The arm bows through the FAR (top)
# side of the centre tile at mid-swing because screen-up is north on the floor.
PIVOT_X=32 # the hinge, on the mount's lit top face
PIVOT_Y=29
FLOOR_X=32 # the mount's footprint on the floor: centre of the ground ellipse
FLOOR_Y=35
REACH_X=19 # semi-axis along the tile row, reaching into both worked tiles
REACH_Y=14 # foreshortened semi-axis toward the far side of the centre tile

# Height above the floor is drawn as a vertical offset between the hand and its
# contact shadow, never as the arm climbing the screen. The lift is smallest at
# the two tiles (the claw is down at floor level to grip and to release) and
# largest at mid-swing, where the arm is carrying the item over the belt.
LIFT_MIN=3
LIFT_RISE=3

# Six angular samples per stroke, an even 36 degrees apart, swept twice: frames
# 0-5 run the delivery stroke from the left tile to the right, frames 6-11 the
# return stroke back. Frames 5/6 share the drop position (closing on the release)
# and frames 11/0 share the pickup position (closing on the grip), which is
# exactly the dwell the brief's frame table asks for — and it is what lets frame
# 11 hand back to frame 0 with no jump and no backward slip.
STROKE_STEPS=6

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
BASE_HI='#6a7884'
BASE_MID='#4d5a64'
BASE_LO='#36424b'
AMBER='#e6b329'
AMBER_HI='#f6d96b'
AMBER_LO='#b88410'

# --- Integer helpers -----------------------------------------------------------
#
# `draw-sheet` takes only integers, so the trigonometry is done in milli-units
# and rounded once at the end. Shell functions cannot return numbers, so each of
# these sets a global.

# Cosine and sine of `$1 * 36` degrees, in thousandths. Six samples is all the
# swing needs, so they are tabulated rather than approximated.
trig() {
	case $1 in
	0) COS_M=1000 SIN_M=0 ;;
	1) COS_M=809 SIN_M=588 ;;
	2) COS_M=309 SIN_M=951 ;;
	3) COS_M=-309 SIN_M=951 ;;
	4) COS_M=-809 SIN_M=588 ;;
	5) COS_M=-1000 SIN_M=0 ;;
	esac
}

# Divide by 1000, rounding to nearest and away from zero, so the arc is
# symmetric about the centre instead of drifting one way from truncation.
rdiv() {
	if [ "$1" -ge 0 ]; then
		RDIV=$((($1 + 500) / 1000))
	else
		RDIV=$((($1 - 500) / 1000))
	fi
}

abs() { if [ "$1" -lt 0 ]; then ABS=$((0 - $1)); else ABS=$1; fi; }

# Integer square root by trial multiplication — enough for the arm's length,
# which is never more than the frame's diagonal.
isqrt() {
	ISQRT=0
	while [ $(((ISQRT + 1) * (ISQRT + 1))) -le "$1" ]; do
		ISQRT=$((ISQRT + 1))
	done
}

# --- The mount -----------------------------------------------------------------
#
# Identical in every frame, drawn from the same constants every time, so the base
# cannot jitter: it is the still anchor the swing rotates around. Built the way
# the assembler shows height under this camera — a floor contact shadow, a dark
# keyline, beveled sides in the mid tone, a darker front face and a lighter top
# face catching the overhead light.
mount() {
	frame=$1
	# A squat block, wider than it is tall: under this camera a floor-mounted box
	# shows mostly its top face and only a shallow band of its near side. Keeping
	# it low also leaves the floor north of it clear, so the hand's shadow has
	# somewhere to sit at mid-swing instead of merging into the mount's outline.
	#
	# Contact shadow on the floor, offset toward the near (bottom) side.
	draw-sheet fill-rect --frame "$frame" --x 25 --y 37 --width 15 --height 2 --color "$OUTLINE"
	draw-sheet stroke-rect --frame "$frame" --x 24 --y 25 --width 16 --height 12 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 25 --y 26 --width 14 --height 10 --color "$BASE_MID"
	# The near face falls away from the light; the top face catches it.
	draw-sheet fill-rect --frame "$frame" --x 25 --y 32 --width 14 --height 4 --color "$BASE_LO"
	draw-sheet fill-rect --frame "$frame" --x 26 --y 26 --width 12 --height 6 --color "$BASE_HI"
	# The top face's own bevel, falling away from the light on the far side.
	draw-sheet fill-rect --frame "$frame" --x 37 --y 26 --width 1 --height 6 --color "$BASE_MID"
	draw-sheet fill-rect --frame "$frame" --x 26 --y 31 --width 12 --height 1 --color "$BASE_MID"
	# The hinge itself, so the eye can find the centre the arm turns about.
	draw-sheet stroke-circle --frame "$frame" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 3 --color "$BASE_LO"
	draw-sheet fill-circle --frame "$frame" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 2 --color "$BASE_MID"
}

# --- One frame of the swing ----------------------------------------------------
#
# $1 frame index, $2 angular sample 0-5 (0 = right/drop, 5 = left/pickup),
# $3 claw state (`closed` on the delivery stroke, `open` on the return).
pose() {
	frame=$1
	sample=$2
	grip=$3

	trig "$sample"

	# Where the hand is standing on the floor: the ground ellipse at this angle.
	rdiv $((REACH_X * COS_M))
	ground_x=$((FLOOR_X + RDIV))
	rdiv $((REACH_Y * SIN_M))
	ground_y=$((FLOOR_Y - RDIV))

	# How far it is held above that spot. sin is 0 at both tiles and 1 at
	# mid-swing, so the same term that bows the arc also raises the arm.
	rdiv $((LIFT_RISE * SIN_M))
	lift=$((LIFT_MIN + RDIV))
	hand_x=$ground_x
	hand_y=$((ground_y - lift))

	# The arm's direction, from the hinge out to the hand.
	dx=$((hand_x - PIVOT_X))
	dy=$((hand_y - PIVOT_Y))
	abs "$dx"
	adx=$ABS
	abs "$dy"
	ady=$ABS

	# The unit vector along the arm, in thousandths, and the unit vector across
	# it. The claw is built from these rather than from a direction snapped to
	# the eight compass points: the ellipse does not advance the arm by an even
	# angle in SCREEN space (it is fastest across the middle and slowest at the
	# two tiles), so snapping leaves the claw pointing up to 25 degrees off the
	# limb it is supposed to be the end of — visibly a claw stuck onto an arm
	# instead of the arm's own hand.
	isqrt $((dx * dx + dy * dy))
	arm_len=$ISQRT
	unit_x=$((dx * 1000 / arm_len))
	unit_y=$((dy * 1000 / arm_len))
	perp_x=$((0 - unit_y))
	perp_y=$unit_x

	# 1. The contact shadow tracking on the floor beneath the hand. Drawn first
	#    so the arm and claw sit over it, and kept solid — no softening.
	draw-sheet fill-rect --frame "$frame" --x="$((ground_x - 1))" --y="$ground_y" \
		--width 3 --height 2 --color "$OUTLINE"

	# 2. The mount. After the shadow, before the arm, so the arm reads as
	#    springing from the hinge on top of it.
	mount "$frame"

	# 3. The arm: a slender three-row limb from the hinge out to the hand. The
	#    flanking rows are offset across the limb — vertically when it lies along
	#    the tile row, horizontally when it stands closer to north-south — with
	#    the highlight on the side facing the overhead light (up and to the left)
	#    and the shadow tone opposite, so the limb reads as round and raised
	#    rather than as a flat stripe on the floor.
	#
	#    All three rows run between the SAME two endpoints, offset by one pixel.
	#    That matters: a rasterized line offset by a whole pixel is exactly the
	#    offset of the original, so the rows stack without gaps. Giving the
	#    flanking rows their own shorter endpoints — to taper the limb — rasterizes
	#    a slightly different slope and punches transparent holes through the
	#    middle of the arm at the rows where the two steppings disagree. The taper
	#    instead comes from the wider shoulder hub below narrowing to the wrist.
	if [ "$adx" -ge "$ady" ]; then
		hi_dx=0 hi_dy=-1
	else
		hi_dx=-1 hi_dy=0
	fi
	draw-sheet line --frame "$frame" \
		--x0="$((PIVOT_X + hi_dx))" --y0="$((PIVOT_Y + hi_dy))" \
		--x1="$((hand_x + hi_dx))" --y1="$((hand_y + hi_dy))" --color "$AMBER_HI"
	draw-sheet line --frame "$frame" \
		--x0="$((PIVOT_X - hi_dx))" --y0="$((PIVOT_Y - hi_dy))" \
		--x1="$((hand_x - hi_dx))" --y1="$((hand_y - hi_dy))" --color "$AMBER_LO"
	draw-sheet line --frame "$frame" --x0="$PIVOT_X" --y0="$PIVOT_Y" \
		--x1="$hand_x" --y1="$hand_y" --color "$AMBER"

	# 4. The shoulder hub, sitting inside the mount's socket ring so the dark ring
	#    survives as a collar around it: the widest point of the limb, and the one
	#    piece of the arm that is in the same place in every frame.
	draw-sheet fill-circle --frame "$frame" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 2 --color "$AMBER"
	draw-sheet set-pixel --frame "$frame" --x="$((PIVOT_X - 1))" --y="$((PIVOT_Y - 1))" \
		--color "$AMBER_HI"
	draw-sheet set-pixel --frame "$frame" --x="$((PIVOT_X + 1))" --y="$((PIVOT_Y + 1))" \
		--color "$AMBER_LO"

	# 5. The wrist knuckle the two prongs hang off.
	draw-sheet fill-rect --frame "$frame" --x="$((hand_x - 1))" --y="$((hand_y - 1))" \
		--width 3 --height 3 --color "$AMBER"
	draw-sheet set-pixel --frame "$frame" --x="$((hand_x - 1))" --y="$((hand_y - 1))" \
		--color "$AMBER_HI"

	# 6. The claw: two prongs rooted a pixel either side of the wrist — so they
	#    always grow out of the knuckle rather than floating beside it — reaching
	#    outward along the arm's own direction. The only thing that changes
	#    between the two strokes is where their tips land:
	#
	#      closed — a short head whose prongs stay parallel a pixel apart, a
	#               compact grip with a narrow slot left between them for the
	#               renderer to draw the cargo into;
	#      open   — a pixel longer and splayed three either side, six pixels
	#               across: an unmistakable empty fork.
	#
	#    No item is ever drawn here; the sprite is item-agnostic.
	if [ "$grip" = closed ]; then
		tip_reach=3 tip_spread=1
	else
		tip_reach=4 tip_spread=3
	fi
	rdiv "$unit_x"
	claw_root_x=$((hand_x + RDIV))
	rdiv "$unit_y"
	claw_root_y=$((hand_y + RDIV))
	rdiv $((unit_x * tip_reach))
	claw_tip_x=$((hand_x + RDIV))
	rdiv $((unit_y * tip_reach))
	claw_tip_y=$((hand_y + RDIV))
	rdiv "$perp_x"
	root_off_x=$RDIV
	rdiv "$perp_y"
	root_off_y=$RDIV
	rdiv $((perp_x * tip_spread))
	tip_off_x=$RDIV
	rdiv $((perp_y * tip_spread))
	tip_off_y=$RDIV

	# The prong on the lit side takes the highlight; the other stays on the base
	# amber rather than dropping to the shadow tone, which at one pixel wide on a
	# transparent background would swallow the prong and leave the open claw
	# looking like a single hook instead of a fork.
	if [ "$perp_y" -lt 0 ] || { [ "$perp_y" -eq 0 ] && [ "$perp_x" -lt 0 ]; }; then
		near_color=$AMBER_HI far_color=$AMBER
	else
		near_color=$AMBER far_color=$AMBER_HI
	fi
	draw-sheet line --frame "$frame" \
		--x0="$((claw_root_x + root_off_x))" --y0="$((claw_root_y + root_off_y))" \
		--x1="$((claw_tip_x + tip_off_x))" --y1="$((claw_tip_y + tip_off_y))" \
		--color "$near_color"
	draw-sheet line --frame "$frame" \
		--x0="$((claw_root_x - root_off_x))" --y0="$((claw_root_y - root_off_y))" \
		--x1="$((claw_tip_x - tip_off_x))" --y1="$((claw_tip_y - tip_off_y))" \
		--color "$far_color"
}

# --- The cycle -----------------------------------------------------------------
#
# Delivery stroke: from the left pickup (sample 5) to the right drop (sample 0),
# claw closed the whole way across.
frame=0
while [ "$frame" -lt "$STROKE_STEPS" ]; do
	pose "$frame" $((STROKE_STEPS - 1 - frame)) closed
	frame=$((frame + 1))
done

# Return stroke: back along the identical arc from the drop to the pickup, claw
# open and empty. Reusing the same samples in reverse is what guarantees the two
# halves trace one path and the cycle closes exactly where it began.
while [ "$frame" -lt $((STROKE_STEPS * 2)) ]; do
	pose "$frame" $((frame - STROKE_STEPS)) open
	frame=$((frame + 1))
done
