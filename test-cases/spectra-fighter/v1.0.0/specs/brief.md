# Spectra Fighter — drawing brief

You are drawing the **resonator-fighter**, the **player's ship** for
*Spectra*, a two-band formation shooter. It sits at the bottom of the screen
and fires upward at a swarm of drones. You are drawing the *player's ship* — a
single 64×64 sprite.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward.
- Draw the ship **pointing UP** — up is the direction it fires.
- Draw it **symmetric about the vertical centerline `x = 32`** (the two halves
  mirror each other). The `mirror_horizontal` operation reflects the left half
  onto the right and is the natural way to guarantee this.
- Fill most of the frame: the hull should span roughly 44–52 px tall, centered
  with a few pixels of margin, never clipped at an edge.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Hull | `#eaf0fb` |
| Cyan band (core + ring glyph) | `#34e2ff` |
| Engine accent (warm) | `#ffd86b` |
| Highlight | `#ffffff` |

## The form

The fighter reads, at a glance, as a **sleek arrowhead ship pointing up**:

- **Hull:** a swept arrowhead in the hull color — a narrow nose at the top
  widening through a pair of swept wings to a short tail block at the bottom.
- **Core:** a glowing **cyan** core set into the hull, carrying the cyan
  band's **ring glyph** — a stroked ring around the core. The game reads its
  two spectral bands by **shape as well as color** (a ring motif for cyan, a
  diamond motif for magenta), so the ring is part of the ship's identity, not
  decoration. A white highlight pixel sits at the very center of the core.
- **Engines:** two small **warm-accent** engine glows at the bottom of the
  hull, one each side of the centerline.

## Working the tool

Build the sprite up in sensible layers — lay down the hull arrowhead, then the
wings and tail, then the cyan core and its ring glyph, then the engine glows.
Because the ship is symmetric, you may draw the left half and use
`draw mirror-horizontal --axis-x 32` to complete the right. Run `draw --help`
for the available operations (filling and stroking circles and rectangles,
lines, single pixels, flood fill, and the horizontal mirror) and `draw
<operation> --help` for each one's exact flags. Call `draw` once per operation
and read `canvas.png` between calls to judge your progress against this brief
and the target.
