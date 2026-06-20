# Gloamfin — drawing brief

You are drawing the **Gloamfin**, a single enemy sprite for a deep-sea maze-chase
game. It is a **non-playable pursuer**: a predator that hunts the player through
a lightless maze by echolocation. Everything below describes the *enemy* — never
the player character.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x` increases
  to the right, `y` increases downward.
- Draw the creature **facing right** — right is its direction of pursuit.
- Fill most of the frame: the body should span roughly 48–56 px across, centered
  with a few pixels of margin, never clipped at an edge.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Body | `#176b63` |
| Belly (lighter underside) | `#2f9c8f` |
| Outline / mouth (darkest) | `#0e3a3a` |
| Sonar accent (pale) | `#cfeee6` |

## The form

The Gloamfin reads, at a glance, as an **eyeless predator that hunts blind**:

- **Body:** a rounded, tapering fish body filling the middle of the frame.
- **Head:** a smooth, **blunt head on the right** (its leading edge). It has **no
  eyes at all** — do not draw an eye, a socket, or a highlight where an eye would
  be. The eyelessness is the whole point of the creature.
- **Belly:** a lighter underside along the lower body.
- **Tail:** a swept tail fin trailing to the **left**, behind the direction of
  travel.
- **Mouth:** a small, dark slit near the front of the head.
- **Echolocation cue:** a couple of **pale sonar-ripple arcs** reading as pulses
  emanating from the head (toward the right), the signature of a creature that
  "sees" by sound. Stroked circle outlines centered off the right edge read as
  arcs.

## Working the tool

Build the sprite up in sensible layers — lay down the body first, then the head
and belly, then the tail, then the small details (mouth, sonar arcs). Consult
`schemas/operations.json` for the available operations (filling and stroking
circles and rectangles, lines, single pixels, flood fill, and a horizontal
mirror) and their exact parameters. Call `draw` once per operation and read
`canvas.png` between calls to judge your progress against this brief and the
target.
