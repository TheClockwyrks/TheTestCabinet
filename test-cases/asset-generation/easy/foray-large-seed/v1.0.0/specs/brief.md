# Foray Large Seed — drawing brief

You are drawing the **large seed**, a single 16×16 sprite for *Foray*, a
top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds; alongside the ordinary seed caches sits the **large seed — the moving
prize**, worth (and weighing) **three** ordinary caches. It is the one fixture
on the board that drifts a tile at a time toward the border, so it has to be the
thing the eye lands on first. You are drawing the *large seed on the board*. Like
an ordinary cache it belongs to **neither colony** — it is a shared prize, so the
sprite is *not* recolored (see **Palette**).

## The canvas

- **16×16 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward (coordinates 0–15).
- The seed is seen from directly above (top-down): draw it **centered**, filling
  most of the 16×16 cell with about a pixel of margin — it sits in one board
  tile, never clipped at the edge.

## The form

The large seed reads, at a glance, as **one big golden seed** — the prize on the
tile, the big sibling of an ordinary cache:

- **A single kernel:** one large, rounded, slightly oval golden seed that fills
  most of the cell — a single object, *not* a pile or cluster of small seeds and
  *not* a tiny dot. It should read as clearly bigger and worth more than an
  ordinary cache.
- **Outline:** a dark outline runs all the way around the kernel so the one big
  shape stays legible against the board floor and reads apart from an ordinary
  seed at a glance.
- **Highlight:** a brighter gold glint on the top of the kernel so it reads as
  rounded and catches the light — the moving prize should look valuable and worth
  chasing down.

## Palette

A large seed is **shared and never recolored** — the same gold for both colonies
(it must stay gold so a laden raider's carried seed pops against either colony).
Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Seed gold (body) | `#e8c14a` |
| Bright gold (highlight) | `#ffd964` |
| Outline | `#0a0806` |

The kernel is the gold `#e8c14a` with a brighter `#ffd964` glint, outlined in
`#0a0806`. Do not use any other color — in particular no red or blue: the seed
is neutral gold.

## Working the tool

Build the sprite up in sensible layers — the dark outline of the kernel, then the
gold body, then the bright glint on top — using plain canvas coordinates (0–15).
Run `draw --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw <operation> --help` for each one's exact flags. Call `draw` once per
operation and read `canvas.png` between calls to judge your progress against this
brief.
