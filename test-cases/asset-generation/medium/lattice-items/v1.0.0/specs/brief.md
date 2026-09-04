# Lattice Items — drawing brief

You are drawing the **Lattice item icons**, a **sprite sheet** for a factory
simulation. Each of the seventeen frames holds **one distinct inventory item**, and
together they must read as **one cohesive icon family**. The set has two groups:

- **Eight base items** (frames 0–6 and 16) — the raw and intermediate materials
  that ride the belts: an ore, a metal plate, a gear, a coil of cable, a circuit
  board, and a lump of coal. Seven sit in frames 0–6; the eighth, **coal**, sits at
  **frame 16**, after the machines (it was added to the set last, and the frame
  order never shifts an existing item — see [Coal](#coal-frame-16) below).
- **Nine machine items** (frames 7–15) — the placeable machines, each an *item
  icon* of the machine as it looks in the inventory, not the machine drawn in the
  world. There are three machine types (a belt, an assembler, an inserter), and each
  type comes in **three tiers**, so every tier is its own icon.

The seventeen are not an animation: each is a separate static icon. Everything below
describes the *items*, never the belts or world they sit in.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–31) — there is no shared sheet
  to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **17 frames, numbered 0–16**, one item each (see the tables below).
- Author each icon at the full **32×32** so there is enough resolution to read small
  details — the gear's teeth, a belt's chevrons, an inserter's claw. Each icon must
  still read by **silhouette and color alone**. Centre each icon in its frame with
  about a **two-pixel margin**: it should fill most of the 32×32 cell, neither tiny
  in a corner nor clipped at the edge.
- The frame order is **fixed**, so frame `N` is always the same item. Do not reorder
  them.

## The base items (frames 0–6)

| Frame | Item | Subject and silhouette |
| --- | --- | --- |
| 0 | **Iron ore** | a rough, lumpy **cluster of nuggets** (an irregular, bumpy outline, not a smooth shape), blue-grey |
| 1 | **Iron plate** | a flat rectangular metal plate with a slight 3D edge (a thin bright top edge and a thin dark bottom edge), neutral blue-grey |
| 2 | **Iron gear wheel** | a toothed **cog ring** — a circular ring with a few square teeth around its rim and a clear **hole through the centre** |
| 3 | **Copper ore** | a rough cluster of nuggets like the iron ore but orange, dotted with a few small teal-green flecks |
| 4 | **Copper plate** | the **same** flat plate shape as the iron plate, in a warm orange copper tone |
| 5 | **Copper cable** | a loose **bundle of thin wire** — two or three curved strands looping across the frame, clearly stringy and linear rather than one solid mass, in the same copper tone as the plate |
| 6 | **Electronic circuit** | a small **green circuit board** (a rounded rectangle) with a couple of thin gold traces and two or three small red contact dots |

The base set is built from three deliberate pairings, each resolved a different way:

- **The two ores** (frames 0 and 3) share the rough lumpy cluster silhouette and are
  told apart by **color** — blue-grey iron against orange copper with its teal-green
  flecks.
- **The two plates** (frames 1 and 4) share one flat-plate silhouette and are told
  apart by **tone** — neutral blue-grey against warm orange.
- **The copper plate and the copper cable** (frames 4 and 5) share the *same copper
  tone* and are told apart by **silhouette** — one solid flat sheet of stock, the
  other thin looping strands with gaps you can see through. Draw the cable as wire,
  not as a smaller plate.

The gear (frame 2) and the circuit (frame 6) each have their own unmistakable
silhouette. No two frames may read alike.

### Coal (frame 16)

Coal is an **eighth base item**, but it is drawn at **frame 16**, after the nine
machines — not squeezed in among the other materials. The frame order is a fixed
contract (frame `N` is always the same item), and coal was added to the set after
the machines already held frames 7–15, so it takes the next free index rather than
shifting everything down. Draw it at `--frame 16`.

| Frame | Item | Subject and silhouette |
| --- | --- | --- |
| 16 | **Coal** | a rough, lumpy **cluster of chunks** — the *same* silhouette as the two ores — in a **near-black charcoal** with a cool blue-grey sheen and a few small glints, no flecks |

Coal completes a fourth deliberate pairing: it shares the **ores'** lumpy-cluster
silhouette (frames 0 and 3) and is told apart from both by **tone alone** — a
near-black charcoal against the blue-grey iron and the orange copper. Give it a
couple of small cool glints so the near-black pile reads as glossy coal rather than
a dark rock, and **no teal-green flecks** (those belong to the copper ore).

## The machine items (frames 7–15)

Each machine icon is a small, iconic view of the machine as an inventory item — a
low **3-quarter** angle, drawn on the shared steel chassis tones. The three types
have three clearly different silhouettes:

- **Belt** — a short straight segment of conveyor: a dark running band between two
  grey side rails, with forward-pointing **chevron arrows** marching along the band.
  Wider than it is tall.
- **Assembler** — a boxy machine: a rounded square casing with a **domed panel on
  top carrying a cog** motif, and small vent or pipe nubs at the corners. Roughly
  square.
- **Inserter** — a small base plate with an upright **pivoting arm** rising from a
  round joint, the arm ending in a two-pronged **claw** reaching up and over. Taller
  than it is wide.

Each type appears in three **tiers**. The three tiers of a type share **one
silhouette and one construction** — only the **accent color** and the **amount of
detail** change — so they are instantly told apart by their accent while still
obviously being the same machine.

| Frame | Item | Tier | Silhouette and tier detail |
| --- | --- | --- | --- |
| 7 | **Belt (tier 1)** | 1 | belt segment, **one** chevron pair on the band, plain rails; amber accent |
| 8 | **Belt (tier 2)** | 2 | same belt, **two** chevron pairs and a bolt stud on each rail; red accent |
| 9 | **Belt (tier 3)** | 3 | same belt, **three** chevron pairs and ribbed rails; cyan accent |
| 10 | **Assembler (tier 1)** | 1 | box with **one** cog on the dome, plain casing; amber accent |
| 11 | **Assembler (tier 2)** | 2 | box with **two** interlocking cogs on the dome and one extra corner vent; red accent |
| 12 | **Assembler (tier 3)** | 3 | box with a **cluster of three** cogs and corner pipes; cyan accent |
| 13 | **Inserter (tier 1)** | 1 | base and a single straight arm with a simple two-prong claw; amber accent |
| 14 | **Inserter (tier 2)** | 2 | base and an **elbowed** arm with a reinforced claw; red accent |
| 15 | **Inserter (tier 3)** | 3 | base and a **taller multi-segment** arm with a wide three-prong claw and a counterweight; cyan accent |

The **tier accent** is what the eye catches first and it follows one convention
across all three machine types:

| Tier | Accent | Complexity |
| --- | --- | --- |
| 1 | **amber** | simplest — the fewest accent marks and a plain chassis |
| 2 | **red / orange** | more complex — one added detail over tier 1 |
| 3 | **cyan / blue** | most complex — the fullest detail |

So a reviewer reads a machine's **type** from its silhouette and its **tier** from
the accent color and how much detail it carries. The accent appears on the moving or
working part of each machine: the belt's chevrons, the assembler's dome and cogs, the
inserter's arm joint and claw.

## Consistency across the family

So the sixteen read as one set, give every icon:

- **One outline.** A dark outline/shadow in the shared outline color `#1b1d21`
  around each item's silhouette (and used for interior separations like the gear's
  central hole, the belt's band, and the circuit's darkest accents).
- **One light direction.** Simple top-left lighting on every icon: the highlight
  tone sits toward the **upper-left**, the shadow tone toward the **lower-right**.
  Keep it consistent so the whole set is lit the same way.
- **One palette family.** The machine chassis tones sit in the same neutral blue-grey
  range as the iron items, and each tier accent is drawn from a color already in the
  base set — the amber echoes the circuit's gold, the red the circuit's contact dots,
  the cyan the copper ore's teal flecks — so the machines never look like a different
  art set bolted on.

## Palette

Use only these colors. Each icon may use **only the colors listed for it**, plus the
shared outline `#1b1d21`.

### Base items

| Frame | Item | Allowed colors (plus outline `#1b1d21`) |
| --- | --- | --- |
| 0 | Iron ore | base `#8c98a8` · highlight `#b4bdc9` · shadow `#5d6776` |
| 1 | Iron plate | base `#b9c0cb` · highlight `#e3e8ef` · shadow `#6f7884` |
| 2 | Iron gear wheel | base `#7d8794` · highlight `#aab3bf` · shadow `#4d5560` |
| 3 | Copper ore | base `#c98a4a` · highlight `#e3b079` · fleck `#3a8f86` |
| 4 | Copper plate | base `#cf7a3c` · highlight `#f0a96a` · shadow `#8a4a1f` |
| 5 | Copper cable | base `#cf7a3c` · highlight `#f0a96a` · shadow `#8a4a1f` |
| 6 | Electronic circuit | board `#3f9e57` · highlight `#6fce86` · traces gold `#e6b329` · contacts red `#d6473a` |
| 16 | Coal | base `#33363d` · highlight `#6b7a86` · shadow `#1e2025` |

The copper cable deliberately shares the copper plate's three tones — it is the same
metal — so the **only** thing separating them is the shape you draw.

### Machine items

Every machine icon uses the **shared chassis** tones below. The belt additionally
uses the **belt band** tone for its dark running surface. On top of that, each icon
uses **only its own tier's accent pair** (never another tier's).

Shared chassis (all nine machines): base `#5a6472` · highlight `#828c9b` · shadow
`#3a404b`. Belt band (belt frames only): `#2c3038`.

| Tier | Accent pair (in addition to the chassis) |
| --- | --- |
| 1 (amber) | accent `#e0a92e` · accent highlight `#f6cf6b` |
| 2 (red) | accent `#d6473a` · accent highlight `#f0715c` |
| 3 (cyan) | accent `#3a9ed6` · accent highlight `#78cff0` |

Shared outline / shadow on every icon: `#1b1d21`.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame you
select with `--frame <index>` and using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet` once
per operation and **read `frames/<index>.png` between calls** to judge that icon
against this brief.
