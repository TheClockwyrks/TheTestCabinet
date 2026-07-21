# Lattice Source — drawing brief

You are drawing the **Lattice source**, a **sprite sheet** for a top-down factory
simulation. It is a **test fixture**, not a normal factory machine: the source
emits a single item onto its output belt once every fixed period of ticks — the
deterministic way items enter the factory, with an infinite supply. The renderer
draws this sprite wherever a scenario places a source. Everything below describes
that source tile, drawn from directly above.

It must read as a piece of **measurement equipment** — a test rig that injects
items — and **not** as a length of belt or a generic assembler. Its matching
fixture, the **sink**, is the drain that consumes items and is marked with a **red**
accent; your source is the emitter and is marked with a **green** accent. Keep the
two visibly distinct.

## Draw the machine only — never an item

The source emits **whatever** item a scenario configures, and the **renderer
draws that item** appearing and sliding out at run time. So you draw **only the
fixture** — the housing, its output port, and its indicator. Do **not** draw an
emitted item: a fixed item painted into the sprite would show the *same* item in
every frame no matter what the source is actually emitting, which is wrong. The
animation you draw is the fixture's own **emit reaction** — the green indicator
and the aperture brightening as it fires — timed as if an item were leaving, but
the item itself is the renderer's job, not yours.

## Orientation — draw East only

Draw **one orientation**: the source **emits toward the right (East)**. Its output
aperture/port sits on the **East (right) edge** of the tile, and the item it emits
moves left→right, out through that aperture. Do not draw the North, South, or West
sources — the renderer rotates this single East-facing sprite for the other three
directions.

## The style — flat, top-down 2D

Lattice is drawn **flat**: you are looking straight down at the fixture, and it is
a clean **2D shape on the grid** — crisp outline, flat areas of color, shading
used to give the housing a little inset depth rather than to fake real height. No
beveled block standing off the floor, no cast shadow.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  source tile. Origin is the top-left of the frame; `x` increases to the right,
  `y` increases downward. Coordinates are **within the frame** (0–31) — there is
  no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **6 frames, numbered 0–5**, and they form a single emit-pulse loop.
- Keep a small **even margin** (about 2–3 px) so the housing sits inside its
  frame, centered, neither tiny in a corner nor clipped — but let the output
  aperture reach toward the East edge so an emitted item has room to slide out.

## The housing (the body, the same in every frame)

The source is a top-down **rectangular housing** — a panel that fills most of the
32×32 tile with a small margin:

- **Body:** a grey-blue housing panel, built from the housing mid tone as the
  main fill with the housing light tone as edge highlights and the housing dark
  tone as inset shading, so it reads as a solid mechanical box with a little depth
  rather than a flat fill. Outline the whole housing with the dark outline/shadow
  tone so it reads as equipment with a defined edge.
- **Output aperture:** on the **East (right) edge** of the housing, draw a clear
  **output port** — a recessed slot/mouth, a few pixels tall, centered vertically
  across the middle of the housing, framed by the dark outline tone. This is where
  the emitted item leaves. It is the one feature that marks which way the source
  faces.
- **Status indicator:** a small **green** light/lamp on the housing face (for
  example a small filled circle a few pixels across, set toward the top-left or
  upper area of the panel), in the green source-accent tones. Green is the
  source's **signature accent** — it marks this fixture as an input/source and
  sets it apart from the red sink. Do **not** use any red anywhere.
- Optional fixture detailing — a couple of mounting bolts (dark dots), a thin trim
  line, or fine grilles in the housing tones — is welcome to sell the "measurement
  rig" reading, as long as it stays inside the palette and reads as equipment.

The housing body, aperture frame, and any mounting detail do **not** move between
frames. What changes across the six frames is the **emit pulse**: the brightness
of the green indicator and the aperture.

## The emit pulse (how the six frames animate)

The six frames are one rhythmic **emit pulse** — the fixture firing a single item
— that loops. There is **no item drawn**: what pulses is the **green indicator**
and the **aperture**, brightening as an item would be emitted and dimming back to
idle.

| Frame | The pulse |
| --- | --- |
| 0 | **Idle.** Aperture dim; green indicator at its dim/dark tone. This is the rest state the loop returns to. |
| 1 | The green indicator **brightens** (toward the green mid tone) and the aperture begins to **light up** with the green accent — the fixture is charging to emit. |
| 2 | The aperture is **bright** (green pale accent in/around the port) — the fixture fires, and the renderer's item begins to leave here. |
| 3 | The aperture stays lit at its brightest as the item slides out (drawn by the renderer); the indicator holds bright. |
| 4 | The aperture begins to **dim** as the emission finishes. |
| 5 | The aperture and indicator **dim back** toward — but not all the way to — idle, easing into frame 0. |

The green indicator and aperture must **visibly brighten then dim** across the six
frames — a clear pulse, not a flat glow. Make the idle frame 0 and the dim-down
frame 5 line up so that playing **0→1→…→5→0 loops seamlessly**, reading as the
fixture emitting one item every cycle, over and over. The item leaving is the
renderer's; your job is the fixture's emit reaction.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Housing light (grey-blue) | `#6a7884` |
| Housing mid (grey-blue) | `#4d5a64` |
| Housing dark (grey-blue) | `#36424b` |
| Source accent — green mid | `#46c46a` |
| Source accent — green dark | `#2f8f4c` |
| Source accent — green pale | `#8ff0a5` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, and flood fill) and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief.
