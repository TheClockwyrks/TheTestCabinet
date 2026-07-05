# Floe Crawler — drawing brief

You are drawing the **snow-crawler**, a **single sprite** for an arctic crossing
game. It is a **hazard**: a heavy tracked machine that grinds back and forth across
the pack ice in the lanes the player must cross, crushing anything in its path.
It
has to read instantly as a **dangerous industrial vehicle** — hard, mechanical,
and
menacing — clearly a thing to dodge, never a creature or a safe platform.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- The crawler **faces right** (the game mirrors it to move left). Draw it filling
  most of the frame — it is a big, heavy machine — with only a couple of pixels
  of
  margin.
- Draw on full **transparency** — the only opaque pixels are the machine itself;
  do **not** fill the background.

## The form

A boxy tracked crawler, seen from a **slight three-quarter side** so its bulk
reads:

- **Tracks:** a heavy **tread** band across the bottom of the frame (about
  **y = 22–29**), in the dark tread color, with a few lighter notches so it reads
  as a caterpillar track, not a plain bar.
- **Chassis:** a chunky steel body sitting on the tracks (about **(3, 8)** to
  **(29, 22)**), filled in the steel color and shaded darker (chassis-dark) along
  the bottom and the rear.
- **Cab:** a raised cab toward the front (right) with a **glass** window (the cab
  glass color).
- **Hazard front:** the leading (right) edge carries **hazard stripes** — diagonal
  bars in the hazard-yellow — and/or a bladed plow, marking the dangerous end.
- **Beacon:** a small **red warning light** on top of the cab.
- Pick out a couple of panel lines / bolts in the dark color so it reads as built,
  not a smooth block.

Keep it **hard-edged and mechanical** — straight lines, right angles, metal — the
clear opposite of the soft creatures and the flat ice floes.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Chassis — steel | `#4a5560` |
| Chassis — dark (shade, panel lines) | `#232b33` |
| Tread | `#171c21` |
| Hazard stripe / trim | `#ffd23f` |
| Beacon (warning red) | `#e0492f` |
| Cab glass | `#7fb0c4` |

## Working the tool

Block in the tread band first, then the steel chassis on top of it, shading the
bottom and rear with chassis-dark; add the cab and its glass window, the
hazard-yellow stripes on the leading edge, the red beacon on top, and a couple of
dark panel lines and tread notches. Use the rectangle operations for the chassis,
cab, and tread, short lines for the hazard stripes and panel lines, and single
pixels for the beacon and bolts. Run `draw --help` for the available operations
and
`draw <operation> --help` for each one's exact flags. Call `draw` once per
operation and read `canvas.png` between calls to judge it against this brief — it
should read at a glance as a hard, dangerous machine facing right, on full
transparency.
