# Lattice Assembler — drawing brief

You are drawing the **Lattice Assembler**, a **sprite sheet** for Lattice, a
top-down factory simulation. The assembler is the **3×3 crafting machine**: it
covers a 3×3 block of tiles, takes in input items, works for a while, and
deposits a finished output. Everything below describes the _machine_ and its
working animation — not the items it crafts, and not the belts or inserters
around it.

The assembler comes in **three tiers** — a base machine, a faster reinforced
machine, and the fastest, most advanced machine — and this one sheet carries all
three. Every tier is **the same assembler**, built from one construction language;
the tiers are upgrades of a single machine, not three different machines. A player
has to see at a glance that all three are the same assembler, only progressively
upgraded.

## The style — flat, top-down 2D

Lattice is drawn **flat**. You are looking straight down at the factory floor,
and every sprite is a clean **2D shape on the grid**: crisp outlines, flat areas
of color, and shading used to tell one part from another rather than to fake a
third dimension.

- **No faux 3D.** No raised top face, no sides beveling away to the floor, no
  cast shadow implying the machine stands up off the ground. The assembler is a
  shape on the floor, not a solid block seen from an angle.
- **The machine's character comes from what is drawn _on_ it** — plating, panel
  seams, bolts, vents, warning markings — not from pretending it has height.
- **No facing.** The assembler is square and **non-directional**: it has no
  front, no back, and no nose, so it reads correctly however the factory is
  oriented. Keep it symmetric.

## The frames

- Each frame is its own **96×96-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–95) — there is no shared
  sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **24 frames, numbered 0–23**, in three tiers of eight:

  | Frames    | Tier                        | Hazard accent |
  | --------- | --------------------------- | ------------- |
  | `0`–`7`   | Tier 1 — base               | amber         |
  | `8`–`15`  | Tier 2 — reinforced, faster | red-orange    |
  | `16`–`23` | Tier 3 — advanced, fastest  | blue          |

- Each tier's eight frames are one **craft loop**.
- The machine is **3×3 tiles at 32 px per tile**, so it fills the whole 96×96
  frame. Leave only a **1–2 px margin** at the edges — the assembler should read
  as a big, solid machine, centred, neither tiny nor clipped.

## The three tiers

The three tiers are the **same assembler crafting faster**. What changes from one
tier to the next is exactly three things — the **hazard accent color**, the
**amount of mechanical detail**, and the **crafting speed** — and nothing else.
The grey-blue chassis, the footprint, the silhouette, and the teal working state
stay the same, so a higher tier is unmistakably the same machine, only upgraded.

| Tier   | Hazard accent | Mechanical detail                                                                           | Speed   |
| ------ | ------------- | ------------------------------------------------------------------------------------------- | ------- |
| Tier 1 | amber         | the base machine — plain plating, one working area                                          | base    |
| Tier 2 | red-orange    | reinforced — corner brackets or bolt lines, a secondary panel or vent, richer plating       | faster  |
| Tier 3 | blue          | the most advanced — the densest plating and detailing, a subtle energy glow along the frame | fastest |

- **Hazard accent color.** The **hazard markings** carry the tier's accent color —
  amber, then red-orange, then blue — paired with the dark outline. The grey-blue
  chassis tones and the teal working state are the **same in every tier**; only the
  hazard accent is recolored. A glance at the hazard color alone tells the tiers
  apart.
- **The teal working state is shared.** In every tier the working area glows the
  **same teal** — it is the machine's constant "it is running" signal and the one
  thing that does not change color from tier to tier. Do not confuse the tier-3
  **blue** hazard accent with the teal working state: the blue rides the chassis
  frame and markings, the teal lives only in the working area.
- **Mechanical detail rises tier to tier.** Tier 1 is the plainest machine. Tier 2
  adds reinforcement — corner brackets or bolt lines, a secondary panel or vent,
  richer plating. Tier 3 is the densest and most refined: the finest plating and
  detailing plus a **subtle energy glow** (a thin bloom of pale blue) along the
  chassis frame. Each step adds richness without changing the machine's footprint
  or silhouette.
- **Higher tiers craft faster.** Each tier is drawn as its own eight-frame craft
  loop; the renderer plays a higher tier's loop back at a higher rate, so the
  upgrade reads as a faster machine. You do not change the per-frame drawing to
  convey speed — draw each tier's loop the same way, and the playback does the
  rest.

## The machine

At a glance the Lattice Assembler reads as a **heavy industrial crafting
machine** filling its 3×3 footprint:

- **Chassis:** a solid, near-square body of grey-blue plated metal that fills the
  footprint, bounded by a heavy dark outline. Build its surface out of the three
  grey-blue tones — plating, panel seams, and whatever mechanical detailing sells
  it as machinery. Keep it symmetric so it has no facing. The chassis is the
  **same in every tier**, gaining only reinforcement detail as the tier rises.
- **A working area:** somewhere on the machine, a region that is visibly _where
  the work happens_ — and it is where the animation lives. Its shape, size, and
  placement are yours to choose; what matters is that a viewer can tell at a
  glance which part of the machine is doing something. Place it the same way in
  every tier.
- **Hazard accents:** **warning markings** in the tier's accent color — stripes,
  chevrons, hatching, corner flashes, whatever reads as industrial hazard marking
  — paired with the dark outline. Keep them as accents, not the whole body.

## The animation

Within each tier the eight frames are the **same machine**, drawn as a single
seamless **working loop**: the tier's frames play in order and wrap from the last
back to the first.

The loop has one job: playing it through must read as **the machine actively
making something** — crafting, building, processing, assembling. _How_ you show
that is yours to decide. Whatever you choose, it must hold to these:

- **The machine itself holds still.** The chassis sits in exactly the same place
  in every frame. The animation is the _work happening_, not the machine moving,
  wobbling, or changing shape.
- **Teal means running.** The teal tones are the machine's "it is working"
  signal, and every tier's loop should use them — a viewer glancing at the sheet
  should be able to tell the machine is powered and busy rather than idle. Teal
  appears nowhere else on the sprite, and it is the same teal in every tier.
- **Seamless.** The last frame of each tier's loop must hand back to its first
  with no visible jump, reset, or backward slip.
- **Every frame distinct.** Give all eight frames of a tier their own state so the
  eye sees a continuous cycle, not two images alternating in place.

The craft is drawn the same way in every tier; the tiers differ only in the hazard
accent, the level of detail, and the rate the loop is played back at — so the
higher tiers read as faster machines without being drawn any differently frame to
frame.

## Palette

Use only these colors. The chassis and the teal working state are shared by every
tier; each tier draws its hazard markings in its own accent color.

### Shared body — every tier

| Role                         | Hex       |
| ---------------------------- | --------- |
| Dark outline / shadow        | `#1b1d21` |
| Chassis grey-blue — light    | `#6a7884` |
| Chassis grey-blue — mid      | `#4d5a64` |
| Chassis grey-blue — dark     | `#36424b` |
| Active / working — teal      | `#38c6d6` |
| Active / working — pale teal | `#9af0f7` |

### Tier hazard accents

| Tier   | Role                    | Hex       |
| ------ | ----------------------- | --------- |
| Tier 1 | Hazard — amber          | `#e6b329` |
| Tier 2 | Hazard — red-orange     | `#e6602a` |
| Tier 3 | Hazard — blue           | `#2f7fe6` |
| Tier 3 | Energy glow — pale blue | `#a9d4ff` |

The two teals are the **working state** — use them only for the animated working
area, nowhere else, in every tier. The hazard accent color is only for the tier's
hazard markings (paired with the `#1b1d21` outline). The tier-3 **energy glow** is
a thin bloom of pale blue used sparingly along the chassis frame; it appears in no
other tier.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame
coordinates (0–95). Run `draw-sheet --help` for the available operations (filling
and stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and `draw-sheet <operation> --help` for each one's exact flags.
Call `draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief. Check each tier's eight frames in sequence so
the working loop reads smoothly, including the wrap from its last frame back to its
first.
