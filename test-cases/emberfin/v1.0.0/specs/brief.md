# Emberfin — drawing brief

You are drawing the **Emberfin**, a **sprite sheet** for a deep-sea maze-chase
game. In that game the Emberfin is **the Flarefish**: a **non-playable
pursuer**, a predator that is blind between flares and hunts only in the light
of its own **flare** — a bright bloom it telegraphs with a charge-up glow.
Everything below describes the *enemy* — never the player character.

## The canvas and the frame grid

- The canvas is **128×128 pixels**, transparent background. Origin is the
  top-left; `x` increases to the right, `y` increases downward.
- It is a **sprite sheet**: a **4×4 grid of 32×32 frame cells**. Frame cell
  `(col, row)` (each `0–3`) occupies `x` in `[32·col, 32·col+32)` and `y` in
  `[32·row, 32·row+32)`. Draw each frame **inside its own cell** — keep a
  pixel or two of margin so a swimming creature never spills across a grid
  line into its neighbor (a flare bloom may reach toward the cell edges).
- Frames are numbered **row-major** from the top-left: frame `0` is `(0,0)`,
  frame `3` is `(3,0)`, frame `4` is `(0,1)`, … frame `15` is `(3,3)`.

## What goes in each frame

The sheet holds **four-direction movement** (two frames per direction, a small
swim cycle) and a **flare** animation in three beats:

| Frames | Cells | Contents |
| --- | --- | --- |
| 0, 1 | row 0, cols 0–1 | **swim down** — two frames (the tail flicks between them) |
| 2, 3 | row 0, cols 2–3 | **swim up** — two frames |
| 4, 5 | row 1, cols 0–1 | **swim left** — two frames |
| 6, 7 | row 1, cols 2–3 | **swim right** — two frames |
| 8, 9, 10 | row 2, cols 0–2 | **flare charge-up** — the organ glow grows |
| 11 | row 2, col 3 | **flare bloom** begins |
| 12, 13 | row 3, cols 0–1 | **flare bloom** continues (peak) |
| 14, 15 | row 3, cols 2–3 | **flare fade** — back to the dim organ |

In each **movement** frame the creature faces its direction of travel: the
**head leads** (points the way it swims) and a **forked tail trails** behind,
with the **flare organ** — a small warm glowing spot — on its body so it reads
as the flare-maker even in motion. Across the two frames of a direction, flick
the tail so the pair reads as a swim cycle. The left frames are the mirror of
the right; up is the mirror of down.

The **flare** frames hold the body roughly still while the flare goes off from
the organ:

- **Charge-up** (8–10): the organ's warm glow swells, brightening toward a
  white core — the telegraph before the flare.
- **Bloom** (11–13): a bright radial flare — expanding rings of warm light
  around a white core, growing frame to frame to a peak.
- **Fade** (14–15): the rings collapse back toward the dim organ.

Playing frames 8→15 reads unmistakably as a flare charging, blooming, and
fading.

## The form

The Emberfin reads, at a glance, as a **glowing orange predator that makes its
own light**:

- **Body:** a rounded, tapering **teardrop** in orange — a head leading the
  direction of travel, narrowing to a forked tail.
- **Head:** leads the swim, with a small dark mouth slit at the front.
- **Belly:** a lighter patch on the underside.
- **Tail:** a swept, forked tail fin trailing behind the head.
- **Flare organ:** a small warm glowing spot on the body — the source of the
  flare, and the brightest fixed element of the sprite.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Body (orange) | `#ff7a59` |
| Belly / lighter underside | `#ffb199` |
| Outline / mouth (darkest) | `#5a1e14` |
| Flare glow (warm) | `#ffd166` |
| Flare peak (bright) | `#ffffff` |

## Working the tool

Build each frame up in sensible layers — a dark rim, then the body teardrop,
then the belly, tail, and the flare organ — and place every operation inside
the correct cell by offsetting its coordinates by `(32·col, 32·row)`. Consult
`schemas/operations.json` for the available operations (filling and stroking
circles and rectangles, lines, single pixels, flood fill, and a horizontal
mirror) and their exact parameters. Call `draw` once per operation and read
`canvas.png` between calls to judge your progress against this brief and the
target. A good order is to finish one direction's two frames, check them, then
do the others, and finish with the flare charge-up, bloom, and fade frames.
