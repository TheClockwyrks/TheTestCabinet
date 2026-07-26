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
# hand-placed poses: the gripper travels a FIXED-RADIUS circle around the pivot,
# and every frame is that circle sampled at an even angular step. Because the
# radius never changes, the item's grip point is a constant distance from the
# pivot in every frame — so the renderer can place the carried item from the
# swing angle alone. That is what makes the twelve frames read as one mechanism,
# and it makes the seamless loop a property of the construction.
#
# The view is FLAT and top-down: no faux-3D height, no cast shadow, no arm
# climbing the screen. The pivot sits at the centre of the box; the pickup tile
# is the left half and the drop tile the right half. The gripper sweeps the upper
# semicircle — left, up and over the far side of the centre tile, then right —
# which is the arc across the floor the brief asks for.

set -eu

# --- The swing's geometry ------------------------------------------------------
#
# The 64x64 box is a 2x2-tile span (32 px per tile). The pivot is dead centre.
PIVOT_X=32
PIVOT_Y=34
GRIP_R=18            # fixed radius from pivot to the item's grip point
SLOT_HALF=8          # the reserved item slot is ~16x16 (2*SLOT_HALF) centred on
                     # the grip point; the gripper cups it and never buries the
                     # open/closed tell inside it.

# Six angular samples per stroke, an even 36 degrees apart, swept twice: frames
# 0-5 run the delivery stroke from the left pickup (sample 5) to the right drop
# (sample 0), frames 6-11 the return back. Reusing the same samples in reverse is
# what guarantees the two halves trace one path and the loop closes exactly.
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

# Divide by 1000, rounding to nearest and away from zero, so the arc is symmetric
# about the centre instead of drifting one way from truncation.
rdiv() {
	if [ "$1" -ge 0 ]; then
		RDIV=$((($1 + 500) / 1000))
	else
		RDIV=$((($1 - 500) / 1000))
	fi
}

# --- The mount -----------------------------------------------------------------
#
# Identical in every frame, drawn from the same constants every time, so the base
# cannot jitter: it is the still anchor the swing rotates around. Drawn FLAT — a
# top-down grey-blue block with a light top-left edge and a dark bottom-right one
# for definition, not a raised box with a cast shadow.
mount() {
	frame=$1
	# A compact 11x11 block, kept small so the arm shows well past it at every
	# angle. Its outline is drawn last so the fill cannot bleed past it.
	draw-sheet fill-rect --frame "$frame" --x 27 --y 29 --width 11 --height 11 --color "$BASE_MID"
	# Flat edge definition: light on the top and left, dark on the bottom and right.
	draw-sheet fill-rect --frame "$frame" --x 27 --y 29 --width 11 --height 1 --color "$BASE_HI"
	draw-sheet fill-rect --frame "$frame" --x 27 --y 29 --width 1 --height 11 --color "$BASE_HI"
	draw-sheet fill-rect --frame "$frame" --x 27 --y 39 --width 11 --height 1 --color "$BASE_LO"
	draw-sheet fill-rect --frame "$frame" --x 37 --y 29 --width 1 --height 11 --color "$BASE_LO"
	draw-sheet stroke-rect --frame "$frame" --x 27 --y 29 --width 11 --height 11 --color "$OUTLINE"
	# The hinge, so the eye can find the centre the arm turns about.
	draw-sheet fill-circle --frame "$frame" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 3 --color "$BASE_LO"
	draw-sheet fill-circle --frame "$frame" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 2 --color "$OUTLINE"
}

# --- Local-frame point ---------------------------------------------------------
#
# A point at (t along the arm, s across it), given the current sample's unit
# vector. unit = (COS, -SIN) points from the pivot toward the grip; perp =
# (SIN, COS) is 90 degrees across it. Sets PX, PY.
pt() {
	t=$1
	s=$2
	rdiv $((t * COS_M + s * SIN_M))
	PX=$((PIVOT_X + RDIV))
	rdiv $((t * -SIN_M + s * COS_M))
	PY=$((PIVOT_Y + RDIV))
}

# A line between two local-frame points (t0,s0)-(t1,s1) in colour $5.
seg() {
	pt "$1" "$2"
	x0=$PX
	y0=$PY
	pt "$3" "$4"
	draw-sheet line --frame "$FRAME" --x0="$x0" --y0="$y0" --x1="$PX" --y1="$PY" --color "$5"
}

# --- One frame of the swing ----------------------------------------------------
#
# $1 frame index, $2 angular sample 0-5 (0 = right/drop, 5 = left/pickup),
# $3 grip state (`closed` on the delivery stroke, `open` on the return).
pose() {
	FRAME=$1
	trig "$2"
	grip=$3

	# The mount first, so the arm reads as springing from the hinge on top of it.
	mount "$FRAME"

	# 1. The arm: a three-row amber limb from the hinge out to the wrist at the
	#    slot's near edge. The highlight row rides the lit (up-left) side, the
	#    shadow row the other, so the limb reads as a round raised bar rather than
	#    a flat stripe. All three run parallel across the arm (constant s), which
	#    keeps them gap-free at every angle.
	WT=$((GRIP_R - SLOT_HALF))   # wrist, at the near edge of the item slot
	seg 0 -1 "$WT" -1 "$AMBER_HI"
	seg 0 1 "$WT" 1 "$AMBER_LO"
	seg 0 0 "$WT" 0 "$AMBER"

	# 2. The shoulder hub at the hinge — the widest point of the limb, in the same
	#    place every frame — and the wrist knuckle the jaws hang off.
	draw-sheet fill-circle --frame "$FRAME" --cx "$PIVOT_X" --cy "$PIVOT_Y" --r 2 --color "$AMBER"
	draw-sheet set-pixel --frame "$FRAME" --x="$((PIVOT_X - 1))" --y="$((PIVOT_Y - 1))" --color "$AMBER_HI"
	pt "$WT" 0
	draw-sheet fill-circle --frame "$FRAME" --cx "$PX" --cy "$PY" --r 1 --color "$AMBER"

	# 3. The gripper: two curved jaws, one either side, that bow OUT to the item
	#    slot's edges at their widest and then close back over its far end. They
	#    cup the 16x16 slot without crossing its centre, so an item drawn into the
	#    slot sits cradled between them. What tells holding from empty happens at
	#    the jaw TIPS, at or beyond the slot's far edge — never inside it, so the
	#    item can never hide it:
	#
	#      closed — the two tips curl inward and nearly meet just past the far
	#               edge, cupping the top of whatever is held;
	#      open   — the two tips flare outward past the slot's sides, an
	#               unmistakable empty fork.
	#
	#    No item is ever drawn here; the sprite is item-agnostic and the renderer
	#    supplies the cargo for the delivery stroke.
	wide=$GRIP_R                        # the jaws' widest point, at the slot's side
	far=$((GRIP_R + SLOT_HALF))         # the slot's far edge
	# each jaw bows from the wrist out to the slot's side (drawn twice, one row
	# apart, so the jaw reads as a solid 2px claw rather than a thread)
	jaw() { # sgn tipT tipS color
		seg "$WT" 0 "$wide" "$(($1 * SLOT_HALF))" "$4"
		seg "$WT" "$1" "$wide" "$(($1 * (SLOT_HALF - 1)))" "$4"
		seg "$wide" "$(($1 * SLOT_HALF))" "$2" "$(($1 * $3))" "$4"
		seg "$wide" "$(($1 * (SLOT_HALF - 1)))" "$2" "$(($1 * ($3 - 1)))" "$4"
	}
	if [ "$grip" = closed ]; then
		jaw 1 "$((far + 1))" 2 "$AMBER_HI"     # lit jaw, curling in to the far centre
		jaw -1 "$((far + 1))" 2 "$AMBER"       # shadow-side jaw
	else
		jaw 1 "$far" "$((SLOT_HALF + 4))" "$AMBER_HI"   # lit jaw, splayed out
		jaw -1 "$far" "$((SLOT_HALF + 4))" "$AMBER"     # shadow-side jaw
	fi
}

# --- The cycle -----------------------------------------------------------------
#
# Delivery stroke: from the left pickup (sample 5) to the right drop (sample 0),
# gripper closed and holding the whole way across.
frame=0
while [ "$frame" -lt "$STROKE_STEPS" ]; do
	pose "$frame" $((STROKE_STEPS - 1 - frame)) closed
	frame=$((frame + 1))
done

# Return stroke: back along the identical arc from the drop to the pickup,
# gripper open and empty.
while [ "$frame" -lt $((STROKE_STEPS * 2)) ]; do
	pose "$frame" $((frame - STROKE_STEPS)) open
	frame=$((frame + 1))
done
