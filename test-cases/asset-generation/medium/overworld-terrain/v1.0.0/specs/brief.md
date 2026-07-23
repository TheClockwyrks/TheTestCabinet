# Overworld Terrain Tiles — drawing brief

You are drawing an **overworld terrain tileset**, a **single 96x96 sprite** for a
top-down RPG. It is a **3x3 grid of nine 32x32 tiles**, each one a different kind
of ground, drawn so it **tiles seamlessly** — the terrain a whole storybook world
gets painted from. Every tile must read clearly for what it is, and repeat without
a seam when it is laid next to a copy of itself.

## The canvas

- A single **96×96-pixel** image. Origin is the top-left; `x` increases to the
  right, `y` increases downward (0–95).
- The sheet is exactly **three rows by three columns of 32×32 cells**. The cell
  boundaries fall on multiples of 32:
  - Columns start at `x = 0`, `x = 32`, `x = 64`.
  - Rows start at `y = 0`, `y = 32`, `y = 64`.
- **Fill every cell completely and opaquely** — this is ground, so no pixel should
  be left transparent and nothing should show through. Keep each tile's drawing
  inside its own 32×32 cell; do not let a mark cross a cell boundary into a
  neighbor.

## The nine tiles (fixed layout)

Draw each terrain in its assigned cell. Positions are `(row, column)`, 0-based,
each a 32×32 square:

| Cell | Terrain | Reads as |
| --- | --- | --- |
| (0, 0) | **Grass** | A field of bright green grass with a few short blade specks. |
| (0, 1) | **Water** | Open blue water with gentle ripple lines. |
| (0, 2) | **Sandy beach** | Warm pale sand with a light scatter of grain speckles. |
| (1, 0) | **Dirt path** | Packed brown earth, a walkable path, lightly pitted. |
| (1, 1) | **Dense forest canopy** | Treetops from above — clumps of dark green leaves with lighter highlights. |
| (1, 2) | **Rocky mountain** | Grey rock and stone, faceted, with darker cracks and lighter tops. |
| (2, 0) | **Tilled crop field** | Brown soil worked into even parallel furrows (planting rows). |
| (2, 1) | **Shallow-water edge** | Pale shallow water meeting sand — the wet fringe where sea meets beach. |
| (2, 2) | **Stone bridge** | Fitted grey stone blocks — a paved bridge/road deck with mortar lines. |

## Seamless tiling

Each tile is meant to be repeated across a map, so **every tile must tile
seamlessly against a copy of itself** on all four sides. In practice that means
the texture inside a cell should wrap: whatever you draw touching the top edge
should line up with what touches the bottom edge, and the same for left and right.
Keep textures as even, all-over patterns (scattered specks, repeating ripple
lines, rows of furrows, a regular block grid) rather than one big feature centered
in the cell that would obviously break at the seam. Avoid a hard border ring around
a tile — a framed edge always reads as a seam when the tile repeats.

The **shallow-water edge** and **stone bridge** tiles are the exceptions to
"all-over" texture and only need to tile cleanly **left-to-right** (they are meant
to run in a horizontal strip): draw their features — the water/sand fringe and the
bridge's block courses — as horizontal bands so the left and right edges still
match a neighbor.

## Style

One cohesive, **bright storybook** overworld: saturated but friendly terrain
colors, clear reads, and light hand-placed texture. Use the light/dark variants of
each color to give a little depth (a lighter highlight, a darker speck or line) —
not flat single-color squares, but not noisy or grimy either. The nine tiles
should look like they belong to the same set.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you). Each terrain uses
its base color plus, where it helps, the matching light/dark variant for texture:

| Role | Hex |
| --- | --- |
| Grass (light) | `#7ec850` |
| Grass (dark) | `#4e9a34` |
| Water (light) | `#4aa3e0` |
| Water (dark) | `#2f7fc4` |
| Shallow water | `#8fd6ee` |
| Sand (light) | `#f3dca4` |
| Sand (dark) | `#dcbb78` |
| Dirt (light) | `#c1904f` |
| Dirt (dark) | `#96662f` |
| Forest canopy (dark) | `#2f7d3f` |
| Forest highlight (light) | `#57ad5a` |
| Rock (light) | `#9aa1a9` |
| Rock (dark) | `#676e77` |
| Stone (light) | `#bcb6aa` |
| Stone (dark) | `#8a8478` |

## Working the tool

Block in each cell's base color first with a 32×32 filled rectangle at the cell's
origin, then lay texture on top — short lines, small rectangles, and single pixels
for grass blades, water ripples, sand grains, dirt pitting, canopy clumps, rock
facets, furrow rows, the wet fringe, and the bridge's block courses. Work cell by
cell, keeping each tile inside its 32×32 square. Run `draw --help` for the
available operations and `draw <operation> --help` for each one's exact flags. Call
`draw` once per operation and read `canvas.png` between calls to judge it against
this brief — the nine terrains should each read clearly, tile without a seam, and
sit together as one bright storybook overworld set.
