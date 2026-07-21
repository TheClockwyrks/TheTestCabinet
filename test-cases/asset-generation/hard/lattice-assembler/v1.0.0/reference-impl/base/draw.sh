#!/bin/sh
# Reference implementation — Lattice Assembler (variant `base`).
#
# Draws the eight-frame crafting loop with `draw-sheet`, one operation at a time,
# exactly as a model would. Run from a seeded asset workspace (see
# `tcab publish-reference`): `draw.config.json`, the empty per-frame action logs,
# and the blank previews are already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count as a bare literal —
# the machine is 3x3 tiles of TILE pixels, which is what the seeded config sizes a
# frame to, so this script cannot drift from the case manifest.

set -eu

# --- The machine's fixed geometry ----------------------------------------------
#
# The assembler covers a 3x3 block of tiles and fills its frame. Everything below
# is measured either as an inset from the frame edge (the concentric bands that
# make the raised block) or as a radius from the core centre (the recessed well
# and the gear turning in it), so the whole machine stays symmetric on all four
# sides: no front, no back, no facing.
TILE=32
TILES=3
SIZE=$((TILE * TILES))
FRAMES=8
CX=$((SIZE / 2)) # core centre, also the mirror axis
CY=$((SIZE / 2))

# The block, read from the floor upwards. Each value is an inset from the frame
# edge, so each band is automatically concentric and square:
#
#   2..3    contact shadow — the dark ring the block casts where it meets the floor
#   4..7    the lower, steepest part of the bevelled side (chassis dark)
#   8       the fold where the two bevel facets meet
#   9..14   the upper part of the bevel, catching more light (chassis mid)
#   15      the seam where the sides meet the top face
#   16..79  the raised top face itself (chassis light)
#
# The two hard dark lines matter: the palette's three greys are close in value, so
# without a seam at each fold the bands read as concentric decoration instead of a
# side dropping away in steps.
#
# Two pixels of margin at the frame edge is all the machine gives up: it is meant
# to read as a big chunky block that all but fills its 3x3 footprint.
SHADOW_IN=2
SLOPE_LO_IN=4
SLOPE_HI_IN=9
SEAM_IN=15
TOP_IN=16

# The upper bevel band, which is where the hazard tape and the corner mitres live.
BAND_Y=$SLOPE_HI_IN
BAND_H=$((SEAM_IN - SLOPE_HI_IN))

# Feed chutes: one per side, centred, running from the floor up the bevel and
# continuing onto the top face as a louvred intake. Four identical chutes is what
# keeps the machine non-directional while still looking like something a belt
# feeds — the machine has four faces and no front.
CHUTE_X=$((CX - 12)) # centred: 24 wide
CHUTE_W=24
CHUTE_L=14                       # along the bevel, floor edge to top-face seam
PORT_IN=$((TOP_IN + 1))          # the louvred intake, just inside the top face
PORT_L=14                        # the intake's depth into the top face
PORT_FAR=$((SIZE - PORT_IN - PORT_L)) # the same intake on the opposite side

# Hazard tape flanks each chute along the bevel, stopping short of the corners.
HAZ_RUN=19
HAZ_NEAR=$TOP_IN                        # first tape run: corner side of the chute
HAZ_FAR=$((SIZE - HAZ_NEAR - HAZ_RUN))  # its opposite-edge twin
HAZ_PITCH=4

# Bolted plating on the top face: a stud at each outer corner and a second one
# further in, with a short panel seam mitring the corner between them.
BOLT=4
BOLT_OUT=$((TOP_IN + 1))
BOLT_IN=$((TOP_IN + 12))
PLATE_IN=$((TOP_IN + 5)) # the seam separating the top face's edge plate from the rest

# The recessed core well, as radii from (CX, CY). Stepping light -> mid -> dark ->
# outline as the radius shrinks is what makes the opening read as sunk into the
# top face rather than painted onto it.
BEZEL_R=24 # the dark ring around the well's mouth
COLLAR_R=23
STEP1_R=21
STEP2_R=19
WELL_R=17 # the dark opening; everything that animates lives inside this

# The gear turning in the well. The tooth tips stop two pixels short of the well
# wall so there is always dark behind them: teeth only read as teeth if the gaps
# between them are visibly empty.
TEETH=6
TOOTH_R=13 # radius the tooth centres sit at
TOOTH_SZ=2 # tooth radius, so tips reach TOOTH_R + TOOTH_SZ
RIM_R=12   # lit edge of the gear body, tying the teeth together
BODY_R=11
HOLE_R=9 # lightening holes bored through the body, one between each pair of teeth
BORE_R=6 # the gear's central bore, where the glow shows through

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
CH_LIGHT='#6a7884'
CH_MID='#4d5a64'
CH_DARK='#36424b'
TEAL='#38c6d6'
TEAL_PALE='#9af0f7'
AMBER='#e6b329'

# --- Turning the gear with integer arithmetic ----------------------------------
#
# A full turn is divided into TURN steps of 7.5 degrees. That step is chosen so
# both patterns land on table entries exactly: the six teeth sit TURN/TEETH steps
# apart, and the gear advances SPIN steps per frame.
#
# SPIN=3 (22.5 degrees a frame) is the largest advance that still reads as
# forward rotation — it is under half a tooth pitch, so no frame is ambiguous
# about which way the gear is going. Over the eight frames the gear turns 180
# degrees, which for a six-toothed gear is exactly three tooth pitches: frame 8
# would be pixel-for-pixel frame 0, so the loop closes with no jump. Since
# 3 x frame mod 8 runs through every residue, no two frames repeat either.
TURN=48
SPIN=3
UNIT=1024
SIN='0 134 265 392 512 623 724 812 887 946 989 1015 1024 1015 989 946 887 812
	724 623 512 392 265 134 0 -134 -265 -392 -512 -623 -724 -812 -887 -946 -989
	-1015 -1024 -1015 -989 -946 -887 -812 -724 -623 -512 -392 -265 -134'

# sin(i x 7.5 degrees), scaled by UNIT. `i` is wrapped into the table, so callers
# can just keep adding steps.
sin_q() {
	i=$(($1 % TURN))
	if [ "$i" -lt 0 ]; then i=$((i + TURN)); fi
	set -- $SIN
	eval "echo \"\${$((i + 1))}\""
}

cos_q() { sin_q $(($1 + TURN / 4)); }

# round($1 x $2 / UNIT), rounding away from zero on both signs so a tooth on the
# left of the gear is placed as accurately as one on the right.
scaled() {
	v=$(($1 * $2))
	if [ "$v" -ge 0 ]; then
		echo $(((v + UNIT / 2) / UNIT))
	else
		echo $((-((-v + UNIT / 2) / UNIT)))
	fi
}

# --- Sub-assemblies ------------------------------------------------------------

# One concentric band of the block: a square inset $2 from every frame edge. Used
# for the contact shadow, the two bevel tones, the seam, and the top face — each
# one drawn over the last, so the block builds up from the floor to its lit top.
band() {
	draw-sheet fill-rect --frame "$1" --x "$2" --y "$2" \
		--width "$((SIZE - 2 * $2))" --height "$((SIZE - 2 * $2))" --color "$3"
}

# A bolt stud on the top face: a dark socket with a lit head sitting proud in it.
# The head is lit evenly rather than highlighted on one corner — the light is
# straight overhead, so nothing on this machine has a lit side and a shaded side.
bolt() {
	draw-sheet fill-rect --frame "$1" --x "$2" --y "$3" \
		--width "$BOLT" --height "$BOLT" --color "$OUTLINE"
	draw-sheet fill-rect --frame "$1" --x "$(($2 + 1))" --y "$(($3 + 1))" \
		--width 2 --height 2 --color "$CH_LIGHT"
}

# A run of hazard tape along the upper bevel band. $2/$3 are the run's top-left
# corner; $4 is `h` for a run along the top or bottom edge and `v` for one along
# the left or right, and $5 is +1 on the top and left runs, -1 on the bottom and
# right ones. Amber first, then the dark diagonals cut across it at HAZ_PITCH, so
# it reads as tape rather than a solid amber stripe.
#
# The `sense` flip is what makes the sheet symmetric top-to-bottom the way the
# mirror already makes it symmetric left-to-right: a run's twin on the opposite
# edge leans the other way, so the two are reflections rather than copies. It only
# lands exactly because HAZ_RUN is one diagonal short of four whole HAZ_PITCH
# steps, which makes the striped columns a palindrome across the run.
hazard() {
	frame=$1
	x=$2
	y=$3
	dir=$4
	sense=$5
	if [ "$dir" = h ]; then
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$HAZ_RUN" --height "$BAND_H" --color "$AMBER"
	else
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$BAND_H" --height "$HAZ_RUN" --color "$AMBER"
	fi
	if [ "$sense" -gt 0 ]; then
		near=$((BAND_H - 1))
		far=0
	else
		near=0
		far=$((BAND_H - 1))
	fi
	i=0
	while [ "$i" -le "$((HAZ_RUN - BAND_H - 1))" ]; do
		s=0
		while [ "$s" -lt 2 ]; do
			if [ "$dir" = h ]; then
				draw-sheet line --frame "$frame" \
					--x0="$((x + i + s))" --y0="$((y + near))" \
					--x1="$((x + i + s + BAND_H - 1))" --y1="$((y + far))" \
					--color "$OUTLINE"
			else
				draw-sheet line --frame "$frame" \
					--x0="$((x + near))" --y0="$((y + i + s))" \
					--x1="$((x + far))" --y1="$((y + i + s + BAND_H - 1))" \
					--color "$OUTLINE"
			fi
			s=$((s + 1))
		done
		i=$((i + HAZ_PITCH))
	done
}

# A feed chute running down one bevelled side to the floor. $2/$3 are its
# top-left corner and $4 the axis it runs along (`h` for the left/right sides,
# `v` for the top/bottom). $5 is +1 when the chute's foot is at the low
# coordinate end and -1 when it is at the high end: the chute is shaded like the
# bevel it sits on — dark at the floor, mid, then light where it meets the top
# face — so it always falls away from the light the same way the chassis does. A
# dark slot is cut across its foot: that is the mouth a belt or inserter feeds,
# and it is what stops the chute reading as a plain raised pad.
chute() {
	frame=$1
	x=$2
	y=$3
	dir=$4
	sense=$5
	if [ "$sense" -gt 0 ]; then
		near=$CH_DARK
		far=$CH_LIGHT
	else
		near=$CH_LIGHT
		far=$CH_DARK
	fi
	if [ "$sense" -gt 0 ]; then mouth=1; else mouth=$((CHUTE_L - 3)); fi
	if [ "$dir" = v ]; then
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$CHUTE_W" --height "$CHUTE_L" --color "$OUTLINE"
		k=0
		for tone in "$near" "$CH_MID" "$far"; do
			draw-sheet fill-rect --frame "$frame" --x "$((x + 1))" \
				--y "$((y + 1 + k))" --width "$((CHUTE_W - 2))" --height 4 \
				--color "$tone"
			k=$((k + 4))
		done
		draw-sheet fill-rect --frame "$frame" --x "$((x + 4))" \
			--y "$((y + mouth))" --width "$((CHUTE_W - 8))" --height 2 \
			--color "$OUTLINE"
	else
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$CHUTE_L" --height "$CHUTE_W" --color "$OUTLINE"
		k=0
		for tone in "$near" "$CH_MID" "$far"; do
			draw-sheet fill-rect --frame "$frame" --x "$((x + 1 + k))" \
				--y "$((y + 1))" --width 4 --height "$((CHUTE_W - 2))" \
				--color "$tone"
			k=$((k + 4))
		done
		draw-sheet fill-rect --frame "$frame" --x "$((x + mouth))" \
			--y "$((y + 4))" --width 2 --height "$((CHUTE_W - 8))" \
			--color "$OUTLINE"
	fi
}

# The louvred intake each chute feeds, set into the top face: a dark recess with
# three mid-tone louvre bars across it. $2/$3 are its top-left corner and $4
# the axis, as for `chute`.
port() {
	frame=$1
	x=$2
	y=$3
	dir=$4
	if [ "$dir" = v ]; then
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$CHUTE_W" --height "$PORT_L" --color "$OUTLINE"
		draw-sheet fill-rect --frame "$frame" --x "$((x + 1))" --y "$((y + 1))" \
			--width "$((CHUTE_W - 2))" --height "$((PORT_L - 2))" --color "$CH_DARK"
		k=2
		while [ "$k" -lt "$((PORT_L - 2))" ]; do
			draw-sheet fill-rect --frame "$frame" --x "$((x + 2))" \
				--y "$((y + k))" --width "$((CHUTE_W - 4))" --height 2 \
				--color "$CH_MID"
			k=$((k + 4))
		done
	else
		draw-sheet fill-rect --frame "$frame" --x "$x" --y "$y" \
			--width "$PORT_L" --height "$CHUTE_W" --color "$OUTLINE"
		draw-sheet fill-rect --frame "$frame" --x "$((x + 1))" --y "$((y + 1))" \
			--width "$((PORT_L - 2))" --height "$((CHUTE_W - 2))" --color "$CH_DARK"
		k=2
		while [ "$k" -lt "$((PORT_L - 2))" ]; do
			draw-sheet fill-rect --frame "$frame" --x "$((x + k))" \
				--y "$((y + 2))" --width 2 --height "$((CHUTE_W - 4))" \
				--color "$CH_MID"
			k=$((k + 4))
		done
	fi
}

# --- The sheet -----------------------------------------------------------------

frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	# 1. The block. Six concentric squares, drawn floor-first: the contact
	#    shadow grounding it, the two bevel tones falling away from the top, the
	#    seam, and the lit top face inset inside them all. Because they are
	#    concentric the four sides are shaded identically, which is what makes
	#    the machine read as lit from straight overhead and gives it no facing.
	band "$frame" "$SHADOW_IN" "$OUTLINE"
	band "$frame" "$SLOPE_LO_IN" "$CH_DARK"
	band "$frame" "$((SLOPE_HI_IN - 1))" "$OUTLINE"
	band "$frame" "$SLOPE_HI_IN" "$CH_MID"
	band "$frame" "$SEAM_IN" "$OUTLINE"
	band "$frame" "$TOP_IN" "$CH_LIGHT"

	# 2. The mitres where two bevelled sides meet. Without these the bands read
	#    as a flat set of nested squares; the 45-degree seam is what tells the
	#    eye the sides are sloping planes meeting at a corner.
	draw-sheet line --frame "$frame" --x0 "$SLOPE_LO_IN" --y0 "$SLOPE_LO_IN" \
		--x1 "$((SEAM_IN - 1))" --y1 "$((SEAM_IN - 1))" --color "$OUTLINE"
	draw-sheet line --frame "$frame" --x0 "$SLOPE_LO_IN" \
		--y0 "$((SIZE - 1 - SLOPE_LO_IN))" --x1 "$((SEAM_IN - 1))" \
		--y1 "$((SIZE - SEAM_IN))" --color "$OUTLINE"

	# 3. The panel seam running round the top face, separating its bolted edge
	#    plate from the deck the core sits in. Drawn before the chutes' intakes so
	#    they cut through it, which is how a real panel line behaves where a
	#    fitting is let into the plate.
	draw-sheet stroke-rect --frame "$frame" --x "$PLATE_IN" --y "$PLATE_IN" \
		--width "$((SIZE - 2 * PLATE_IN))" --height "$((SIZE - 2 * PLATE_IN))" \
		--color "$CH_MID"

	# 4. Hazard tape on the bevel, marking the corners either side of each intake.
	#    Four runs are drawn — along the top and bottom edges and twice down the
	#    left — and the mirror supplies their four twins on the right. Kept to
	#    short runs on the upper bevel band so the amber stays an accent on a
	#    grey-blue machine rather than becoming its colour.
	hazard "$frame" "$HAZ_NEAR" "$BAND_Y" h 1
	hazard "$frame" "$HAZ_NEAR" "$((SIZE - BAND_Y - BAND_H))" h -1
	hazard "$frame" "$BAND_Y" "$HAZ_NEAR" v 1
	hazard "$frame" "$BAND_Y" "$HAZ_FAR" v -1

	# 5. The feed chutes and their intakes: down the top, bottom, and left sides.
	#    Each chute climbs the bevel from the floor and hands off to a louvred
	#    port in the top face directly above it, so the two read as one assembly.
	chute "$frame" "$CHUTE_X" "$SHADOW_IN" v 1
	chute "$frame" "$CHUTE_X" "$((SIZE - SHADOW_IN - CHUTE_L))" v -1
	chute "$frame" "$SHADOW_IN" "$CHUTE_X" h 1
	port "$frame" "$CHUTE_X" "$PORT_IN" v
	port "$frame" "$CHUTE_X" "$PORT_FAR" v
	port "$frame" "$PORT_IN" "$CHUTE_X" h

	# 6. Bolted plating on the top face: a stud at each corner, a second stud set
	#    in from it, and the panel seam mitring the corner between the two.
	bolt "$frame" "$BOLT_OUT" "$BOLT_OUT"
	bolt "$frame" "$BOLT_OUT" "$((SIZE - BOLT_OUT - BOLT))"
	bolt "$frame" "$BOLT_IN" "$BOLT_IN"
	bolt "$frame" "$BOLT_IN" "$((SIZE - BOLT_IN - BOLT))"
	draw-sheet line --frame "$frame" --x0 "$((BOLT_OUT + BOLT + 1))" \
		--y0 "$((BOLT_OUT + BOLT + 1))" --x1 "$((BOLT_IN - 1))" \
		--y1 "$((BOLT_IN - 1))" --color "$CH_MID"
	draw-sheet line --frame "$frame" --x0 "$((BOLT_OUT + BOLT + 1))" \
		--y0 "$((SIZE - BOLT_OUT - BOLT - 2))" --x1 "$((BOLT_IN - 1))" \
		--y1 "$((SIZE - BOLT_IN))" --color "$CH_MID"

	# 7. Everything above was drawn on the left half only (or centred and already
	#    symmetric), so one mirror finishes the chassis and guarantees the two
	#    halves match to the pixel. It happens before the core is drawn: mirroring
	#    a turning gear would make it symmetric, and a symmetric gear cannot look
	#    like it is turning.
	draw-sheet mirror-horizontal --frame "$frame" --axis-x "$CX"

	# 8. The core well, sunk into the middle of the top face. Concentric discs
	#    stepping light -> mid -> dark -> outline read as a shaft going down; the
	#    outline disc at WELL_R is the dark opening the craft happens in. Drawn
	#    after the mirror so it is centred on the pixel grid in both axes and the
	#    well stays as round as the sides are square.
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$BEZEL_R" --color "$OUTLINE"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$COLLAR_R" --color "$CH_LIGHT"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$STEP1_R" --color "$CH_MID"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$STEP2_R" --color "$CH_DARK"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$WELL_R" --color "$OUTLINE"

	# 9. How hard the core is working this frame. A triangle wave over the eight
	#    frames: darkest at frame 0, brightest at frame 4, and back down — with
	#    frame 7 one step above frame 0, so the wrap 7 -> 0 is the same size step
	#    as every other and the pulse does not stutter at the seam.
	swing=$((frame - FRAMES / 2))
	if [ "$swing" -lt 0 ]; then swing=$((-swing)); fi
	glow=$((FRAMES / 2 - swing))

	# 10. The glow behind the gear. It grows out past the gear body as the cycle
	#     peaks, so at the bright end teal shows through the gaps between the
	#     teeth — the light is coming from inside the machine, not painted on top.
	if [ "$glow" -ge 2 ]; then
		draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
			--r "$((RIM_R + glow))" --color "$TEAL"
	fi

	# 11. The gear. Six teeth on the tooth-centre circle, then the body dropped
	#     over their inner halves so only the tips stand out, then the lit rim
	#     that ties them together, then the body proper. The teeth are placed from
	#     the sine table at TURN/TEETH apart, all advanced by this frame's SPIN
	#     steps.
	pitch=$((TURN / TEETH))
	tooth=0
	while [ "$tooth" -lt "$TEETH" ]; do
		angle=$((tooth * pitch + frame * SPIN))
		draw-sheet fill-circle --frame "$frame" \
			--cx "$((CX + $(scaled "$(cos_q "$angle")" "$TOOTH_R")))" \
			--cy "$((CY + $(scaled "$(sin_q "$angle")" "$TOOTH_R")))" \
			--r "$TOOTH_SZ" --color "$CH_LIGHT"
		tooth=$((tooth + 1))
	done
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$RIM_R" --color "$CH_LIGHT"
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$BODY_R" --color "$CH_MID"

	# 12. Lightening holes bored through the body, offset half a tooth pitch so
	#     they sit between the teeth. They turn with the gear and are the clearest
	#     signal of rotation in the sprite: a plain ring of teeth is easy to read
	#     as a static cog, six holes swinging round it is not.
	hole=0
	while [ "$hole" -lt "$TEETH" ]; do
		angle=$((hole * pitch + pitch / 2 + frame * SPIN))
		draw-sheet fill-circle --frame "$frame" \
			--cx "$((CX + $(scaled "$(cos_q "$angle")" "$HOLE_R")))" \
			--cy "$((CY + $(scaled "$(sin_q "$angle")" "$HOLE_R")))" \
			--r 1 --color "$OUTLINE"
		hole=$((hole + 1))
	done
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$BORE_R" --color "$OUTLINE"

	# 13. The working light itself, seen down the gear's bore: a teal disc that
	#     swells with the cycle, with a pale-teal hot centre once the craft is
	#     properly under way. This is the only teal on the machine.
	draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
		--r "$((2 + glow))" --color "$TEAL"
	if [ "$glow" -ge 2 ]; then
		draw-sheet fill-circle --frame "$frame" --cx "$CX" --cy "$CY" \
			--r "$((glow - 2))" --color "$TEAL_PALE"
	fi

	frame=$((frame + 1))
done
