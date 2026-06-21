# Spectra Flux — drawing brief

You are drawing the **Flux**, a single **enemy drone** for *Spectra*, a
two-band formation shooter. The Flux **alternates its spectral band** on a
steady rhythm — holding cyan, then shimmering, then holding magenta, and back.
Draw it **caught mid-shimmer**, showing **both** bands at once: that dual-band
look is its whole identity. Everything below describes the *enemy* — never the
player's ship.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward.
- The drones dive downward at the player, so draw the Flux **oriented
  downward**.
- Fill most of the frame: the drone should span roughly 40–52 px, centered
  with a few pixels of margin, never clipped at an edge.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Cyan band | `#34e2ff` |
| Magenta band | `#ff4ec7` |
| Rim / highlight / shimmer | `#ffffff` |

## The form

The Flux reads, at a glance, as a **drone flickering between two bands**:

- **Body:** a rounded drone body **split between the two bands** — one half
  cyan, the other half magenta — so both bands read at once. A white rim
  around the silhouette holds the shape together.
- **Band glyphs:** **both** band motifs, overlaid at the center — the cyan
  **ring glyph** and the magenta **diamond glyph**. The game reads its bands
  by **shape as well as color** (a ring motif for cyan, a diamond motif for
  magenta), and the Flux carries both because it is between them.
- **Shimmer:** a few white flecks around the body sell the flicker — the
  telegraph of a drone settled on neither band.

## Working the tool

Build the sprite up in sensible layers — lay down the body, paint one half
cyan and the other magenta, add the white rim, then overlay the ring and
diamond glyphs and the shimmer flecks. Run `draw --help` for the available
operations (filling and stroking circles and rectangles, lines, single pixels,
flood fill, and a horizontal mirror) and `draw <operation> --help` for each
one's exact flags. Call `draw` once per operation and read `canvas.png` between
calls to judge your progress against this brief.
