# Spectra Shard — drawing brief

You are drawing the **Shard**, a single **enemy drone** for *Spectra*, a
two-band formation shooter. The Shard is the basic drone and the bulk of every
formation: a **fixed-band** crystalline drone that dives at the player.
Everything below describes the *enemy* — never the player's ship.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward.
- The drones dive downward at the player, so draw the Shard **oriented
  downward** (a point toward the bottom of the frame).
- Fill most of the frame: the crystal should span roughly 40–52 px, centered
  with a few pixels of margin, never clipped at an edge.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Magenta band | `#ff4ec7` |
| Highlight / glyph | `#ffffff` |

## The form

The Shard reads, at a glance, as a **faceted magenta crystal**:

- **Body:** an angular, faceted **diamond** in the magenta band color — sharp
  geometric edges, pointed top and bottom, not a round blob.
- **Band glyph:** the magenta band's **diamond motif** — a crisp diamond
  outline carried on the body. The game reads its two spectral bands by
  **shape as well as color** (a ring motif for cyan, a diamond motif for
  magenta), so the diamond glyph is part of the Shard's identity, not
  decoration.
- **Glints:** a few white highlight pixels on the upper-left facets, so the
  crystal catches the light.

## Working the tool

Build the sprite up in sensible layers — lay down the magenta diamond body,
then the diamond glyph outline, then the white facet glints. Run `draw --help`
for the available operations (filling and stroking circles and rectangles,
lines, single pixels, flood fill, and a horizontal mirror) and `draw
<operation> --help` for each one's exact flags. Call `draw` once per operation
and read `canvas.png` between calls to judge your progress against this brief
and the target.
