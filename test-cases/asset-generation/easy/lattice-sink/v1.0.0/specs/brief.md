# Lattice Sink — drawing brief

You are drawing the **Lattice sink**, a **sprite sheet** for a top-down factory
simulation. It is the renderer sprite for a **sink fixture**: a piece of
**measurement equipment** — not a belt and not a crafting machine — that consumes
and counts every item that reaches it. Items vanish into it; it is a perfect
drain, and the place a factory's throughput is read. Everything below describes
that sink tile.

## Draw the machine only — never an item

The sink swallows **whatever** the factory sends it, and the **renderer draws
that item** arriving and being consumed at run time. So you draw **only the
fixture** — the housing, its intake, and its indicators. Do **not** draw an item
being swallowed: a fixed item painted into the sprite would show the *same* item
in every frame no matter what the sink is actually consuming, which is wrong. The
animation you draw is the fixture's own **reaction** to consuming — a red intake
flash and a pulsing indicator — timed as if an item were entering, but the item
itself is the renderer's job, not yours.

## Orientation — draw the West-receiving sink only

Draw **one orientation**: the sink **receives from the West (left)**. Its intake
aperture/port is on the **West edge** of the tile, and items arrive **from the
West** and move rightward (inward) as they are drained. Do not draw the North-,
South-, or East-receiving sinks — the renderer rotates this single West-facing
sprite for the other three directions.

This sink is the **mirror role** of the Lattice source emitter: the source pushes
an item **outward to the East**; the sink pulls an item **inward from the West**.
Draw it so it reads as the *output/drain*, distinct from an emitter.

## The style — flat, top-down 2D

Lattice is drawn **flat**: you are looking straight down at the fixture, and it is
a clean **2D shape on the grid** — crisp outline, flat areas of color, shading
used to give the housing a little inset depth rather than to fake real height. No
beveled block standing off the floor, no cast shadow.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  fixture tile. Origin is the top-left of the frame; `x` increases to the right,
  `y` increases downward. Coordinates are **within the frame** (0–31) — there is
  no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **6 frames, numbered 0–5**, and they form a single consume-pulse loop.
- Keep a small even margin (a pixel or two) so the housing sits inside its frame,
  filling most of the 32×32 but neither tiny in a corner nor clipped at the edges.

## The housing (the same in every frame)

The sink reads, at a glance, as a sealed top-down **test-rig drain** — a panel /
housing, clearly mechanical measurement equipment rather than a conveyor surface:

- **Body:** a roughly square grey-blue housing/panel that fills most of the tile,
  built from the housing mid tone as the main surface with the housing dark tone
  for inset/recess shading and the housing light tone for edge highlights, so it
  reads as a solid panel with a little depth, all bounded by the dark outline
  tone.
- **Intake aperture:** on the **West (left) edge**, a recessed **mouth/port**
  where items are swallowed — a dark slot cut into the West face (use the dark
  outline / housing dark tones), wide enough for an item to enter, centred
  vertically on the tile. This aperture is the focus of the animation.
- **Red drain indicator:** somewhere on the housing face (e.g. a small panel light
  near the top-right, away from the aperture), a **red status indicator** in the
  red accent tones. Red marks this fixture as the **output/drain** — it is the
  sink's signature accent. Keep red off the body except for this indicator and
  the intake flash described below; do **not** use green anywhere (green belongs
  to the source emitter, and this fixture must not be confused with it).

The housing, the indicator's location, and the aperture's location stay the **same
in every frame**; only the red intake flash and the indicator's brightness change
from frame to frame.

## The consume pulse (how the 6 frames animate)

The six frames are one rhythmic **consume pulse** — the fixture reacting as it
swallows an item — that loops. There is **no item drawn**: what pulses is the
**red intake flash** at the aperture and the **red indicator**, rising as an item
would be drawn in and falling back to idle.

| Frame | What it shows |
| --- | --- |
| 0 | **Idle.** Aperture dark and at rest; the red indicator at its dim/idle state. |
| 1 | **Charging.** The indicator begins to brighten; the aperture stays dark — an item is arriving (drawn by the renderer). |
| 2 | **Intake begins.** A touch of the red accent appears at the aperture rim as the intake starts to flash; the indicator brightens further. |
| 3 | **Peak.** The intake **flashes red at its brightest** — the red accent glows across the aperture and the indicator is at full brightness. This is the peak of the pulse, where an item is being consumed. |
| 4 | **Dimming.** The red intake flash **fades** back down and the indicator begins to settle. |
| 5 | **Returning to idle.** Aperture and indicator settle back toward the idle look of frame 0, so **frame 5 loops seamlessly into frame 0** with no jump or backward slip. |

Played 0→1→2→3→4→5→0, this must read as the sink **consuming one item** — the red
intake flash rising on frames 2–3 and falling on frames 4–5, the indicator
pulsing with it — repeating cleanly. The item entering is the renderer's; your
job is the fixture's reaction to it.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Housing light (grey-blue) | `#6a7884` |
| Housing mid | `#4d5a64` |
| Housing dark | `#36424b` |
| Drain accent — red mid | `#d6473a` |
| Drain accent — red dark | `#99281f` |
| Drain accent — red pale | `#f59a90` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, and flood fill) and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief.
