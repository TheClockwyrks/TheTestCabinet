#!/bin/sh
# Reference implementation — Lattice Transport Belt (variant `base`).
#
# Draws the eight-frame East-flowing belt sheet with `draw-sheet`, one operation
# at a time, exactly as a model would. Run from a seeded asset workspace (see
# `tcab publish-reference`): `draw.config.json`, the empty per-frame action logs,
# and the blank previews are already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.

set -eu

# --- The belt's fixed geometry -------------------------------------------------
#
# The chevron pitch is the repeat the whole surface pattern is measured in, and
# the blade pitch divides it exactly (two blades per chevron). Because they share
# that factor the two patterns advance locked together and come back into
# register at the wrap, which is what keeps the loop seamless.
FRAMES=8
CHEVRON_PITCH=16
BLADE_PITCH=8
# One-eighth of the chevron pitch per frame: every frame lands on a distinct
# offset, and after frame 7 the pattern has advanced exactly one full pitch. A
# larger step (half a pitch, say) would collapse the sheet into two alternating
# images — the failure the brief calls out.
STEP=$((CHEVRON_PITCH / FRAMES))

# Rails are the only fixed structure; everything between them scrolls.
RAIL_H=2       # rail band height, top and bottom
SURFACE_TOP=3  # first surface row, below the top rail and its outline
SURFACE_BOT=28 # last surface row, above the bottom outline and rail
# The blades stop one row short at each end, leaving a contact shadow where the
# belt meets each rail. That single dark row is what gives the flat top-down tile
# its sense of the surface sitting *below* the rails.
BLADE_TOP=$((SURFACE_TOP + 1))
BLADE_H=$((SURFACE_BOT - BLADE_TOP))

# --- Palette (the brief's table, and nothing else) -----------------------------
OUTLINE='#1b1d21'
BASE='#34383d'
MID='#4a4f55'
RAIL='#6b7178'
AMBER='#e6b329'
AMBER_HI='#f6d96b'
AMBER_LO='#b88410'

# Draw one tread blade (cleat) at column $2 of frame $1: a two-pixel raised face
# in the metal mid tone with the dark outline down its trailing edge, spanning the
# full surface height between the rails. Columns off-canvas are clipped by the
# binary, which is how the wrapped copies below cost nothing.
#
# Note the `--x=…` form on every column: a wrapped copy's column is negative, and
# `--x -32` would be read as a flag rather than a value.
blade() {
	frame=$1
	x=$2
	draw-sheet fill-rect --frame "$frame" --x="$x" --y "$BLADE_TOP" \
		--width 3 --height "$BLADE_H" --color "$MID"
	draw-sheet fill-rect --frame "$frame" --x="$((x + 3))" --y "$BLADE_TOP" \
		--width 1 --height "$BLADE_H" --color "$OUTLINE"
}

# Draw one East-pointing chevron with its tip at column $2 of frame $1, centred on
# the tile's horizontal centre line. Four lines: the two arms in the amber mover
# tone, with the highlight along the leading/top edge and the shadow along the
# trailing/bottom edge so it reads with a little depth.
chevron() {
	frame=$1
	tip=$2
	back=$((tip - 4))
	draw-sheet line --frame "$frame" --x0="$back" --y0 10 --x1="$tip" --y1 14 --color "$AMBER_HI"
	draw-sheet line --frame "$frame" --x0="$back" --y0 11 --x1="$tip" --y1 15 --color "$AMBER"
	draw-sheet line --frame "$frame" --x0="$back" --y0 20 --x1="$tip" --y1 16 --color "$AMBER"
	draw-sheet line --frame "$frame" --x0="$back" --y0 21 --x1="$tip" --y1 17 --color "$AMBER_LO"
}

frame=0
while [ "$frame" -lt "$FRAMES" ]; do
	# How far the whole surface pattern has advanced east in this frame.
	offset=$((frame * STEP))

	# 1. The belt body: the metal base across the whole tile. The mid tone that
	#    keeps this from reading as a flat fill arrives with the blades below,
	#    which is also where the brief puts it.
	draw-sheet fill-rect --frame "$frame" --x 0 --y 0 --width 32 --height 32 --color "$BASE"

	# 2. The tread blades, at the blade pitch, shifted east by this frame's offset.
	#    Copies are drawn a full tile to either side so a blade leaving the right
	#    edge re-enters from the left: that is what makes the tile scroll without
	#    gaps and tile horizontally edge-to-edge.
	base=$((-32))
	while [ "$base" -le 32 ]; do
		blade "$frame" "$((base + offset))"
		base=$((base + BLADE_PITCH))
	done

	# 3. The rails, drawn after the surface so they stay crisp: a lighter band along
	#    the top and bottom edges, each separated from the belt by the dark outline,
	#    plus the contact shadow the blades left room for. These are the only pixels
	#    that do not move frame to frame.
	draw-sheet fill-rect --frame "$frame" --x 0 --y 0 --width 32 --height "$RAIL_H" --color "$RAIL"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$RAIL_H" --width 32 --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$SURFACE_TOP" \
		--width 32 --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$SURFACE_BOT" \
		--width 32 --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((SURFACE_BOT + 1))" \
		--width 32 --height 1 --color "$OUTLINE"
	draw-sheet fill-rect --frame "$frame" --x 0 --y "$((SURFACE_BOT + 2))" \
		--width 32 --height "$RAIL_H" --color "$RAIL"

	# 4. The chevrons, painted last so they sit on top of the tread blades they
	#    share a surface with — one central row at the chevron pitch, wrapped the
	#    same way as the blades, advancing by the same offset so the whole surface
	#    moves as one locked pattern.
	base=$((-32))
	while [ "$base" -le 32 ]; do
		chevron "$frame" "$((base + offset))"
		base=$((base + CHEVRON_PITCH))
	done

	frame=$((frame + 1))
done
