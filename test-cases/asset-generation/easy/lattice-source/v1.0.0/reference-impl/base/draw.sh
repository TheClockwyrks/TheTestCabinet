#!/bin/sh
# Reference implementation — Lattice Source (variant `base`).
#
# Draws the six-frame East-emitting source fixture with `draw-sheet`, one
# operation at a time, exactly as a model would. Run from a seeded asset
# workspace (see `tcab publish-reference`): `draw.config.json`, the empty
# per-frame action logs, and the blank previews are already in place, so this
# script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.

set -eu

# --- The fixture's fixed geometry ----------------------------------------------
#
# The source is a sealed housing inset by an even margin on all four sides, with
# one hole in it: the output chute cut through the East wall. Everything is
# expressed against those two numbers so the housing stays centered and the chute
# stays on the tile's horizontal centre line.
FRAMES=6

MARGIN=2                        # even margin on all four sides
HOUSE_X=$MARGIN                 # housing outline, left column
HOUSE_Y=$MARGIN                 # housing outline, top row
HOUSE_W=$((32 - 2 * MARGIN))    # 28 — most of the tile, clipping no edge
HOUSE_H=$HOUSE_W                # square: this fixture occupies one whole cell
FACE_X=$((HOUSE_X + 1))         # panel face, inside the outline
FACE_Y=$((HOUSE_Y + 1))
FACE_W=$((HOUSE_W - 2))
FACE_H=$((HOUSE_H - 2))

# The chute is aligned to the transport belt this source feeds. The belt tile
# carries its rails on rows 0-1 and 30-31 and its conveyor surface on rows 4-27,
# so a belt item rides centred on the seam between rows 15 and 16. The chute's
# lit throat is that seam plus a few rows either side, and the emitted plate is
# centred on it, so a plate leaving this tile lands exactly on the belt surface
# of the tile to its East.
CHUTE_Y=12                      # upper lip (the framed rim)
CHUTE_H=8                       # lip to lip inclusive: rows 12-19
THROAT_Y=$((CHUTE_Y + 1))       # 13 — first lit row
THROAT_H=$((CHUTE_H - 2))       # 6 — rows 13-18, centred on the 15/16 seam
CHUTE_X=20                      # where the chute is cut into the panel face
CHUTE_W=$((32 - CHUTE_X))       # 12 — the chute runs out through the East edge
# The throat is lit as a glow rather than a flat fill: its two outer rows take a
# step-down tone from the four inner rows, so the port reads as light spilling out
# of a recess instead of a green rectangle pasted on the housing.
CORE_Y=$((THROAT_Y + 1))        # 14
CORE_H=$((THROAT_H - 2))        # 4 — rows 14-17
# The two deepest columns of the chute stay at the outline tone in every frame:
# that is the unlit interior of the machine, and it is what the plate emerges
# *from*. Redrawn after the plate, it also occludes the plate's West end on the
# frame the plate first appears, so the item reads as sliding out of the fixture
# rather than blinking into existence.
GULLET_W=2
# Beyond the housing wall the chute narrows to a nozzle exactly as tall as the
# plate: the slot inside the machine is a recess, the bit sticking out past the
# wall is a spout. Without this the chute reads as one flat green tab glued to the
# side of the panel.
NOZZLE_X=$((HOUSE_X + HOUSE_W - 1)) # 29 — the housing's East outline column
NOZZLE_W=$((32 - NOZZLE_X))         # 3 — out to the tile edge

# The emitted plate: a small steel rectangle centred on the belt seam, stepping
# East by a constant stride so the slide is unmistakable and even.
PLATE_W=5
PLATE_H=$CORE_H                     # 4 — exactly the throat's bright core, so the
PLATE_Y=$CORE_Y                     #     glow reads as spilling around the item
PLATE_X0=$((CHUTE_X + 1))           # 21 — still mostly behind the gullet
PLATE_STEP=4                        # 21 -> 25 -> 29: visible 3px, 5px, 3px

# The status lamp, set into the upper-left of the panel face — diagonally
# opposite the chute, so the fixture's two signals never crowd each other.
LAMP_CX=9
LAMP_CY=9
LAMP_R=2

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
H_LIGHT='#6a7884'
H_MID='#4d5a64'
H_DARK='#36424b'
ACC_MID='#46c46a'
ACC_DARK='#2f8f4c'
ACC_PALE='#8ff0a5'
PLATE='#b9c0cb'
PLATE_HI='#e3e8ef'

# A filled octagon of "radius" $4 centred on ($2,$3) of frame $1 — a square with
# its four corners cut off, drawn as two crossed rectangles.
octagon() {
	span=$((2 * $4 + 1))
	draw-sheet fill-rect --frame "$1" --x="$(($2 - $4))" --y="$(($3 - $4 + 1))" \
		--width "$span" --height "$((span - 2))" --color "$5"
	draw-sheet fill-rect --frame "$1" --x="$(($2 - $4 + 1))" --y="$(($3 - $4))" \
		--width "$((span - 2))" --height "$span" --color "$5"
}

# A mounting bolt at ($2,$3) of frame $1: a 2x2 dark head with a single light
# pixel for the glint off its top-left. Four of these at the panel's corners are
# most of what separates "bolted-down instrument" from "flat rectangle".
bolt() {
	draw-sheet fill-rect --frame "$1" --x="$2" --y="$3" \
		--width 2 --height 2 --color "$OUTLINE"
	draw-sheet set-pixel --frame "$1" --x="$2" --y="$3" --color "$H_LIGHT"
}

# The parts of the fixture that never move: the housing, its bevel, the bolts,
# the gauge panel and the vent louvres. Redrawn per frame because each frame is
# its own independent image.
housing() {
	frame=$1

	# 1. The panel face, then the bevel: a light top and left edge against a dark
	#    bottom and right edge. Two lines of shading are all it takes to lift a
	#    flat fill into a box with a lit top-left.
	draw-sheet fill-rect --frame "$frame" --x "$FACE_X" --y "$FACE_Y" \
		--width "$FACE_W" --height "$FACE_H" --color "$H_MID"
	draw-sheet fill-rect --frame "$frame" --x "$FACE_X" --y "$FACE_Y" \
		--width "$FACE_W" --height 1 --color "$H_LIGHT"
	draw-sheet fill-rect --frame "$frame" --x "$FACE_X" --y "$FACE_Y" \
		--width 1 --height "$FACE_H" --color "$H_LIGHT"
	draw-sheet fill-rect --frame "$frame" --x "$FACE_X" --y "$((FACE_Y + FACE_H - 1))" \
		--width "$FACE_W" --height 1 --color "$H_DARK"
	draw-sheet fill-rect --frame "$frame" --x "$((FACE_X + FACE_W - 1))" --y "$FACE_Y" \
		--width 1 --height "$FACE_H" --color "$H_DARK"

	# 2. The outline around the whole housing, drawn last of the body so the bevel
	#    cannot bleed past it. This is the edge that makes the fixture read as an
	#    object sitting on the ground rather than a patch of floor.
	draw-sheet stroke-rect --frame "$frame" --x "$HOUSE_X" --y "$HOUSE_Y" \
		--width "$HOUSE_W" --height "$HOUSE_H" --color "$OUTLINE"

	# 3. The gauge: a recessed dark panel with a row of light graduations. This is
	#    the single detail that says "measurement rig" rather than "assembler". It
	#    is sized to leave a clear column of panel either side of it, between the
	#    lamp and the East bolt — run flush against either and the three details
	#    fuse into one black smear across the top of the housing.
	draw-sheet fill-rect --frame "$frame" --x 14 --y 5 --width 11 --height 5 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 15 --y 6 --width 9 --height 3 --color "$H_DARK"
	for tick in 16 19 22; do
		draw-sheet line --frame "$frame" --x0="$tick" --y0 6 --x1="$tick" --y1 8 \
			--color "$H_LIGHT"
	done

	# 4. Vent louvres across the lower face: two dark slots with a light lip under
	#    each, which is what reads as a recess rather than a scratch.
	for vent in 23 26; do
		draw-sheet line --frame "$frame" --x0 9 --y0="$vent" --x1 22 --y1="$vent" \
			--color "$H_DARK"
		draw-sheet line --frame "$frame" --x0 9 --y0="$((vent + 1))" --x1 22 \
			--y1="$((vent + 1))" --color "$H_LIGHT"
	done

	# 5. The four mounting bolts, one per corner of the face.
	bolt "$frame" 4 4
	bolt "$frame" 26 4
	bolt "$frame" 4 26
	bolt "$frame" 26 26
}

# The machine's interior: the two deepest throat columns, always at the outline
# tone. Called by both `aperture` and `plate` so it is always the last thing
# painted over that strip.
gullet() {
	draw-sheet fill-rect --frame "$1" --x "$CHUTE_X" --y "$THROAT_Y" \
		--width "$GULLET_W" --height "$THROAT_H" --color "$OUTLINE"
}

# The output chute at charge level $2 (0 = idle, 4 = peak). The chute is one
# shape in every frame — only its two colors change — so the fixture itself never
# moves; what animates is the light inside it.
#
# The ladder is deliberately four steps rather than three: it separates the
# charging frame from the dim-down frame, which would otherwise be identical
# images and would read as a stutter in the loop.
aperture() {
	frame=$1
	case $2 in
	0) edge=$H_DARK; core=$H_DARK ;;      # idle: an unlit recess
	1) edge=$H_DARK; core=$ACC_DARK ;;    # afterglow, deep inside only
	2) edge=$ACC_DARK; core=$ACC_MID ;;   # charging
	3) edge=$ACC_MID; core=$ACC_MID ;;    # dimming from peak
	*) edge=$ACC_MID; core=$ACC_PALE ;;   # peak
	esac

	# The lit throat first, then the chute's dark lips over it. The lips never
	# change color: an aperture that loses its frame when it lights up stops
	# reading as a hole cut into the housing and starts reading as a sticker on
	# top of it. Everything runs out through the East edge, so the chute is an open
	# mouth rather than a window and the plate has somewhere to go.
	draw-sheet fill-rect --frame "$frame" --x "$CHUTE_X" --y "$THROAT_Y" \
		--width "$CHUTE_W" --height "$THROAT_H" --color "$edge"
	draw-sheet fill-rect --frame "$frame" --x "$CHUTE_X" --y "$CORE_Y" \
		--width "$CHUTE_W" --height "$CORE_H" --color "$core"
	draw-sheet fill-rect --frame "$frame" --x "$CHUTE_X" --y "$CHUTE_Y" \
		--width "$CHUTE_W" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x "$CHUTE_X" --y "$((CHUTE_Y + CHUTE_H - 1))" \
		--width "$CHUTE_W" --height 1 --color "$OUTLINE"
	# The nozzle lips, pinching the opening down to the plate's own height for the
	# three columns that project past the housing wall.
	draw-sheet fill-rect --frame "$frame" --x "$NOZZLE_X" --y "$THROAT_Y" \
		--width "$NOZZLE_W" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x "$NOZZLE_X" --y "$((THROAT_Y + THROAT_H - 1))" \
		--width "$NOZZLE_W" --height 1 --color "$OUTLINE"
	gullet "$frame"
}

# The status lamp at brightness $2 (0 = idle, 3 = peak): a dark socket with the
# green accent set into it. Green is this fixture's whole identity — it is the
# only hue on the sprite, and the reason it can never be mistaken for the red
# sink it feeds.
lamp() {
	frame=$1
	case $2 in
	0) glass=$ACC_DARK ;;
	1) glass=$ACC_MID ;;
	2) glass=$ACC_MID ;;
	*) glass=$ACC_PALE ;;
	esac

	# An octagon rather than `fill-circle`: at radius 2-3 a true disc rasterizes to
	# a diamond, which reads as a gemstone. Two crossed rectangles give the blunt
	# corners that read as a round lamp at this size.
	octagon "$frame" "$LAMP_CX" "$LAMP_CY" "$((LAMP_R + 1))" "$OUTLINE"
	octagon "$frame" "$LAMP_CX" "$LAMP_CY" "$LAMP_R" "$glass"
	# From half brightness up the lamp catches a specular glint on its upper-left,
	# the same corner the housing bevel is lit from.
	if [ "$2" -ge 2 ]; then
		draw-sheet set-pixel --frame "$frame" --x "$((LAMP_CX - 1))" \
			--y "$((LAMP_CY - 1))" --color "$ACC_PALE"
	fi
}

# The emitted steel plate, left edge at column $2 of frame $1: highlight along
# the top and left edges it is lit from, outline along the bottom and right so it
# stays legible against the lit throat behind it. Columns past the East edge are
# clipped by the binary, which is what lets the plate walk off the tile.
plate() {
	frame=$1
	x=$2
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$PLATE_Y" \
		--width "$PLATE_W" --height "$PLATE_H" --color "$PLATE"
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$PLATE_Y" \
		--width "$PLATE_W" --height 1 --color "$PLATE_HI"
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$PLATE_Y" \
		--width 1 --height "$PLATE_H" --color "$PLATE_HI"
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$((PLATE_Y + PLATE_H - 1))" \
		--width "$PLATE_W" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x="$((x + PLATE_W - 1))" --y "$PLATE_Y" \
		--width 1 --height "$PLATE_H" --color "$OUTLINE"
	# Re-assert the machine's interior over the plate: the plate slides out from
	# behind it.
	gullet "$frame"
}

# --- The emit pulse ------------------------------------------------------------
#
# One item per cycle. The charge rises across 0-2, the plate is pushed out over
# 2-4 at a constant stride, and the light falls back across 4-5 to a level just
# above idle so frame 5 eases into frame 0 instead of snapping to it.
#
#   frame | chute | lamp | plate
#   ------+-------+------+-------------------------------
#     0   |   0   |  0   | -            idle, the rest state
#     1   |   2   |  1   | -            charging
#     2   |   4   |  3   | 21           peak; plate emerging from the gullet
#     3   |   4   |  3   | 25           plate clear of the housing wall
#     4   |   3   |  2   | 29           plate leaving the tile; light easing off
#     5   |   1   |  1   | -            emitted; afterglow only
frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	housing "$frame"
	case "$frame" in
	0)
		aperture "$frame" 0
		lamp "$frame" 0
		;;
	1)
		aperture "$frame" 2
		lamp "$frame" 1
		;;
	2)
		aperture "$frame" 4
		lamp "$frame" 3
		plate "$frame" "$PLATE_X0"
		;;
	3)
		aperture "$frame" 4
		lamp "$frame" 3
		plate "$frame" "$((PLATE_X0 + PLATE_STEP))"
		;;
	4)
		aperture "$frame" 3
		lamp "$frame" 2
		plate "$frame" "$((PLATE_X0 + 2 * PLATE_STEP))"
		;;
	5)
		aperture "$frame" 1
		lamp "$frame" 1
		;;
	esac
	frame=$((frame + 1))
done
