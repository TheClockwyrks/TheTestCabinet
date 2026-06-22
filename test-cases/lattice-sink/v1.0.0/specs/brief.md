# Lattice Sink — drawing brief

You are drawing the **Lattice sink**, a **sprite sheet** for a top-down factory
simulation. It is the renderer sprite for a **sink fixture**: a piece of
**measurement equipment** — not a belt and not a crafting machine — that consumes
and counts every item that reaches it. Items vanish into it; it is a perfect
drain, and the place a factory's throughput is read. Everything below describes
that sink tile.

## Orientation — draw the West-receiving sink only

Draw **one orientation**: the sink **receives from the West (left)**. Its intake
aperture/port is on the **West edge** of the tile, items arrive **from the West**
and move rightward (inward) as they are drained. Do not draw the North-, South-,
or East-receiving sinks — the renderer rotates this single West-facing sprite for
the other three directions.

This sink is the **mirror role** of the Lattice source emitter: the source pushes
an item **outward to the East**; the sink pulls an item **inward from the West**.
Draw it so it reads as the *output/drain*, distinct from an emitter.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background — one
  fixture tile at Factorio normal resolution. Origin is the top-left of the frame;
  `x` increases to the right, `y` increases downward. Coordinates are **within the
  frame** (0–31) — there is no shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **6 frames, numbered 0–5**, and they form a single consume-pulse loop.
- Keep a small even margin (a pixel or two) so the housing sits inside its frame,
  filling most of the 32×32 but neither tiny in a corner nor clipped at the edges.

## The housing (the same in every frame)

The sink reads, at a glance, as a sealed top-down **test-rig drain** — a panel /
housing, clearly mechanical measurement equipment rather than a conveyor surface:

- **Body:** a roughly square grey-blue housing/panel that fills most of the tile,
  built from the housing mid tone as the main surface with the housing dark tone
  for inset/recess shading and the housing light tone for the top/left bevel, so
  it reads as a solid block with depth, all bounded by the dark outline tone.
- **Intake aperture:** on the **West (left) edge**, a recessed **mouth/port**
  where items are swallowed — a dark slot cut into the West face (use the dark
  outline / housing dark tones), wide enough for the item to enter, centred
  vertically on the tile. This aperture is the focus of the animation.
- **Red drain indicator:** somewhere on the housing face (e.g. a small panel light
  near the top-right, away from the aperture), a **red status indicator** in the
  red accent tones. Red marks this fixture as the **output/drain** — it is the
  sink's signature accent. Keep red off the body except for this indicator and
  the intake flash described below; do **not** use green anywhere (green belongs
  to the source emitter, and this fixture must not be confused with it).

The housing, the indicator's location, and the aperture's location stay the **same
in every frame**; only the item, the inward swallow, and the red intake flash
change from frame to frame.

## The consume pulse (how the 6 frames animate)

The six frames are one rhythmic **consume pulse** — the sink swallowing a single
item — that loops. The item is a **small steel-grey plate** drawn in the item
tones (a little rectangular plate, a few pixels across, with the highlight tone
on its top/left edge).

| Frame | What it shows |
| --- | --- |
| 0 | **Idle.** No item yet. Aperture dark and at rest; the red indicator at its dim/idle state. |
| 1 | **Item arrives.** The steel-grey plate appears just **outside the West aperture** (at the tile's left edge), about to enter. |
| 2 | **Drawn in.** The plate has moved **right, into the aperture mouth**, half-swallowed; the intake begins to flash — a touch of the red accent at the aperture rim. |
| 3 | **Swallowed (peak).** The plate is **inside / disappearing into** the aperture (only a sliver, or gone), and the intake **flashes red** at its brightest — the red accent glows at the aperture and the indicator brightens. This is the peak of the pulse. |
| 4 | **Dimming.** The item is **gone** (consumed); the red intake flash is **fading** back down. |
| 5 | **Returning to idle.** Aperture and indicator settle back toward the idle look of frame 0, so that **frame 5 loops seamlessly into frame 0** with no jump or backward slip. |

Played 0→1→2→3→4→5→0, this must read as the sink **swallowing one item from the
West** — item in, red flash, item gone, reset — repeating cleanly. The motion is
the item moving **inward (rightward) and vanishing**, plus the red intake flash
rising on frames 2–3 and falling on frames 4–5.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Housing light (grey-blue) | `#6a7884` |
| Housing mid | `#4d5a64` |
| Housing dark | `#36424b` |
| Drain accent — red mid | `#d6473a` |
| Drain accent — red dark | `#99281f` |
| Drain accent — red pale | `#f59a90` |
| Consumed item — steel plate | `#b9c0cb` |
| Consumed item — highlight | `#e3e8ef` |

## Working the tool

Build each frame up in sensible layers — fill the grey-blue housing body, add the
dark recess shading and the light bevel, outline it, cut the West intake aperture,
then place the red indicator and (per frame) the steel-grey item and the red
intake flash — drawing into the frame you select with `--frame <index>`, using
plain in-frame coordinates (0–31). Run `draw-sheet --help` for the available
operations (filling and stroking circles and rectangles, lines, single pixels, and
flood fill) and `draw-sheet <operation> --help` for each one's exact flags. Call
`draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief. A good order is to finish the shared housing
look once (so every frame matches), then walk frames 0→5 placing the item a little
further inward and the red flash a little brighter through frame 3 and back down,
checking that frame 5 settles back to frame 0.
