# Lattice Assembler — drawing brief

You are drawing the **Lattice Assembler**, a **sprite sheet** for Lattice, a
top-down factory simulation. The assembler is the **3×3 crafting machine**: it
covers a 3×3 block of tiles, takes in input items, works for a while, and
deposits a finished output. Everything below describes the *machine* and its
working animation — not the items it crafts, and not the belts or inserters
around it.

## The style — flat, top-down 2D

Lattice is drawn **flat**. You are looking straight down at the factory floor,
and every sprite is a clean **2D shape on the grid**: crisp outlines, flat areas
of color, and shading used to tell one part from another rather than to fake a
third dimension.

- **No faux 3D.** No raised top face, no sides beveling away to the floor, no
  cast shadow implying the machine stands up off the ground. The assembler is a
  shape on the floor, not a solid block seen from an angle.
- **The machine's character comes from what is drawn *on* it** — plating, panel
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
  sheet has **8 frames, numbered 0–7**.
- The machine is **3×3 tiles at 32 px per tile**, so it fills the whole 96×96
  frame. Leave only a **1–2 px margin** at the edges — the assembler should read
  as a big, solid machine, centred, neither tiny nor clipped.

## The machine

At a glance the Lattice Assembler reads as a **heavy industrial crafting
machine** filling its 3×3 footprint:

- **Chassis:** a solid, near-square body of grey-blue plated metal that fills the
  footprint, bounded by a heavy dark outline. Build its surface out of the three
  grey-blue tones — plating, panel seams, and whatever mechanical detailing sells
  it as machinery. Keep it symmetric so it has no facing.
- **A working area:** somewhere on the machine, a region that is visibly *where
  the work happens* — and it is where the animation lives. Its shape, size, and
  placement are yours to choose; what matters is that a viewer can tell at a
  glance which part of the machine is doing something.
- **Hazard accents:** **amber warning markings** — stripes, chevrons, hatching,
  corner flashes, whatever reads as industrial hazard marking — paired with the
  dark outline. Keep them as accents, not the whole body.

## The animation

All eight frames are the **same machine**, drawn as a single seamless **working
loop**: frames 0–7 play in order and wrap from 7 back to 0.

The loop has one job: playing 0→7 must read as **the machine actively making
something** — crafting, building, processing, assembling. *How* you show that is
yours to decide. Whatever you choose, it must hold to these:

- **The machine itself holds still.** The chassis sits in exactly the same place
  in every frame. The animation is the *work happening*, not the machine moving,
  wobbling, or changing shape.
- **Teal means running.** The teal tones are the machine's "it is working"
  signal, and the loop should use them — a viewer glancing at the sheet should be
  able to tell the machine is powered and busy rather than idle. Teal appears
  nowhere else on the sprite.
- **Seamless.** Frame 7 must hand back to frame 0 with no visible jump, reset, or
  backward slip.
- **Every frame distinct.** Give all eight frames their own state so the eye sees
  a continuous cycle, not two images alternating in place.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Chassis grey-blue — light | `#6a7884` |
| Chassis grey-blue — mid | `#4d5a64` |
| Chassis grey-blue — dark | `#36424b` |
| Active / working — teal | `#38c6d6` |
| Active / working — pale teal | `#9af0f7` |
| Hazard accent — amber | `#e6b329` |

The two teals are the **working state** — use them only for the animated working
area, nowhere else. The amber is only for the hazard markings (paired with the
`#1b1d21` outline).

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame
coordinates (0–95). Run `draw-sheet --help` for the available operations (filling
and stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and `draw-sheet <operation> --help` for each one's exact flags.
Call `draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief. Check the eight frames in sequence so the
working loop reads smoothly, including the wrap from frame 7 back to frame 0.
