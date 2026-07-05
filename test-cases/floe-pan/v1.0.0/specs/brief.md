# Floe Pan — drawing brief

You are drawing the **ice floe**, a **single sprite** for an arctic crossing game.
It is the **safe platform**: a flat pan of drifting ice the player hops onto to
cross the open water. It has to read as a **calm, flat, solid footing** — a safe
place to stand — and it must be clearly different from the jagged, dangerous ice
hazard: this one is **smooth, flat, and rounded**, not sharp or three-dimensional.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- Draw it **filling most of the frame** — it is a platform sized to a tile — as
  a
  rounded shape with only a pixel or two of margin, so tiles of it read as a
  continuous floe.
- Draw on full **transparency** — the only opaque pixels are the floe itself; do
  **not** fill the background.

## The form

A flat pan of ice seen from **top-down**:

- A **rounded, roughly tile-filling slab** — an organic rounded-rectangle / lozenge
  shape, gently irregular at the edges (not a perfect circle, not sharp), reading
  as a solid flat surface.
- **Flat top surface:** fill the top face with the pale ice body, and lay a lighter
  **snow** cap across the upper part of the surface (the snow-top tone) so it reads
  as snow-dusted flat ice you could stand on. Keep it **smooth and calm** — no
  facets, no sharp points, no strong 3D.
- **Edge and waterline:** ring the slab with a slightly darker **ice edge**, and
  add a thin **waterline shadow** along the bottom rim where it meets the sea, so
  it reads as a pan *floating* on water (a low, flat thing), not a tall block.
- A couple of faint cracks or specks in the ice edge tone are fine for texture,
  but
  keep the overall read **flat, pale, and safe**.

The key contrast: this floe is **flat, smooth, rounded, and calm** — obviously a
safe place to stand — the opposite of the jagged, faceted, dangerous ice hazard.

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

Block in the rounded slab first in the pale ice body, filling most of the frame;
ring it with the ice-edge tone; lay the lighter snow-top across the upper surface;
and add the darker waterline shadow along the bottom rim so it reads as floating.
Keep the surface smooth — use the filled-circle/ellipse and rectangle operations
for the rounded slab and snow cap, and lines or single pixels for the edge,
waterline, and any faint texture. Run `draw --help` for the available operations
and
`draw <operation> --help` for each one's exact flags. Call `draw` once per operation
and read `canvas.png` between calls to judge it against this brief — it should read
at a glance as a flat, calm, safe ice pan floating on water, on full transparency.
