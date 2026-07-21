# Lattice Items — drawing brief

You are drawing the **Lattice item icons**, a **sprite sheet** for a factory
simulation. Each of the seven frames holds **one distinct item** that rides the
belts — an ore, a metal plate, a gear, a coil of cable, or a circuit board. The
seven are not an animation: each is a separate static icon, and together they must
read as **one cohesive icon family**. Everything below describes the *items*, never
the machines or belts that carry them.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–31) — there is no shared sheet
  to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **7 frames, numbered 0–6**, one item each (see the table below).
- Belt items are sub-tile in the world — drawn at roughly half a tile — but you
  author each icon at the full **32×32** so there is enough resolution to read
  small details like the gear's teeth. Each icon must still read by **silhouette
  and color alone**. Centre each icon in its frame with about a **two-pixel
  margin**: it should fill most of the 32×32 cell, neither tiny in a corner nor
  clipped at the edge.
- The frame order is **fixed**: it is the order the simulation itself lists these
  items in, so frame `N` is always the same item. Do not reorder them.

## What goes in each frame

| Frame | Item | Subject and silhouette |
| --- | --- | --- |
| 0 | **Iron ore** | a rough, lumpy **cluster of nuggets** (an irregular, bumpy outline, not a smooth shape), blue-grey |
| 1 | **Iron plate** | a flat rectangular metal plate with a slight 3D edge (a thin bright top edge and a thin dark bottom edge), neutral blue-grey |
| 2 | **Iron gear wheel** | a toothed **cog ring** — a circular ring with a few square teeth around its rim and a clear **hole through the centre** |
| 3 | **Copper ore** | a rough cluster of nuggets like the iron ore but orange, dotted with a few small teal-green flecks |
| 4 | **Copper plate** | the **same** flat plate shape as the iron plate, in a warm orange copper tone |
| 5 | **Copper cable** | a loose **bundle of thin wire** — two or three curved strands looping across the frame, clearly stringy and linear rather than one solid mass, in the same copper tone as the plate |
| 6 | **Electronic circuit** | a small **green circuit board** (a rounded rectangle) with a couple of thin gold traces and two or three small red contact dots |

The set is built from three deliberate pairings, and each pairing is resolved a
different way:

- **The two ores** (frames 0 and 3) share the rough lumpy cluster silhouette and
  are told apart by **color** — blue-grey iron against orange copper with its
  teal-green flecks.
- **The two plates** (frames 1 and 4) share one flat-plate silhouette and are told
  apart by **tone** — neutral blue-grey against warm orange.
- **The copper plate and the copper cable** (frames 4 and 5) share the *same copper
  tone* and are told apart by **silhouette** — one solid flat sheet of stock, the
  other thin looping strands with gaps you can see through. This pair is the
  easiest to get wrong: draw the cable as wire, not as a smaller plate.

The gear (frame 2) and the circuit (frame 6) each have their own unmistakable
silhouette. No two frames may read alike.

## Consistency across the family

So the seven read as one set, give every icon:

- **One outline.** A dark outline/shadow in the shared outline color `#1b1d21`
  around each item's silhouette (and used for the gear's central hole and the
  circuit's darkest accents).
- **One light direction.** Simple top-left lighting on every icon: the highlight
  tone sits toward the **upper-left**, the shadow tone toward the **lower-right**.
  Keep it consistent so the whole set is lit the same way.

## Palette

Use only these colors. Each icon may use **only the colors listed for it**, plus
the **shared outline** `#1b1d21`.

| Frame | Item | Allowed colors (plus outline `#1b1d21`) |
| --- | --- | --- |
| 0 | Iron ore | base `#8c98a8` · highlight `#b4bdc9` · shadow `#5d6776` |
| 1 | Iron plate | base `#b9c0cb` · highlight `#e3e8ef` · shadow `#6f7884` |
| 2 | Iron gear wheel | base `#7d8794` · highlight `#aab3bf` · shadow `#4d5560` |
| 3 | Copper ore | base `#c98a4a` · highlight `#e3b079` · fleck `#3a8f86` |
| 4 | Copper plate | base `#cf7a3c` · highlight `#f0a96a` · shadow `#8a4a1f` |
| 5 | Copper cable | base `#cf7a3c` · highlight `#f0a96a` · shadow `#8a4a1f` |
| 6 | Electronic circuit | board `#3f9e57` · highlight `#6fce86` · traces gold `#e6b329` · contacts red `#d6473a` |

The copper cable deliberately shares the copper plate's three tones — it is the
same metal — so the **only** thing separating them is the shape you draw.

Shared outline / shadow on every icon: `#1b1d21`.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>` and using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet` once
per operation and **read `frames/<index>.png` between calls** to judge that icon
against this brief.
