# Floe Raft — drawing brief

You are drawing the **long ice floes**, a **sprite sheet** for an arctic crossing
game. These are the big **solid** rafts of drifting ice the player rides across
the
open water — each one a **single continuous slab**, not a row of separate pans.
You
are drawing **two lengths** of the same thing: a **three-tile** floe and a
**four-tile** floe.

Both are drawn on the **same 128×32 canvas** (four 32-pixel tiles wide), one per
frame — the three-tile floe filling the left three tiles, the four-tile floe filling
all four.

## Compositing — floating ice on transparency

Every frame is drawn on a fully **transparent** background so the floe composites
onto the dark water.

- The only opaque pixels are the floe itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **128×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right (0–127), `y` increases downward
  (0–31).
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **2 frames, numbered 0–1**.

| Frame | Length | Occupies |
| --- | --- | --- |
| 0 | **three tiles** | the **left 96×32** of the canvas (`x = 0–95`); the right tile (`x = 96–127`) is left fully transparent |
| 1 | **four tiles** | the **full 128×32** canvas (`x = 0–127`) |

## The form (both frames)

Each floe is one **solid, continuous slab of flat ice** seen from top-down — the
same style as a single small pan, just longer:

- A **long slab** spanning its length with a couple of pixels of margin top and
  bottom and **jagged, irregular left and right ends and edges** — a single
  continuous shape with the rough outline of fractured sea ice, **not two or three
  separate pans butted together** (no internal seams, gaps, or repeated end-caps in
  the middle).
- **Flat top surface:** fill the body with the pale ice body color and lay a lighter
  **snow** cap across the upper part along the **whole length** (one continuous
  snowy top), so it reads as one snow-dusted flat floe you could stand on. The top
  stays flat and calm — the jaggedness is in the outline/edges, not the height; no
  tall facets or sharp 3D.
- **Edge and waterline:** ring the whole slab with the slightly darker **ice edge**
  along its jagged outline, and run a thin **waterline shadow** along the bottom
  edge for the full length so it reads as one long pan floating on water.
- The three-tile floe (frame 0) and the four-tile floe (frame 1) are the **same
  design at two lengths** — same height, same snow top, same edge and waterline,
  just longer.

The key point: each is **one solid long floe**, so a reviewer (and the game)
sees a
single continuous raft, not several small pans lined up.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Snow top (upper surface) | `#eef6fa` |
| Ice body (pale blue surface) | `#c3dee9` |
| Ice edge | `#8fb6c9` |
| Waterline shadow (bottom edge) | `#4d7488` |

## Working the tool

Build the four-tile floe (frame 1) first — one long slab in the pale ice body
across the full width with a jagged, irregular outline, ringed with the ice-edge
tone, a continuous snow-top across the upper surface, and the waterline shadow
along the bottom — then make the three-tile floe (frame 0) the same way but ending
at `x = 95`, leaving the right tile transparent. Keep both a single continuous
shape with no internal seams. Use the rectangle and short line/pixel operations to
build the long slab, its jagged ends and edges, and the snow cap, and lines for the
edge and waterline. Run `draw-sheet --help`
for the available operations and `draw-sheet <operation> --help` for each one's
exact flags. Call `draw-sheet` once per operation and read `frames/<index>.png`
between calls to judge each against this brief — each should read as one solid,
flat,
calm floe of its length, floating on water, on full transparency.
