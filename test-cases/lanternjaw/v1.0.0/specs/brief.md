# Lanternjaw — drawing brief

You are drawing the **Lanternjaw**, a **sprite sheet** for a deep-sea
maze-chase game. In that game the Lanternjaw is **the Lure**: a **non-playable
pursuer**, an anglerfish-style ambush predator that hunts the player by
**light** — it carries a **dangling lure-light** that beckons in the dark and
gives it away. Everything below describes the *enemy* — never the player
character.

## The canvas and the frame grid

- The canvas is **128×128 pixels**, transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward.
- It is a **sprite sheet**: a **4×4 grid of 32×32 frame cells**. Frame cell
  `(col, row)` (each `0–3`) occupies `x` in `[32·col, 32·col+32)` and `y` in
  `[32·row, 32·row+32)`. Draw each frame **inside its own cell** — keep a
  pixel or two of margin so a creature never spills across a grid line into
  its neighbor.
- Frames are numbered **row-major** from the top-left: frame `0` is `(0,0)`,
  frame `3` is `(3,0)`, frame `4` is `(0,1)`, … frame `15` is `(3,3)`.

## What goes in each frame

The sheet holds **four-direction movement** (two frames per direction, a small
swim cycle) and a **lure-bob** animation:

| Frames | Cells | Contents |
| --- | --- | --- |
| 0, 1 | row 0, cols 0–1 | **swim down** — two frames (the tail flicks between them) |
| 2, 3 | row 0, cols 2–3 | **swim up** — two frames |
| 4, 5 | row 1, cols 0–1 | **swim left** — two frames |
| 6, 7 | row 1, cols 2–3 | **swim right** — two frames |
| 8–13 | row 2, all; row 3, cols 0–1 | **lure bob** — six frames of the lure bobbing and its glow pulsing |
| 14, 15 | row 3, cols 2–3 | a resting body (idle) so no cell is empty |

In each **movement** frame the creature faces its direction of travel: the
bulky **head leads** (points the way it swims), the **lure dangles ahead** of
the head in that same direction, and a **forked tail trails** behind. Across
the two frames of a direction, flick the tail so the pair reads as a swim
cycle. The left frames are the mirror of the right; up is the mirror of down.

In the **lure-bob** frames the creature sits roughly still while the dangling
**lure bobs** (its bulb shifts a couple of pixels) and its **amber glow
pulses** (the bulb grows brighter and larger, then eases back) — so playing
frames 8→13 reads as the lure beckoning. This is the Lure's signature tell.

## The form

The Lanternjaw reads, at a glance, as a **lurking predator with a glowing
lure**:

- **Body:** a bulky, rounded **teardrop** in a dark body color — a heavy head
  with the body narrowing to a forked tail. The dark body is the point: it
  lurks unseen and only the lure gives it away.
- **Head:** heavy, leading the direction of travel, with a small open **maw**
  at the front lined with a couple of pale glints (teeth) — this is a
  predator, not a grazer.
- **Belly:** a lighter patch on the underside.
- **Tail:** a swept, forked tail fin trailing behind the head.
- **Lure:** a thin **stalk** rising from the head and ending in a **glowing
  bioluminescent bulb** — a warm amber glow with a bright core, leading just
  ahead of the head. The lure is the **brightest element** of the whole
  sprite; it is the bait.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Body (dark slate) | `#243042` |
| Belly / lighter underside | `#3a4a60` |
| Outline / maw (darkest) | `#0e1622` |
| Lure glow (amber) | `#ffd166` |
| Lure core (bright) | `#fff3c4` |

## Working the tool

Build each frame up in sensible layers — a dark rim, then the body teardrop,
then the belly, tail, maw, and finally the lure — and place every operation
inside the correct cell by offsetting its coordinates by `(32·col, 32·row)`.
Consult `schemas/operations.json` for the available operations (filling and
stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and their exact parameters. Call `draw` once per operation
and read `canvas.png` between calls to judge your progress against this brief
and the target. A good order is to finish one direction's two frames, check
them, then do the others, and finish with the lure-bob row.
