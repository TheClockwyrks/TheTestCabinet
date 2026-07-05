# Floe Crosser — drawing brief

You are drawing the **crosser**, a **sprite sheet** for an arctic crossing game.
It is the **player**: a small, round, fuzzy tundra critter that hops one tile at
a
time across the ice and the drifting floes, trying to reach the far shore before
the hunter catches it. It has to read as **small, warm, and endearing prey** — the
opposite of the big white predator chasing it — and it must **pop against the pale
ice and dark water**, so it is warm-colored, not white or blue.

You are drawing the crosser hopping in **four directions**, each a two-frame hop.

## Compositing — a creature on transparency

Every frame is drawn on a fully **transparent** background so it composites onto
the ice and water.

- The only opaque pixels are the critter itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The critter is small — it sits within the frame with a few pixels of
  margin, centered, reading as a little animal, not filling the whole tile.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**.

## What goes in each frame

The same round critter facing and hopping in four directions, each a two-frame
hop — a **crouch** (gathered, sitting low) and a **hop** (stretched, mid-leap):

| Frames | Facing | First frame (crouch) | Second frame (hop) |
| --- | --- | --- | --- |
| 0, 1 | **down** (toward viewer) | gathered low, facing down | stretched up into a leap, little feet tucked |
| 2, 3 | **up** (away) | gathered low, seen from behind | stretched into a leap |
| 4, 5 | **left** | gathered low, facing left | stretched into a leap |
| 6, 7 | **right** | gathered low, facing right | stretched into a leap |

Make it read as **one small creature**:

- A **round, fuzzy body** with a big head and **big dark eyes**, a tiny nose, small
  ears, and little paws — clearly a cute, harmless critter, not a predator.
- The **belly/face is the cream tone**; the **back/body is the warm fur**; shade
  the underside with the fur shadow so it has a little form.
- The **down** and **up** facings differ: facing down you see its face and eyes;
  facing up you see its back and ears (little or no face). Left and right are
  profiles; make the **right** a clean mirror of the **left**.
- The two frames of each direction animate as a small hop: the **crouch** is
  compact and low, the **hop** is taller/stretched — a springy little leap, the
  body staying the same size and centered.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Fur — warm (back/body) | `#f2a03a` |
| Belly / face (cream) | `#ffe0a8` |
| Fur — shadow (underside) | `#b7651c` |
| Eyes / nose | `#201510` |
| Paws / feet | `#7a4a1e` |

## Working the tool

Build the down-facing crouch first — a round warm body, a cream face, two big dark
eyes and a nose, little ears and paws — then reuse that body for the other frames:
stretch it for each direction's hop, turn it to show the back for the up facing
and
a profile for left, mirror the left to make the right, and shade the underside with
the fur shadow. Use the filled-circle and rectangle operations for the round body
and head, single pixels for the eyes, nose, ears, and paws, and the horizontal
mirror to turn left into right. Run `draw-sheet --help` for the available
operations and `draw-sheet <operation> --help` for each one's exact flags. Call
`draw-sheet` once per operation and read `frames/<index>.png` between calls. Play
each pair as a little hop in your head — crouch then leap — and keep it the same
small, warm critter in every frame.
