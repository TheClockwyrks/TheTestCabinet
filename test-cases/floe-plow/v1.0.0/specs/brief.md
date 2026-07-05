# Floe Plow — drawing brief

You are drawing the **snow plow**, a **single sprite** for an arctic crossing game.
It is a **hazard**: a big, heavy plow vehicle that grinds back and forth across
the
lanes the player must cross, shoving snow and crushing anything in its path. It
has
to read instantly as a **large, dangerous road machine** — hard, mechanical, and
menacing — clearly a thing to dodge, never a creature or a safe platform.

It is a **long vehicle: three tiles wide**, so the canvas is **96×32** (three
32-pixel tiles side by side).

## The canvas

- A single **96×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right (0–95), `y` increases downward (0–31).
- The plow **faces right** (the game mirrors it to move left), so its **plow
  blade** is at the **right** (leading) edge. Draw it **filling most of the
  96×32 canvas** — it is a big machine — with only a pixel or two of margin top
  and bottom.
- Draw on full **transparency** — the only opaque pixels are the machine itself;
  do **not** fill the background.

## The form

A long plow truck seen from **directly overhead (top-down)**, as in a top-down
crossing game — you look down on its roof:

- **Plow blade:** at the leading (right) edge, a wide angled **blade** spanning the
  full height (about **x = 80–95**, `y = 0–31`) in the hazard-yellow, with a few
  diagonal hazard stripes — it is wider than the truck body and juts ahead of it,
  the business end that shoves the snow.
- **Tracks / treads:** from above, the caterpillar tracks run along **both long
  sides** — a heavy dark **tread** band along the **top edge** (about **y = 1–7**)
  and another along the **bottom edge** (about **y = 25–31**), each spanning the
  body's length, with a few lighter notches so they read as caterpillar tracks, not
  plain bars.
- **Body / roof:** a long steel **roof** between the two tread bands (about
  **(6, 8)** to **(80, 24)**), filled in the steel color, with a darker panel line
  or two (chassis-dark) breaking up the flat top.
- **Cab:** toward the **rear** (left), the **cab roof** as a distinct panel with a
  **glass windshield** strip along its forward (right) edge (the cab glass color).
- **Beacon:** a small **red warning light** on the cab roof, visible from above.
- Pick out a couple of panel lines / bolts in the dark color across the long roof
  so it reads as a built machine, not a smooth block.

Keep it **hard-edged and mechanical** — straight lines, right angles, metal — and
clearly **long and heavy**, seen from straight above, the opposite of the soft
creatures and the flat ice floes.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Chassis — steel | `#4a5560` |
| Chassis — dark (shade, panel lines) | `#232b33` |
| Tread / wheels | `#171c21` |
| Plow blade / hazard stripes | `#ffd23f` |
| Beacon (warning red) | `#e0492f` |
| Cab glass | `#7fb0c4` |

## Working the tool

Block in the two tread bands along the top and bottom edges first, then the long
steel roof between them, breaking it up with a dark panel line or two; add the cab
roof and its glass windshield toward the rear (left), the wide hazard-yellow plow
blade with its diagonal stripes across the right leading edge, the red beacon on
the cab, and a few dark panel lines and tread notches along the length. Use the
rectangle operations for the roof, cab, blade, and tread bands, short lines for the
hazard stripes and panel lines, and single pixels for the beacon and bolts. Run
`draw --help` for the available operations and `draw <operation> --help` for each
one's exact flags. Call `draw` once per operation and read `canvas.png` between
calls to judge it against this brief — it should read at a glance as a big, long,
dangerous plow seen from overhead, facing right, filling the 96×32 canvas, on full
transparency.
