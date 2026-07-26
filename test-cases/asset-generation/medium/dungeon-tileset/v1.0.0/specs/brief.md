# Dungeon Tileset — drawing brief

You are drawing a **top-down dungeon tileset**, a **single sprite** that holds a
**3x3 grid of nine 32x32 tiles**. It is the building kit for a top-down
dungeon-crawler level: a level editor snaps these square tiles together to lay out
stone rooms, corridors, doors, and stairs. The set has to read as one cohesive
place — **cold, dark, damp dungeon stone lit from above, with a single lit brazier
as the one warm accent** — and every tile has to be recognizable on its own.

## The canvas

- A single **96x96-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward (0–95).
- The frame is a **3x3 grid of nine 32x32 cells**. A tile in grid column `c` and
  row `r` (both 0–2) fills the rectangle from `x = 32*c`, `y = 32*r`, 32 wide and
  32 tall. Keep every tile inside its own cell and aligned to the 32-pixel grid —
  no drift, no clipping across a cell boundary.
- Draw on full **transparency**: the stone and objects are opaque, and any pixel
  you intentionally leave bare (for example around the flame) stays transparent —
  do **not** flood the background with a color.
- **Do not draw grid lines** between the cells. The grid should be felt through the
  changing subjects, not outlined. Where two floor tiles would sit side by side
  their stone should continue without a visible seam.

## The nine tiles

Lay the tiles out in exactly these positions:

| | Column 0 (x 0–31) | Column 1 (x 32–63) | Column 2 (x 64–95) |
| --- | --- | --- | --- |
| **Row 0** (y 0–31) | Stone floor | Cracked stone floor | Mossy floor |
| **Row 1** (y 32–63) | Brick wall front-face | Wall-top cap | Closed wooden door |
| **Row 2** (y 64–95) | Stairs descending | Rubble & bones floor | Lit floor brazier |

What each tile is:

- **Stone floor** — plain flagstone seen from directly above: a few large stone
  flags in the stone tones separated by thin dark **mortar** joints, with light and
  dark speckling so it does not read as flat gray. This is the base floor and it
  must **tile seamlessly**: its edges continue into a copy of itself with no seam.
- **Cracked stone floor** — the same flagstone, but broken: a jagged **crack** or
  two in the dark mortar/shadow tone splitting a flag, with a chip of missing stone.
  Still reads as the same floor, just damaged.
- **Mossy floor** — the same flagstone overgrown with **moss**: irregular patches
  of the moss green creeping across the flags and gathering in the mortar joints,
  damp and dark. Not a solid green square — stone still shows through.
- **Brick wall front-face** — a wall seen **straight-on** (a vertical face, not from
  above): courses of **bricks** in the stone tones, offset row to row, with dark
  **mortar** lines between them and a little top-lit highlight on each brick's upper
  edge. This is the standing wall a player sees ahead of them.
- **Wall-top cap** — the **top** of that wall seen from above: a solid band of
  stone, lighter where the top catches the overhead light and dropping to **shadow**
  along one edge, so that placed above the wall face it reads as the wall's capstone
  turning from top to front.
- **Closed wooden door** — a shut door filling most of the cell: vertical **wood**
  planks in the wood tone with darker seams between them, bound by two horizontal
  **iron** bands and an iron ring or stud handle, set into a thin stone frame. It
  reads as solid and closed.
- **Stairs descending** — stone steps dropping **down into the dark**: a short flight
  of horizontal step edges in the stone tones, each step a little darker than the one
  above it, falling to near-black **shadow** at the bottom so the stair clearly heads
  down into blackness.
- **Rubble & bones floor** — the stone floor strewn with debris: scattered chunks of
  broken stone (**rubble**) and a few pale **bones** (use the lightest stone tone for
  the bone) lying on the flags, with dark shadow beneath them. Cluttered and grim.
- **Lit floor brazier** — a floor with a **stone bowl brazier burning** at its
  center: a round **iron**/stone bowl on a short base, a **flame** rising from it,
  and a warm **glow** cast onto the surrounding floor. The flame and glow are the
  **only warm colors in the whole set** and should be the brightest, most
  eye-catching thing on the tileset.

## The read

The nine cells together read as one **top-down dungeon kit**: gray, damp, torch-lit
stone where every tile is a different, recognizable piece, the floors tile without
seams, the wall face and wall-top cap clearly show the wall from two angles, and the
lone brazier glows warm against all the cold stone.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Stone light (top-lit highlight, bone) | `#9a9aa3` |
| Stone mid (base stone) | `#6b6b73` |
| Stone dark (crevice, low light) | `#3f3f47` |
| Mortar (joints between stones/bricks) | `#26262b` |
| Moss (overgrowth) | `#5f7a3a` |
| Wood (door planks) | `#6b4a2b` |
| Iron (door bands, brazier bowl) | `#4a4a52` |
| Flame / glow (brazier accent) | `#f2a03d` |
| Shadow (deep dark, descending stair) | `#1c1c20` |

## Working the tool

Block in each 32x32 cell in the base stone first, then work the detail into it: use
rectangle operations for the flags, bricks, wall bands, door planks, and step edges;
short lines and single pixels for the mortar joints, cracks, moss patches, bones,
and brazier flame; and the flame/glow tone only in the brazier cell. Build the three
floor tiles so they tile — keep their edges continuous — and keep every tile inside
its 32-pixel cell. Run `draw --help` for the available operations and
`draw <operation> --help` for each one's exact flags. Call `draw` once per operation
and read `canvas.png` between calls to judge it against this brief — it should read
at a glance as a 3x3 grid of nine distinct dungeon tiles, dark stone with one warm
brazier, on full transparency.
