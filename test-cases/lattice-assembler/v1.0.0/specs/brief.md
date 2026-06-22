# Lattice Assembler — drawing brief

You are drawing the **Lattice Assembler**, a **sprite sheet** for Lattice, a
deterministic top-down factory simulation. The assembler is the **3×3 crafting
machine**: it covers a 3×3 block of tiles, takes in input items, counts up
crafting ticks, and deposits a finished output. Everything below describes the
*machine* and its working animation — not the items it crafts and not the belts
or inserters around it.

## The frames

- Each frame is its own **96×96-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–95) — there is no shared
  sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**.
- The machine is **3×3 tiles at 32 px per tile**, so it fills the whole 96×96
  frame. Leave only a **1–2 px margin** at the edges — the assembler should read
  as a big, chunky block, centered, neither tiny nor clipped.

## What goes in each frame

All eight frames are the **same crafting machine**, drawn as a single seamless
**working loop**. Frames 0–7 are one continuous animation that loops back from
frame 7 to frame 0 with no visible jump.

| Frames | Contents |
| --- | --- |
| 0–7 | the crafting machine, with its **central core animating** through one full cycle |

- The **chassis is static** — the outer machine body is drawn the **same in
  every frame**. Only the central working core (and its glow) changes from frame
  to frame.
- The **central core animates** so that playing 0→7 reads as a machine actively
  crafting. Animate it two ways together:
  - **Rotation:** a gear or assembly element in the core turns a little each
    frame, completing roughly one full turn (or a clean repeating fraction of
    one) across frames 0–7 so it lines back up at the wrap.
  - **Pulsing glow:** a teal "active" glow in the core **brightens and dims** —
    dimmest around frame 0, brightest near the middle of the cycle (around frames
    3–4), back to dimmest by frame 7 so it returns smoothly to frame 0.
- The loop must be **seamless**: frame 7 ends where frame 0 begins.

## The form

The Lattice Assembler reads, at a glance, as a **chunky top-down industrial
crafting machine**:

- **Chassis:** a solid, near-square block of grey-blue plated metal filling the
  frame. Give it a heavy dark **outline** all the way around and the read of
  thick **bolted plating** — e.g. panel seams, a few **bolt studs** near the
  corners, and lighter/darker shading so the metal looks raised, not flat.
- **Non-directional:** this is a square machine with **no front or back** — it
  must read correctly at any rotation. Do **not** give it a facing, a nose, or
  any one-sided feature. Keep the chassis roughly symmetric.
- **Central working window/core:** a round (or rounded-square) **opening in the
  middle** of the chassis showing the craft in progress — a recessed dark well
  holding the rotating gear/assembly element and the teal active glow. This core
  is where all the animation happens.
- **Hazard accents:** **yellow-and-black hazard stripes** at the corners or along
  the base of the chassis (amber stripes paired with the dark outline), marking
  it as industrial machinery. Keep them as small accents, not the whole body.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Chassis grey-blue — light | `#6a7884` |
| Chassis grey-blue — mid | `#4d5a64` |
| Chassis grey-blue — dark | `#36424b` |
| Active glow / working core — teal | `#38c6d6` |
| Active glow / working core — pale teal | `#9af0f7` |
| Hazard accent — amber | `#e6b329` |

The two teals are the **working state** — use them only for the central core's
glow, nowhere else. The amber is only for the hazard stripes (paired with the
`#1b1d21` outline).

## Working the tool

Build each frame up in sensible layers — the dark outer outline, then the
grey-blue chassis fill, then the plating shading, bolts, and hazard stripes, and
finally the central core with its gear and glow. The chassis is identical across
all eight frames, so a good order is to draw the **static chassis once and the
same way in every frame**, then vary only the core's gear angle and glow
brightness per frame. Draw into the frame you select with `--frame <index>`,
using plain in-frame coordinates (0–95). Run `draw-sheet --help` for the
available operations (filling and stroking circles and rectangles, lines, single
pixels, flood fill, and a horizontal mirror) and `draw-sheet <operation> --help`
for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief. Check
the eight frames in sequence so the rotation and the pulsing glow read as a smooth
loop, including the wrap from frame 7 back to frame 0.
