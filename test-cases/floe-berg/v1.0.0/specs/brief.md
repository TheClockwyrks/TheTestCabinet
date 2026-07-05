# Floe Berg — drawing brief

You are drawing the **ice berg**, a **single sprite** for an arctic crossing game.
It is a **hazard**: a jagged chunk of drifting ice that slides across the lanes
the
player must cross, crushing anything it hits. It has to read as a **hard, sharp,
dangerous mass of ice** — a thing to dodge — and it must be clearly different from
the flat, safe ice floe the player stands on: this one is **jagged and
three-dimensional**, not a smooth flat pan.

## The canvas

- A single **32×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–31). The center
  is near **(16, 16)**.
- Draw it filling most of the frame, centered, with a couple of pixels of margin.
- Draw on full **transparency** — the only opaque pixels are the ice mass itself;
  do **not** fill the background.

## The form

A chunky, faceted **iceberg fragment**:

- An **irregular, jagged silhouette** — angular, with a few **sharp points** rising
  along the top edge, not a circle or a soft blob.
- **Faceted planes:** break the mass into a few flat facets shaded with the three
  ice tones — the light tone on the top/left faces, the mid tone on the main body,
  the shadow tone on the bottom/right faces — so it reads as a solid
  three-dimensional block of ice catching the light, not a flat shape.
- **Cracks:** a couple of dark crack lines (the crack color) running through the
  mass, and a darker core low down, so it reads as dense, hard ice.
- **Snow highlight:** a few pure-white pixels catching the top edges and points.

Keep it reading as **hard and dangerous** — sharp, faceted, heavy — clearly a
hazard, and clearly distinct from a flat calm floe you could stand on.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Ice — light (lit facets) | `#d4e8f2` |
| Ice — mid (body) | `#9cc0d6` |
| Ice — shadow (shaded facets) | `#5a86a2` |
| Crack / dense core | `#2b4a5e` |
| Snow highlight | `#ffffff` |

## Working the tool

Block in the jagged mass first — an angular silhouette with sharp top points in
the
mid ice tone — then carve it into facets by filling the top/left faces with the
light tone and the bottom/right faces with the shadow tone, add a couple of dark
crack lines and a darker core, and dot the top edges and points with pure-white
snow highlights. Use the polygon or line and rectangle operations for the angular
facets, lines for the cracks, and single pixels for the snow highlights. Run
`draw --help` for the available operations and `draw <operation> --help` for each
one's exact flags. Call `draw` once per operation and read `canvas.png` between
calls to judge it against this brief — it should read at a glance as a hard, sharp,
dangerous berg, not a flat safe floe, on full transparency.
