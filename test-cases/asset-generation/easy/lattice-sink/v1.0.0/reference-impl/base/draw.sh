#!/bin/sh
# Reference implementation — Lattice Sink (variant `base`).
#
# Draws the six-frame West-receiving sink fixture with `draw-sheet`, one
# operation at a time, exactly as a model would. Run from a seeded asset
# workspace (see `tcab publish-reference`): `draw.config.json`, the empty
# per-frame action logs, and the blank previews are already in place, so this
# script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The sink is the Lattice source read backwards, and it is drawn that way on
# purpose: same housing, same bevel, same gauge, same bolts and louvres —
# mirrored left-to-right, lit red instead of green, and with the pulse running
# inward instead of outward. Placed side by side the two fixtures read as one
# pair of instruments, one at each end of a belt.
#
# No item is drawn: the sink consumes WHATEVER the factory sends it, and the
# renderer draws that item arriving and being swallowed at run time. A fixed
# item baked in would show the same cargo in every frame regardless of what is
# actually being consumed. So this sprite draws only the fixture and its
# reaction — a red intake flash at the throat and a pulsing lamp — timed as an
# item would arrive.

set -eu

# --- The fixture's fixed geometry ----------------------------------------------
#
# A sealed housing inset by an even margin on all four sides, with one hole in
# it: the intake throat cut through the West wall.
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

# The throat is aligned to the transport belt that feeds this sink. The belt tile
# carries its rails on rows 0-1 and 30-31 and its conveyor surface on rows 4-27,
# so a belt item rides centred on the seam between rows 15 and 16. The throat is
# that seam plus a few rows either side, so an item leaving the belt tile to the
# West enters this mouth exactly level.
THROAT_TOP=12                   # upper lip (the permanent dark frame)
THROAT_FRAME_H=8                # lip to lip inclusive: rows 12-19
MOUTH_Y=$((THROAT_TOP + 1))     # 13 — first lit row
MOUTH_H=$((THROAT_FRAME_H - 2)) # 6 — rows 13-18, centred on the 15/16 seam
MOUTH_X=0                       # the throat opens on the tile's West edge
MOUTH_W=12                      # and is cut 12 columns deep into the panel face
# The throat is lit as a glow rather than a flat fill: its two outer rows take a
# step-down tone from the four inner rows, so the intake reads as light welling up
# out of a recess instead of a red rectangle pasted on the housing.
CORE_Y=$((MOUTH_Y + 1))         # 14
CORE_H=$((MOUTH_H - 2))         # 4 — rows 14-17

# The deep (East) end of the throat stays at the outline tone in every frame:
# that is the unlit interior of the machine, where consumed items go. It is cut
# deeper than the source's matching gullet: an emitter only has to reveal an
# item, a drain has to hide one.
GULLET_W=3
GULLET_X=$((MOUTH_X + MOUTH_W - GULLET_W)) # 9 — rows 13-18 of columns 9-11
# West of the housing wall the throat narrows to a mouth, so the part projecting
# past the panel reads as an intake spout rather than a flat red tab glued to the
# side.
MOUTH_LIP_X=0
MOUTH_LIP_W=$((HOUSE_X + 1))    # 3 — columns 0-2, out to the tile edge

# The status lamp, set into the upper-right of the panel face — diagonally
# opposite the throat, so the fixture's two signals never crowd each other. This
# is the source's lamp mirrored: there it sits nearest the far wall from its
# chute, here nearest the far wall from its mouth.
LAMP_CX=22
LAMP_CY=9
LAMP_R=2

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
H_LIGHT='#6a7884'
H_MID='#4d5a64'
H_DARK='#36424b'
ACC_MID='#d6473a'
ACC_DARK='#99281f'
ACC_PALE='#f59a90'

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
	#    bottom and right edge. The bevel is deliberately *not* mirrored along with
	#    the layout — the light in this world comes from the top-left for every
	#    sprite, so mirroring it would light this fixture from the opposite side of
	#    the sky to the source and the belt it sits on.
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

	# 3. The counter: a recessed dark panel with a row of light graduations — this
	#    fixture's whole job is reading throughput, and this is the detail that says
	#    "measurement rig" rather than "crafting machine". This is the source's
	#    gauge mirrored about the tile's centre line, so it sits West of the lamp
	#    instead of East of it, with the same clear column of panel either side.
	draw-sheet fill-rect --frame "$frame" --x 7 --y 5 --width 11 --height 5 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 8 --y 6 --width 9 --height 3 --color "$H_DARK"
	for tick in 9 12 15; do
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

# The machine's interior: the deep end of the throat, always at the outline tone.
# Called last inside `aperture` so it is always painted over that strip — the
# unlit gullet the consumed item vanishes into.
gullet() {
	draw-sheet fill-rect --frame "$1" --x "$GULLET_X" --y "$MOUTH_Y" \
		--width "$GULLET_W" --height "$MOUTH_H" --color "$OUTLINE"
}

# The intake throat at flash level $2 (0 = idle, 4 = peak). The throat is one
# shape in every frame — only its two colors change — so the fixture itself never
# moves; what animates is the light inside it. The item being consumed is the
# renderer's job; this is the throat flashing red as it arrives.
#
# The ladder is deliberately four steps rather than three: it separates the
# rise from the fall, so no two frames of the pulse land on the same image and
# the loop cannot read as a stutter.
aperture() {
	frame=$1
	case $2 in
	0) edge=$H_DARK; core=$H_DARK ;;      # idle: an unlit recess
	1) edge=$H_DARK; core=$ACC_DARK ;;    # residual glow, deep inside only
	2) edge=$ACC_DARK; core=$ACC_MID ;;   # the intake catching
	3) edge=$ACC_MID; core=$ACC_MID ;;    # fading from peak
	*) edge=$ACC_MID; core=$ACC_PALE ;;   # peak: the flash
	esac

	# The lit throat first, then its dark lips over it. The lips never change
	# color: an aperture that loses its frame when it lights up stops reading as a
	# hole cut into the housing and starts reading as a sticker on top of it.
	# Everything runs out through the West edge, so the throat is an open mouth
	# rather than a window and the renderer's item has somewhere to arrive from.
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_X" --y "$MOUTH_Y" \
		--width "$MOUTH_W" --height "$MOUTH_H" --color "$edge"
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_X" --y "$CORE_Y" \
		--width "$MOUTH_W" --height "$CORE_H" --color "$core"
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_X" --y "$THROAT_TOP" \
		--width "$MOUTH_W" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_X" \
		--y "$((THROAT_TOP + THROAT_FRAME_H - 1))" \
		--width "$MOUTH_W" --height 1 --color "$OUTLINE"
	# The mouth lips, pinching the opening down for the three columns that project
	# past the housing wall.
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_LIP_X" --y "$MOUTH_Y" \
		--width "$MOUTH_LIP_W" --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x "$MOUTH_LIP_X" \
		--y "$((MOUTH_Y + MOUTH_H - 1))" \
		--width "$MOUTH_LIP_W" --height 1 --color "$OUTLINE"
	gullet "$frame"
}

# The drain indicator at brightness $2 (0 = idle, 3 = peak): a dark socket with
# the red accent set into it. Red is this fixture's whole identity — it is the
# only hue on the sprite, and the reason it can never be mistaken for the green
# source that feeds it.
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

# --- The consume pulse ---------------------------------------------------------
#
# One item per cycle, running the source's emit pulse backwards. No item is
# drawn — the renderer supplies it. What animates is the fixture's reaction: the
# lamp charges, the intake flash rises to its peak as the item is swallowed, then
# both fall back across frames 4-5 to a level just above idle so frame 5 eases
# into frame 0 instead of snapping to it.
#
#   frame | throat | lamp
#   ------+--------+-----
#     0   |   0    |  0    idle, the rest state
#     1   |   0    |  1    charging — the lamp brightens, the throat still dark
#     2   |   2    |  2    the intake catches
#     3   |   4    |  3    the flash peaks — an item is consumed
#     4   |   3    |  2    the flash fades
#     5   |   1    |  1    settling back to idle
frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	housing "$frame"
	case "$frame" in
	0)
		aperture "$frame" 0
		lamp "$frame" 0
		;;
	1)
		aperture "$frame" 0
		lamp "$frame" 1
		;;
	2)
		aperture "$frame" 2
		lamp "$frame" 2
		;;
	3)
		aperture "$frame" 4
		lamp "$frame" 3
		;;
	4)
		aperture "$frame" 3
		lamp "$frame" 2
		;;
	5)
		aperture "$frame" 1
		lamp "$frame" 1
		;;
	esac
	frame=$((frame + 1))
done
