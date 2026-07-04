# Flarefish — drawing brief

You are drawing the **Flarefish**, a **sprite sheet** for a deep-sea maze-chase
game. In that game the Flarefish is **the flare-maker**: a **non-playable
pursuer**, a predator that is blind between flares and hunts only in the light
of its own **flare**. Everything below describes the *enemy* — never the player
character.

You are drawing the **creature** here: its body swimming in four directions,
carrying the dim **flare organ** that marks it as the flare-maker. The flare
itself — the bright bloom it sets off — covers a far larger area than this
sprite and is **not** part of this sheet; it is a separate effect asset. Do not
try to draw an expanding flare here; just the creature and the organ on its body.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–31) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**. Keep a pixel or two of margin so the
  swimming creature sits inside its frame, neither tiny in a corner nor clipped
  at the edge.

## What goes in each frame

The sheet holds **four-direction movement**, two frames per direction (a small
swim cycle):

| Frames | Contents |
| --- | --- |
| 0, 1 | **swim down** — two frames (the tail flicks between them) |
| 2, 3 | **swim up** — two frames |
| 4, 5 | **swim left** — two frames |
| 6, 7 | **swim right** — two frames |

In each **movement** frame the creature faces its direction of travel: the
**head leads** (points the way it swims) and a **forked tail trails** behind,
with the **flare organ** — a small warm glowing spot — on its body so it reads
as the flare-maker even in motion. Across the two frames of a direction, flick
the tail so the pair reads as a swim cycle. The left frames are the mirror of
the right; up is the mirror of down.

## The form

The Flarefish reads, at a glance, as a **glowing orange predator that makes its
own light**:

- **Body:** a rounded, tapering **teardrop** in orange — a head leading the
  direction of travel, narrowing to a forked tail.
- **Head:** leads the swim, with a small dark mouth slit at the front.
- **Belly:** a lighter patch on the underside.
- **Tail:** a swept, forked tail fin trailing behind the head.
- **Flare organ:** a small warm glowing spot on the body — the source of the
  flare, and the brightest fixed element of the sprite. It is only the dim
  organ here, not a flare going off.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Body (orange) | `#ff7a59` |
| Belly / lighter underside | `#ffb199` |
| Outline / mouth (darkest) | `#5a1e14` |
| Flare organ (warm) | `#ffd166` |
| Flare organ core (bright) | `#ffffff` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet` once
per operation and read `frames/<index>.png` between calls to judge that frame
against this brief.
