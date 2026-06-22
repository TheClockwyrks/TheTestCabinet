# Lattice Items — drawing brief

You are drawing the **Lattice item icons**, a **sprite sheet** for a factory
simulation. Each of the eight frames holds **one distinct item** that rides the
belts — a metal plate, an ore, a stone, a gear, or a circuit board. The eight are
not an animation: each is a separate static icon, and together they must read as
**one cohesive icon family**. Everything below describes the *items*, never the
machines or belts that carry them.

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–15) — there is no shared sheet
  to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **8 frames, numbered 0–7**, one item each (see the table below).
- Belt items are tiny — drawn at roughly half a tile — so each icon must read at
  16×16 by **silhouette and color alone**. Centre each icon in its frame with
  about a **one-pixel margin**: it should fill most of the 16×16 cell, neither tiny
  in a corner nor clipped at the edge.

## What goes in each frame

| Frame | Item | Subject and silhouette |
| --- | --- | --- |
| 0 | **Iron plate** | a flat rectangular metal plate with a slight 3D edge (a thin bright top edge and a thin dark bottom edge), neutral blue-grey |
| 1 | **Copper plate** | the **same** flat plate shape, in a warm orange copper tone |
| 2 | **Steel plate** | the same plate shape with a brighter, cooler sheen and a faint horizontal highlight band across it |
| 3 | **Iron ore** | a rough, lumpy **cluster of nuggets** (an irregular, bumpy outline, not a smooth shape), blue-grey |
| 4 | **Copper ore** | a rough cluster of nuggets like the iron ore but orange, dotted with a few small teal-green flecks |
| 5 | **Stone** | a single **rounded tan rock** — one smooth lumpy boulder, not a cluster |
| 6 | **Iron gear wheel** | a toothed **cog ring** — a circular ring with a few square teeth around its rim and a clear **hole through the centre** |
| 7 | **Electronic circuit** | a small **green circuit board** (a rounded rectangle) with a couple of thin gold traces and two or three small red contact dots |

The three plates (frames 0–2) share one flat-plate silhouette and are told apart
by **tone**. The ores and stone (frames 3–5) are **rough and lumpy** and told apart
by **color and shape** (clustered nuggets vs. one rounded rock). The gear
(frame 6) and the circuit (frame 7) have their own distinct silhouettes. No two
frames may read alike.

## Consistency across the family

So the eight read as one set, give every icon:

- **One outline.** A dark outline/shadow in the shared outline color `#1b1d21`
  around each item's silhouette (and used for the gear's central hole and the
  circuit's darkest accents).
- **One light direction.** Simple top-left lighting on every icon: the highlight
  tone sits toward the **upper-left**, the shadow tone toward the **lower-right**.
  Keep it consistent so the whole set is lit the same way.

## Palette

Use only these colors. Each icon may use **only the colors listed for it**, plus
the **shared outline** `#1b1d21`. The drawing is regenerated pixel-for-pixel, so
stray or off-palette colors and anti-aliased fringes count against you — keep
edges crisp and the silhouette clean.

| Frame | Item | Allowed colors (plus outline `#1b1d21`) |
| --- | --- | --- |
| 0 | Iron plate | base `#b9c0cb` · highlight `#e3e8ef` · shadow `#6f7884` |
| 1 | Copper plate | base `#cf7a3c` · highlight `#f0a96a` · shadow `#8a4a1f` |
| 2 | Steel plate | base `#cfd6df` · highlight `#f2f5fa` · shadow `#7d8794` |
| 3 | Iron ore | base `#8c98a8` · highlight `#b4bdc9` · shadow `#5d6776` |
| 4 | Copper ore | base `#c98a4a` · highlight `#e3b079` · fleck `#3a8f86` |
| 5 | Stone | base `#b7a07f` · highlight `#d6c4a3` · shadow `#7e6c50` |
| 6 | Iron gear wheel | base `#7d8794` · highlight `#aab3bf` · shadow `#4d5560` |
| 7 | Electronic circuit | board `#3f9e57` · highlight `#6fce86` · traces gold `#e6b329` · contacts red `#d6473a` |

Shared outline / shadow on every icon: `#1b1d21`.

## Working the tool

The `draw-sheet` binary is the **only** way to make a mark — anything drawn any
other way is discarded. Build each icon up in sensible layers (a dark outline, then
the base fill, then the highlight and shadow, then any details), drawing into the
frame you select with `--frame <index>` and using plain in-frame coordinates
(0–15). Run `draw-sheet --help` for the available operations (filling and stroking
circles and rectangles, lines, single pixels, flood fill, and a horizontal mirror)
and `draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and **read `frames/<index>.png` between calls** to judge that
icon against this brief. A good order is to finish the three plates first (they
share a shape), then the ores and stone, then the gear and the circuit, checking
each against the table as you go.
