# Lanternjaw — drawing brief

You are drawing the **Lanternjaw**, a single enemy sprite for a deep-sea
maze-chase game. It is a **non-playable pursuer**: an anglerfish-style ambush
predator that lures the player with the glowing light on its head and then hunts
them down. Everything below describes the *enemy* — never the player character.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x` increases
  to the right, `y` increases downward.
- Draw the creature **facing right** — right is its direction of pursuit.
- Fill most of the frame: the body should span roughly 48–56 px across, centered
  with a few pixels of margin. The lure may rise toward the top edge, but the body
  must not be clipped.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Body (near-black) | `#0e3a3a` |
| Maw interior (dark) | `#3a0a0a` |
| Teeth / eye glint (pale) | `#cfeee6` |
| Lure glow (warm) | `#ffe08a` |
| Lure core (bright) | `#fff3c4` |

## The form

The Lanternjaw reads, at a glance, as a **lurking predator with a glowing lure**:

- **Body:** a bulky, rounded fish body filling the middle of the frame, in the
  near-black body color.
- **Head:** a large, heavy head on the **right** (its leading edge).
- **Maw:** a wide, open **mouth at the front of the head**, filled with the dark
  maw color and lined with a row of **pale teeth** along the top and bottom — this
  is a predator, not a grazer.
- **Eye:** a single small eye high on the head (a pale glint with a dark pupil).
  A glowing lure with no watching eye reads wrong.
- **Lure:** a thin **stalk rising from the top of the head** ending in a **glowing
  bioluminescent lure** — a warm glow with a bright core. The lure is the
  **brightest element** of the whole sprite; it is the bait.
- **Tail:** a small swept tail fin trailing to the **left**, behind the direction
  of travel.

## Working the tool

Build the sprite up in sensible layers — lay down the body and head first, then
the maw and teeth, then the lure stalk and its glow, then the eye and tail.
Consult `schemas/operations.json` for the available operations (filling and
stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and their exact parameters. Call `draw` once per operation and
read `canvas.png` between calls to judge your progress against this brief and the
target.
