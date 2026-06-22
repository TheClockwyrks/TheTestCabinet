# Lattice Inserter — drawing brief

You are drawing the **Lattice inserter**, a **sprite sheet** for **Lattice**, a
deterministic factory simulation rendered in **Factorio's high-angle, pseudo-3D
style** — the world is seen from above but at a steep angle. The inserter is the
machine that moves one item at a time between two adjacent tiles: it **picks an
item up from the tile behind it**, **swings** for a fixed time holding the item,
then **drops** it on the tile in front. It is a swing, not an instant teleport —
the whole point of this sprite is to read as an arm sweeping an item across.

You draw **one canonical orientation**: the inserter is mounted on the **centre
tile**, it **picks up from the LEFT** (the tile behind it) and **drops to the
RIGHT** (the tile in front). The renderer rotates this sprite for the other
facings, so draw only this left-pickup / right-drop orientation.

## The look — pseudo-3D from above, NOT a side view

This sprite shares the factory floor with the pseudo-3D assembler and the belts,
and it must look like it belongs to the **same world** — so get the viewpoint
right before anything else:

- **Viewed from above at a steep angle, not from the side.** You are looking
  *down* on the inserter. The pivot base sits on the **floor at the centre of the
  frame**; the two tiles it works are the **left half** (pickup) and the **right
  half** (drop), lying flat on the ground beside it. The arm sweeps **across the
  ground plane** between them. Do **not** draw a side elevation — the base does
  **not** sit on a ground line at the bottom of the frame, and the arm does **not**
  rise vertically "up the screen" like a pendulum. Screen-down is *south on the
  floor*, not *toward the viewer's feet*.
- **Height comes from shading, not from screen height.** The arm is raised above
  the floor as it swings, but you show that the way the assembler shows its height:
  with **shading on the arm** (highlight/shadow tones) and a small **contact
  shadow on the floor** beneath the hand that tracks along under it — not by
  drawing the arm climbing toward the top of the frame. A short vertical lift of a
  pixel or two between the hand and its shadow is enough to read as "held above the
  belt."
- **Consistent with the assembler.** Same overhead light, same grey-blue body
  family with bevel/shadow, same chunky industrial read. A viewer should not be
  able to tell the inserter and the assembler were drawn from different cameras.

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
as a loop. Over the twelve frames the arm sweeps from the left pickup, in an arc
across the floor through the far side of the centre tile, to the right drop, then
back:

| Frames | Contents |
| --- | --- |
| 0 | claw over the **LEFT** pickup tile (on the floor), **holding the item** |
| 1–4 | arm sweeping rightward, the hand bowing through the **far (top) side** of the centre tile and raised above the floor, **holding the item** |
| 5 | claw over the **RIGHT** drop tile, **holding the item** (about to release) |
| 6 | claw over the **RIGHT** drop tile, **empty** (item released) |
| 7–10 | arm sweeping back leftward through the same arc, **empty claw** |
| 11 | claw over the **LEFT** pickup tile, **empty** — back at the start so frame 11 loops to frame 0 |

So **frames 0–5 are the loaded delivery stroke** (item visible in the claw, left
→ right) and **frames 6–11 are the empty return stroke** (no item, right → left).
The held-item presence is the single most important readable difference between
the two halves.

Make the motion a **smooth arc across the floor**, seen from above: the hand is
over the left tile at the start, **bows outward through the far (top) edge** of the
centre tile at mid-swing, and reaches the right tile at the end — a curve traced
over the ground, **not** a straight horizontal slide and **not** a vertical
pendulum lift toward the top of the frame. The mid-swing "raised" read comes from
the arm's shading and the contact shadow tracking beneath the hand, not from the
hand climbing in screen space. Advance the arm by roughly the **same angular step
each frame** so the playback is even and the loop from frame 11 back to frame 0 is
seamless, with no jump or backward slip.

## The form

The inserter reads, at a glance, as a **swing-arm machine** with four parts:

- **Base / mount:** a small, **fixed** grey-blue pivot block sitting on the floor
  at the **centre of the frame** (around `x = 24–40`, `y = 24–40`). Give it a touch
  of height the way the assembler does — a lighter top, slightly darker beveled
  sides, a dark outline, and a small contact shadow on the floor — so it reads as a
  squat mount, not a flat dot. It is the pivot the arm rotates from and is
  **identical in every frame**; it never moves, only the arm does.
- **Arm:** a slender **amber** arm reaching from the centre pivot out to the claw.
  It is the part that swings — draw it at the angle for each frame so its tip (the
  claw) is over the tile the table above calls for. Keep it readable as one
  straight or slightly tapered limb, not a blob, with a highlight along its lit
  edge and the shadow tone along the other so it reads as raised above the floor.
- **Hand / claw:** an **amber** gripper at the arm's tip — a small two-pronged
  pincer. It is **open and empty** on the return stroke and **closed around the
  held item** on the delivery stroke.
- **Contact shadow:** a small **shadow on the floor** (the solid dark
  outline/shadow tone — no anti-aliased softening) beneath the hand, offset a pixel
  or two from the hand itself and tracking
  along under it through the swing. This is what sells the arm being held *above*
  the belt — the height cue that replaces a side-view lift.
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

Build each frame up in sensible layers — the floor contact shadows, the dark
outline, then the grey-blue base block, then the amber arm at its angle, then the
claw, then (on frames 0–5) the steel plate in the claw — drawing into the frame
you select with `--frame <index>`,
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
