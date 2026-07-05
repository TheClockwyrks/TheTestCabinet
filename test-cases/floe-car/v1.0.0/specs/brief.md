# Floe Car — drawing brief

You are drawing the **car**, a **single sprite** for an arctic crossing game. It is
a **hazard**: an ordinary sedan driving across the lanes the player must cross. It
has to read instantly as a **normal car** — a plain road vehicle to dodge — clearly
a thing to avoid, never a creature and never a safe platform. It is a third vehicle
alongside the big slow snow plow and the fast sled-dog team.

It is **two tiles wide**, so the canvas is **64×32** (two 32-pixel tiles side by
side).

## The canvas

- A single **64×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right (0–63), `y` increases downward (0–31).
- The car **faces right** (the game mirrors it to move left), so its **front** (hood
  and headlights) is at the **right** (leading) edge and its **rear** (trunk and
  taillights) is at the **left**. Draw it **filling most of the 64×32 canvas** —
  with only a pixel or two of margin — but leave a little room top and bottom for
  the wheels to show.
- Draw on full **transparency** — the only opaque pixels are the car itself; do
  **not** fill the background.

## The form

A normal sedan seen from **directly overhead (top-down)**, as in a top-down
crossing game — you look down on its roof:

- **Body:** a long **rounded car body** in the car red, spanning most of the width
  (about **x = 4–60**) and most of the height, with softly rounded corners — the
  smooth shape of a sedan seen from above, not a boxy truck. Ring it with the
  **dark outline** so it reads against the ice.
- **Cabin / glass:** a **roof/cabin** panel across the middle of the body with a
  **windshield** strip at its forward (right) edge and a **rear window** at its back
  (left) edge, both in the glass color, so you clearly see the greenhouse of a car
  from above. Thin dark seams separate the hood, the cabin, and the trunk.
- **Wheels:** **four wheels** in the tyre color peeking out at the four corners —
  two along the **top** edge and two along the **bottom** edge — so it sits on four
  tyres like a car seen from overhead.
- **Headlights:** two small pale **headlights** at the front (right) edge.
- **Taillights:** two small **red taillights** at the rear (left) edge.
- Pick out the hood and trunk as slightly darker panels (body-dark) so the car has
  a front, a cabin, and a back, not one flat blob.

Keep it reading as a **plain, ordinary car** — smooth, rounded, and clearly a road
vehicle seen from above — obviously different from the big blocky snow plow and the
sled-dog team.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Car body (red) | `#b5423a` |
| Body — dark (hood/trunk, panel seams) | `#7d2c27` |
| Cabin glass (windows) | `#7fb0c4` |
| Tyres / wheels | `#171c21` |
| Outline | `#26323a` |
| Headlights | `#eef6fa` |
| Taillights | `#e0492f` |

## Working the tool

Block in the rounded red car body first, filling most of the frame, and ring it
with the dark outline; add the cabin panel with its windshield and rear window in
the glass color and the dark seams between hood, cabin, and trunk; place the four
tyres at the corners along the top and bottom edges; then add the pale headlights
at the front (right) edge and the red taillights at the rear (left), and darken the
hood and trunk panels a touch. Use the rectangle and filled-circle/ellipse
operations for the rounded body, cabin, and wheels, short lines for the seams, and
single pixels for the head- and taillights. Run `draw --help` for the available
operations and `draw <operation> --help` for each one's exact flags. Call `draw`
once per operation and read `canvas.png` between calls to judge it against this
brief — it should read at a glance as a normal top-down sedan facing right, filling
the 64×32 canvas, on full transparency.
