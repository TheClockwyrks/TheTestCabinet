#!/bin/sh
# Reference implementation — Lattice Furnace (variant `base`).
#
# Draws the twelve-frame furnace sprite with `draw-sheet`, one operation at a
# time, exactly as a model would. Run from a seeded asset workspace (see
# `tcab publish-reference`): `draw.config.json`, the empty per-frame action logs
# and the blank previews are already in place, so this script only draws.
#
# Nothing here restates the canvas size or the frame count — both come from the
# seeded config, so this script cannot drift from the case manifest.
#
# The furnace is drawn FLAT and top-down, looking straight down into a small 2x2
# hearth. It is non-directional — four-way symmetric, with no front or facing — so
# the renderer never rotates it. Twelve frames hold two states:
#   off      (frames 0-3):  a cold, dark firebox — no flame; only a faint banked
#                           ember breathes so the idle loop is not a dead freeze.
#   smelting (frames 4-11):  the firebox blazing — a glowing pool that roils, a
#                           pulsing white-hot core, coal burning around the rim.
# The ORE being smelted is never drawn (a furnace smelts whatever ore is fed to
# it); the coal FUEL packed around the firebox IS drawn — coal is the furnace's own
# fuel, and without it the firebox stays cold.

set -eu

# --- Palette (the brief's table, and nothing else) ------------------------------
#
# The body sits on the shared Lattice steel chassis — the same grey-blue as the
# machine item icons — so the furnace reads as one family with the belts and
# assemblers. The heat is the furnace's own working accent (as teal is the
# assembler's): a dark-ember → red → orange → yellow → white ramp that only ever
# appears in the firebox, so a glance says smelting or idle. Coal is drawn in the
# same near-black as the coal item icon.
OUTLINE='#1b1d21'

STEEL='#5a6472'          # chassis mid — the main body fill
STEEL_HI='#828c9b'       # chassis light — top/left bevel
STEEL_LO='#3a404b'       # chassis dark — bottom/right bevel, refractory rim

COAL='#33363d'           # unlit fuel — matches the coal item icon
COAL_HI='#6b7a86'        # coal's cool sheen

EMBER='#7a2d16'          # dark banked ember — the coolest heat
FIRE_RED='#d6473a'       # the family red (also the circuit's contact dots)
FIRE_ORANGE='#f0894a'
FIRE_YELLOW='#ffcf5c'
FIRE_WHITE='#fff3cf'      # the white-hot core

# --- Mark-making ----------------------------------------------------------------
frect() { # frame x y w h color
	draw-sheet fill-rect --frame "$1" --x="$2" --y="$3" --width "$4" --height "$5" --color "$6"
}
srect() { # frame x y w h color
	draw-sheet stroke-rect --frame "$1" --x="$2" --y="$3" --width "$4" --height "$5" --color "$6"
}
fdisc() { # frame cx cy r color
	draw-sheet fill-circle --frame "$1" --cx "$2" --cy "$3" --r "$4" --color "$5"
}
dot() { # frame x y color
	draw-sheet set-pixel --frame "$1" --x="$2" --y="$3" --color "$4"
}

# --- Geometry -------------------------------------------------------------------
#
# A 64x64 sheet is a 2x2 tile block (32 px/tile) — small, plainly smaller than the
# assembler's 3x3. The casing fills the block with an even margin; the firebox is a
# centred square mouth, and every glow disc is centred on it so the fire is
# radially symmetric and the sprite reads the same however the factory is rotated.
CX=31            # firebox centre
CY=31

# --- The casing (fixed in every frame) ------------------------------------------
#
# A heavy square hearth: a bevelled steel body, four corner bolts, two flue vents
# per side, and a thick refractory rim framing the firebox mouth. Redrawn per frame
# because each frame is its own independent image; nothing here moves.
bolt() { # frame x y — a 2x2 dark bolt head with an up-left glint
	frect "$1" "$2" "$3" 2 2 "$OUTLINE"
	dot "$1" "$2" "$3" "$STEEL_HI"
}
casing() {
	f=$1
	# body face, then the four-sided bevel (light up-left, dark down-right)
	frect "$f" 5 5 54 54 "$STEEL"
	frect "$f" 5 5 54 1 "$STEEL_HI"
	frect "$f" 5 5 1 54 "$STEEL_HI"
	frect "$f" 5 58 54 1 "$STEEL_LO"
	frect "$f" 58 5 1 54 "$STEEL_LO"
	# outline around the whole body, last so the bevel cannot bleed past it
	srect "$f" 4 4 56 56 "$OUTLINE"
	# four corner bolts
	bolt "$f" 8 8; bolt "$f" 54 8; bolt "$f" 8 54; bolt "$f" 54 54
	# two short flue vents on each side (symmetric, so the casing has no facing)
	for a in 22 38; do
		frect "$f" "$a" 6 4 2 "$OUTLINE"; frect "$f" "$a" 8 4 1 "$STEEL_HI"   # top
		frect "$f" "$a" 56 4 2 "$OUTLINE"; frect "$f" "$a" 55 4 1 "$STEEL_HI" # bottom
		frect "$f" 6 "$a" 2 4 "$OUTLINE"; frect "$f" 8 "$a" 1 4 "$STEEL_HI"   # left
		frect "$f" 56 "$a" 2 4 "$OUTLINE"; frect "$f" 55 "$a" 1 4 "$STEEL_HI" # right
	done
	# the firebox mouth: an outlined square with a dark refractory rim, framing the
	# glow. The rim never changes colour, so the firebox always reads as a pit cut
	# into the body rather than a sticker lit on top of it.
	frect "$f" 16 16 32 32 "$OUTLINE"
	frect "$f" 18 18 28 28 "$STEEL_LO"
	frect "$f" 20 20 24 24 "$OUTLINE"
}

# --- Coal (the fuel packed around the firebox) ----------------------------------
#
# A ring of coal chunks lining the inside of the firebox, two pixels thick. This is
# the furnace's fuel — the reason it can smelt — so it is present in every frame; it
# only changes whether it is lit. `$2` is the glow tone laid over the rim when
# smelting (pass "" to leave it unlit).
coal_ring() {
	f=$1; glow=$2
	# the dark coal band around the chamber's inner edge
	frect "$f" 20 20 24 2 "$COAL"          # top
	frect "$f" 20 42 24 2 "$COAL"          # bottom
	frect "$f" 20 20 2 24 "$COAL"          # left
	frect "$f" 42 20 2 24 "$COAL"          # right
	# a scatter of cool sheen so the band reads as loose lumps, not a flat frame
	dot "$f" 23 21 "$COAL_HI"; dot "$f" 33 21 "$COAL_HI"; dot "$f" 40 21 "$COAL_HI"
	dot "$f" 21 27 "$COAL_HI"; dot "$f" 21 37 "$COAL_HI"
	dot "$f" 42 24 "$COAL_HI"; dot "$f" 42 34 "$COAL_HI"
	dot "$f" 26 43 "$COAL_HI"; dot "$f" 36 43 "$COAL_HI"
	if [ -n "$glow" ]; then
		# embers glowing between the lumps when the furnace is lit
		dot "$f" 27 21 "$glow"; dot "$f" 37 21 "$glow"
		dot "$f" 21 31 "$glow"; dot "$f" 42 31 "$glow"
		dot "$f" 27 43 "$glow"; dot "$f" 37 43 "$glow"
	fi
}

# --- The firebox interior -------------------------------------------------------
#
# OFF: a cold dark pit with a faint banked ember at its centre that breathes over
# the four idle frames, so the loop lives without ever reading as active smelting.
firebox_off() { # frame ember_r (0 = no ember)
	f=$1; er=$2
	frect "$f" 22 22 20 20 "$OUTLINE"      # the unlit chamber floor
	coal_ring "$f" ""
	if [ "$er" -gt 0 ]; then
		fdisc "$f" "$CX" "$CY" "$er" "$EMBER"
	fi
}

# SMELTING: a glowing pool seen from above — concentric heat from a dark ember rim
# in to a white-hot core — with flame tongues flickering around it and the coal rim
# lit. `$2` is the phase 0-7; the core pulses and the tongues rotate with it, so the
# eight frames roil and loop seamlessly.
tongue() { # frame x y — an orange flame flick with a yellow tip toward the centre
	f=$1; x=$2; y=$3
	frect "$f" "$x" "$y" 2 2 "$FIRE_ORANGE"
	# yellow tip nudged toward the core
	tx=$x; ty=$y
	[ "$x" -gt "$CX" ] && tx=$((x - 1)); [ "$x" -lt "$CX" ] && tx=$((x + 1))
	[ "$y" -gt "$CY" ] && ty=$((y - 1)); [ "$y" -lt "$CY" ] && ty=$((y + 1))
	dot "$f" "$tx" "$ty" "$FIRE_YELLOW"
}
firebox_fire() {
	f=$1; phase=$2
	coal_ring "$f" "$FIRE_ORANGE"
	# concentric glow pool, coolest at the rim, hottest at the core
	fdisc "$f" "$CX" "$CY" 11 "$EMBER"
	fdisc "$f" "$CX" "$CY" 9 "$FIRE_RED"
	fdisc "$f" "$CX" "$CY" 7 "$FIRE_ORANGE"
	fdisc "$f" "$CX" "$CY" 5 "$FIRE_YELLOW"
	# the white-hot core, pulsing 2<->3 across the loop (seamless at the wrap)
	case $phase in
	0|1|6|7) cr=2 ;;
	*) cr=3 ;;
	esac
	fdisc "$f" "$CX" "$CY" "$cr" "$FIRE_WHITE"
	# three flame tongues on the coal rim, rotating one step per phase so they roil
	# around the pool. Positions are the eight compass points at radius ~10.
	i=0
	for step in 0 3 6; do
		d=$(( (phase + step) % 8 ))
		case $d in
		0) tongue "$f" 40 30 ;;
		1) tongue "$f" 37 24 ;;
		2) tongue "$f" 30 21 ;;
		3) tongue "$f" 24 24 ;;
		4) tongue "$f" 21 30 ;;
		5) tongue "$f" 24 37 ;;
		6) tongue "$f" 30 40 ;;
		7) tongue "$f" 37 37 ;;
		esac
		i=$((i + 1))
	done
}

# ===============================================================================
# Frames 0-3 — off (cold, banked idle)
#
# The ember breathes 0 -> 1 -> 2 -> 1 and back to 0 at the wrap, a slow low pulse.
# ===============================================================================
casing 0; firebox_off 0 0
casing 1; firebox_off 1 1
casing 2; firebox_off 2 2
casing 3; firebox_off 3 1

# ===============================================================================
# Frames 4-11 — smelting (fire inside)
#
# Eight-frame roiling loop, phase 0-7. The chassis holds perfectly still; only the
# heat moves — the core pulses and the tongues rotate — so the animation is the
# work, not the machine shaking.
# ===============================================================================
casing 4;  firebox_fire 4  0
casing 5;  firebox_fire 5  1
casing 6;  firebox_fire 6  2
casing 7;  firebox_fire 7  3
casing 8;  firebox_fire 8  4
casing 9;  firebox_fire 9  5
casing 10; firebox_fire 10 6
casing 11; firebox_fire 11 7
