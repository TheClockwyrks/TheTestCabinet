# Foray Seed Cache — drawing brief

You are drawing the **seed cache**, a single 16×16 sprite for *Foray*, a
top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds; a **seed cache is the scorable resource** sitting on the board — what a
raider grabs, carries home, and banks for points. You are drawing the *cache on
the board*. Seeds belong to **neither colony** — they are a shared prize, so the
sprite is *not* recolored (see **Palette**).

## The canvas

- **16×16 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward (coordinates 0–15).
- The cache is seen from directly above (top-down): draw it **centered**,
  filling most of the 16×16 cell with about a pixel of margin — it sits in one
  board tile, never clipped at the edge.

## The form

The cache reads, at a glance, as a **little pile of golden seeds** — the prize on
the tile:

- **Cluster:** a small heap of **two or three rounded golden seeds** nestled
  together, reading as a cache rather than a single dot — slightly irregular, as
  a real pile would be, not one perfect circle.
- **Seed shape:** each seed a rounded, slightly oval kernel with a darker outline
  so the individual seeds read apart within the heap.
- **Highlight:** a brighter gold glint on the top of the seeds so they read as
  rounded and catch the light — the cache should look valuable and worth raiding.

## Palette

A seed cache is **shared and never recolored** — the same gold for both colonies
(it must stay gold so a laden raider's carried seed pops against either colony).
Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Seed gold (body) | `#e8c14a` |
| Bright gold (highlight) | `#ffd964` |
| Outline | `#0a0806` |

The seeds are the gold `#e8c14a` with a brighter `#ffd964` glint, outlined in
`#0a0806`. Do not use any other color — in particular no red or blue: the cache
is neutral gold.

## Working the tool

Build the sprite up in sensible layers — the dark outlines of the heap, then the
gold seed bodies, then the bright glint on top — using plain canvas coordinates
(0–15). Run `draw --help` for the available operations (filling and stroking
circles and rectangles, lines, single pixels, flood fill, and a horizontal
mirror) and `draw <operation> --help` for each one's exact flags. Call `draw`
once per operation and read `canvas.png` between calls to judge your progress
against this brief.
