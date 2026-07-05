# Floe Pan — drawing brief

You are drawing the **ice floe**, a **single sprite** for an arctic crossing game.
It is the **safe platform**: a flat pan of drifting ice the player hops onto to
cross the open water. It has to read as a **calm, flat, solid footing** — a safe
place to stand — but with the **irregular, jagged edges of real sea ice** that has
fractured off a glacier and drifted: not a smooth circle or a neat lozenge.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- Draw it **filling most of the frame** — it is a platform sized to a tile — as
  an **irregular, angular slab** with only a pixel or two of margin, so it reads
  as one solid single-tile floe.
- Draw on full **transparency** — the only opaque pixels are the floe itself; do
  **not** fill the background.

## The form

A flat pan of ice seen from **top-down**:

- An **irregular, angular slab** that roughly fills the tile — a broken shard of
  sea ice with **jagged, uneven edges** and a few blunt corners, not a circle and
  not a neat rectangle. No two sides match; it looks like ice that cracked off a
  larger sheet.
- **Flat top surface:** fill the top face with the pale ice body, and lay a lighter
  **snow** cap across the upper part of the surface (the snow-top tone) so it reads
  as snow-dusted flat ice you could stand on. The **top stays flat and calm** — the
  jaggedness is in the outline/edges, not the height; keep it low, with no strong
  3D or tall facets.
- **Edge and waterline:** ring the slab with a slightly darker **ice edge** that
  follows its jagged outline, and add a thin **waterline shadow** along the bottom
  rim where it meets the sea, so it reads as a pan *floating* on water (a low, flat
  thing), not a tall block.
- A couple of faint cracks or specks in the ice edge tone are fine for texture.

The key read: this floe is **flat, pale, and calm on top** — obviously a safe place
to stand — but its **silhouette is the rough, jagged shape of fractured sea ice**,
not a smooth geometric pill.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Snow top (upper surface) | `#eef6fa` |
| Ice body (pale blue surface) | `#c3dee9` |
| Ice edge | `#8fb6c9` |
| Waterline shadow (bottom rim) | `#4d7488` |

## Working the tool

Block in the angular slab first in the pale ice body, filling most of the frame
with an irregular, jagged outline (not a circle); ring it with the ice-edge tone
following that outline; lay the lighter snow-top across the upper surface; and add
the darker waterline shadow along the bottom rim so it reads as floating. Keep the
top face flat while the edges stay jagged — use rectangle and short line/pixel
operations to build up the angular shape and its snow cap, and lines or single
pixels for the edge, waterline, and any faint cracks. Run `draw --help` for the
available operations and `draw <operation> --help` for each one's exact flags. Call
`draw` once per operation and read `canvas.png` between calls to judge it against
this brief — it should read at a glance as a flat, calm, safe pan of fractured ice
floating on water, on full transparency.
