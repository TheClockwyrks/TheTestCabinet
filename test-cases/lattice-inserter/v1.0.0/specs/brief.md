# Lattice Inserter — drawing brief

You are drawing the **Lattice inserter**, a **sprite sheet** for **Lattice**, a
top-down deterministic factory simulation. The inserter is the machine that moves
one item at a time between two adjacent tiles: it **picks an item up from the tile
behind it**, **swings** for a fixed time holding the item, then **drops** it on
the tile in front. It is a swing, not an instant teleport — the whole point of
this sprite is to read as an arm sweeping an item across.

You draw **one canonical orientation**: the inserter is mounted on the **centre
tile**, it **picks up from the LEFT** (the tile behind it) and **drops to the
RIGHT** (the tile in front). The renderer rotates this sprite for the other
facings, so draw only this left-pickup / right-drop orientation.

## The frames

- Each frame is its own **64×64-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–63) — there is no shared sheet
  to offset into.
- The 64×64 box is a **2×2-tile span** (32 px per tile): the inserter's base sits
  on the **centre** of the box, and the arm reaches **left** toward the pickup
  tile and **right** toward the drop tile. The 64 px width exists so that reach
  fits — keep the whole arc inside the frame with a pixel or two of margin.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **12 frames, numbered 0–11**.

## What goes in each frame

The sheet is **one swing cycle** — a single named sequence the reviewer plays back
as a loop. Over the twelve frames the arm sweeps from the left pickup, up and over
the top, to the right drop, then back:

| Frames | Contents |
| --- | --- |
| 0 | claw low on the **LEFT**, over the pickup tile, **holding the item** |
| 1–4 | arm sweeping rightward through the arc, **holding the item**, hand high over the top |
| 5 | claw low on the **RIGHT**, over the drop tile, **holding the item** (about to release) |
| 6 | claw low on the **RIGHT**, **empty** (item released) |
| 7–10 | arm sweeping back leftward through the arc, **empty claw** |
| 11 | claw low on the **LEFT**, over the pickup tile, **empty** — back at the start so frame 11 loops to frame 0 |

So **frames 0–5 are the loaded delivery stroke** (item visible in the claw, left
→ right) and **frames 6–11 are the empty return stroke** (no item, right → left).
The held-item presence is the single most important readable difference between
the two halves.

Make the motion a **smooth arc**: the claw is low on the sides and high in the
middle, tracing a curve over the top — not a straight horizontal slide. Advance
the arm by roughly the **same angular step each frame** so the playback is even
and the loop from frame 11 back to frame 0 is seamless, with no jump or backward
slip.

## The form

The inserter reads, at a glance, as a **swing-arm machine** with three parts:

- **Base / mount:** a small, **fixed** grey-blue block anchored near the
  **bottom-centre** of the frame (around `x = 24–40`, sitting on the lower tile
  edge). It is the pivot the arm rotates from. The base is **identical in every
  frame** — it never moves, only the arm does.
- **Arm:** a slender **amber** arm rising from the base pivot to the claw. It is
  the part that swings — draw it at the angle for each frame so its tip (the claw)
  is at the position the table above calls for. Keep it readable as one straight
  or slightly tapered limb, not a blob.
- **Hand / claw:** an **amber** gripper at the arm's tip — a small two-pronged
  pincer. It is **open and empty** on the return stroke and **closed around the
  held item** on the delivery stroke.
- **Held item:** a small **steel-grey plate** (a short, flat rectangle) gripped
  in the claw on frames **0–5** only. It is **absent** on frames 6–11. When
  present it sits clearly inside the claw, carried along the arc.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Base / mount — light | `#6a7884` |
| Base / mount — mid | `#4d5a64` |
| Base / mount — dark | `#36424b` |
| Arm + hand — amber | `#e6b329` |
| Arm + hand — highlight | `#f6d96b` |
| Arm + hand — shadow | `#b88410` |
| Held item — steel plate | `#b9c0cb` |
| Held item — highlight | `#e3e8ef` |
| Held item — shadow | `#6f7884` |

The **arm and claw are amber**; the **base is grey-blue**; the **held plate is
steel-grey**. Keep the three color families distinct — do not let the amber bleed
into the base or the plate.

## Working the tool

Build each frame up in sensible layers — the dark outline, then the grey-blue base
block, then the amber arm at its angle, then the claw, then (on frames 0–5) the
steel plate in the claw — drawing into the frame you select with `--frame <index>`,
using plain in-frame coordinates (0–63). Run `draw-sheet --help` for the available
operations (filling and stroking circles and rectangles, lines, single pixels,
flood fill, and a horizontal mirror) and `draw-sheet <operation> --help` for each
one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief.

A good order is to draw the fixed base once and reproduce it identically in every
frame, then lay out the arm angle and claw position for the six delivery frames
(0–5) with the held plate, check that the arc and the held item read, then do the
six empty return frames (6–11) — confirming the claw is empty and that frame 11
lands back on frame 0's pickup pose so the loop is seamless.
