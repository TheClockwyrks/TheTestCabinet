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

## Orientation — draw East only

Draw **one orientation**: the source **emits toward the right (East)**. Its output
aperture/port sits on the **East (right) edge** of the tile, and the item it emits
moves left→right, out through that aperture. Do not draw the North, South, or West
sources — the renderer rotates this single East-facing sprite for the other three
directions.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  source tile at Factorio normal resolution. Origin is the top-left of the frame;
  `x` increases to the right, `y` increases downward. Coordinates are **within the
  frame** (0–31) — there is no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **6 frames, numbered 0–5**, and they form a single emit-pulse loop.
- Keep a small **even margin** (about 2–3 px) so the housing sits inside its frame,
  centered, neither tiny in a corner nor clipped — but let the output aperture
  reach toward the East edge so the emitted plate has room to slide out.

## The housing (the body, the same in every frame)

The source is a top-down **rectangular housing** — a panel that fills most of the
32×32 tile with a small margin:

- **Body:** a grey-blue housing panel, built from the housing mid tone as the
  main fill with the housing light tone as a top/left highlight and the housing
  dark tone as a bottom/right shading, so it reads as a solid mechanical box with
  a little depth rather than a flat fill. Outline the whole housing with the dark
  outline/shadow tone so it reads as equipment with a defined edge.
- **Output aperture:** on the **East (right) edge** of the housing, draw a clear
  **output port** — a recessed slot/mouth, a few pixels tall, centered vertically
  (around `y = 16`), framed by the dark outline tone. This is where the emitted
  item leaves. It is the one feature that marks which way the source faces.
- **Status indicator:** a small **green** light/lamp on the housing face (for
  example a small filled circle a few pixels across, set toward the top-left or
  upper area of the panel), in the green source-accent tones. Green is the source's
  **signature accent** — it marks this fixture as an input/source and sets it apart
  from the red sink. Do **not** use any red anywhere.
- Optional fixture detailing — a couple of mounting bolts (dark dots), a thin trim
  line, or fine grilles in the housing tones — is welcome to sell the "measurement
  rig" reading, as long as it stays inside the palette and reads as equipment.

The housing body, aperture frame, and any mounting detail do **not** move between
frames. What changes across the six frames is the **emit pulse**: the brightness
of the green indicator and aperture, and the emitted plate.

## The emit pulse (how the six frames animate)

The six frames are one rhythmic **emit pulse** — the fixture emitting a single item
— that loops. Across frames 0→5 the green indicator and the aperture brighten, a
single steel plate appears at the aperture and **slides East out toward the edge**,
then the indicator and aperture dim back to idle:

| Frame | The pulse |
| --- | --- |
| 0 | **Idle.** Aperture closed/dim; green indicator at its dim/dark tone; no plate visible. This is the rest state the loop returns to. |
| 1 | The green indicator **brightens** (toward the green mid tone) and the aperture begins to **light up** with the green accent — the fixture is charging to emit. |
| 2 | The aperture is **bright** (green pale accent in/around the port) and a **single small steel-grey plate appears at the aperture**, just emerging on the East edge. |
| 3 | The plate has **slid East**, now sitting partway out past the aperture; indicator and aperture still lit. |
| 4 | The plate has **slid further East**, near/at the East edge, about to leave the tile; the aperture begins to **dim**. |
| 5 | The plate has **left** (gone, having exited East); the aperture and indicator **dim back** toward — but not all the way to — idle, easing into frame 0. |

The plate must **visibly move East** from frame 2 to frame 4 — a clear left→right
slide of a few pixels each frame, not a flicker in place. Make the idle frame 0
and the dim-down frame 5 line up so that playing **0→1→…→5→0 loops seamlessly**,
reading
as the fixture emitting one item every cycle, over and over.

The **emitted plate** is a small **steel-grey rectangle** (roughly 4–6 px), drawn
in the steel-plate base tone with the steel-plate highlight tone along its top/left
edge so it reads as a single metal plate. Keep it centered on the aperture's row
(around `y = 16`) as it slides.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Housing light (grey-blue) | `#6a7884` |
| Housing mid (grey-blue) | `#4d5a64` |
| Housing dark (grey-blue) | `#36424b` |
| Source accent — green mid | `#46c46a` |
| Source accent — green dark | `#2f8f4c` |
| Source accent — green pale | `#8ff0a5` |
| Emitted item — steel plate | `#b9c0cb` |
| Emitted item — steel highlight | `#e3e8ef` |

## Working the tool

Build each frame up in sensible layers — outline and fill the housing, add the
light/dark shading, frame the East output aperture, and place the green status
indicator — then, per frame, set the green indicator/aperture brightness and draw
the steel plate at its position for that frame — drawing into the frame you select
with `--frame <index>`, using plain in-frame coordinates (0–31). Run `draw-sheet
--help` for the available operations (filling and stroking circles and rectangles,
lines, single pixels, and flood fill) and `draw-sheet <operation> --help` for each
one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief. A good
order is to draw the static housing once (the same in all six frames), then go frame
by frame setting the aperture/indicator brightness and the plate's East position,
checking that frame 5 eases cleanly back into frame 0.
