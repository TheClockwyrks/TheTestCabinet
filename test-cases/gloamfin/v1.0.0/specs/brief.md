# Gloamfin — drawing brief

You are drawing the **Gloamfin**, a **sprite sheet** for a deep-sea maze-chase
game. In that game the Gloamfin is **the Listener**: a **non-playable
pursuer**, an eyeless predator that hunts the player by **sound** — it homes
in on sonar and emits its own sonar pulses. Everything below describes the
*enemy* — never the player character.

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
swim cycle) and a **sonar-pulse** animation:

| Frames | Cells | Contents |
| --- | --- | --- |
| 0, 1 | row 0, cols 0–1 | **swim down** — two frames (the tail flicks between them) |
| 2, 3 | row 0, cols 2–3 | **swim up** — two frames |
| 4, 5 | row 1, cols 0–1 | **swim left** — two frames |
| 6, 7 | row 1, cols 2–3 | **swim right** — two frames |
| 8–13 | row 2, all; row 3, cols 0–1 | **sonar pulse** — six frames of an expanding ring |
| 14, 15 | row 3, cols 2–3 | a resting body (idle) so no cell is empty |

In each **movement** frame the creature faces its direction of travel: the
**blunt head leads** (points the way it swims) and a **forked tail trails**
behind. Across the two frames of a direction, flick the tail (a small 1–2 px
change) so the pair reads as a swim cycle. The left frames are the mirror of
the right; up is the mirror of down.

In the **sonar-pulse** frames the creature sits roughly still while a pale
**sonar ring expands** outward from its body — small in the first frame,
larger in each following frame, then fading — so playing frames 8→13 reads as
a pulse going out. This is the Listener's signature tell.

## The form

The Gloamfin reads, at a glance, as an **eyeless predator that hunts blind**:

- **Body:** a rounded, tapering **teardrop** — a heavy blunt head with the
  body narrowing to a forked tail.
- **Head:** smooth and blunt, leading the direction of travel. It has **no
  eyes at all** — do not draw an eye, a socket, or a highlight where an eye
  would be. The eyelessness is the whole point of the creature.
- **Belly:** a lighter patch under the head.
- **Tail:** a swept, forked tail fin trailing behind the head.
- **Mouth:** a small, dark slit near the front of the head.
- **Sonar:** the pale accent color, used for a faint cue at the head in the
  movement frames and for the expanding rings in the sonar-pulse frames.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Body | `#c46bff` |
| Belly / lighter underside | `#e0b3ff` |
| Outline / mouth (darkest) | `#3a1a55` |
| Sonar accent (pale) | `#5ef2ff` |

## Working the tool

Build each frame up in sensible layers — a dark rim, then the body teardrop,
then the belly, tail, and details — and place every operation inside the
correct cell by offsetting its coordinates by `(32·col, 32·row)`. Consult
`schemas/operations.json` for the available operations (filling and stroking
circles and rectangles, lines, single pixels, flood fill, and a horizontal
mirror) and their exact parameters. Call `draw` once per operation and read
`canvas.png` between calls to judge your progress against this brief and the
target. A good order is to finish one direction's two frames, check them, then
do the others, and finish with the sonar-pulse row.
