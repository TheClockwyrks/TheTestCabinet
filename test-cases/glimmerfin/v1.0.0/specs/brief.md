# Glimmerfin — drawing brief

You are drawing the **Glimmerfin**, a **sprite sheet** for a deep-sea maze-chase
game. The Glimmerfin is **the player character**: a small bioluminescent
**forager** that threads the flooded corridors of a pitch-dark trench, grazing
drifting plankton while predators hunt it. Everything below describes the
*player* — the hero you steer, not an enemy.

You are drawing the forager swimming in four directions with a **chomp** as it
grazes. Its signature **glow** — it brightens as it eats — flares up at any
moment from what the player does, so the game renders it as a separate runtime
effect. Do **not** draw a glow, halo, or light rings on this sheet; just the
creature itself.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–31) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**. Keep a pixel or two of margin so the
  forager sits inside its frame, neither tiny in a corner nor clipped at the edge.

## What goes in each frame

The sheet holds **four-direction movement** with a **two-frame chomp** per
direction — a mouth-closed frame and a mouth-open frame:

| Frames | Contents |
| --- | --- |
| 0, 1 | **graze down** — mouth closed, then mouth open |
| 2, 3 | **graze up** — mouth closed, then mouth open |
| 4, 5 | **graze left** — mouth closed, then mouth open |
| 6, 7 | **graze right** — mouth closed, then mouth open |

In each frame the forager **faces its direction of travel**: the **mouth leads**
(at the front, pointing the way it swims) and a small **forked tail trails**
behind. The two frames of a direction differ only in the mouth:

- **Mouth closed** (first frame): the front is nearly whole, the mouth a thin
  dark slit.
- **Mouth open** (second frame): a clear **wedge is bitten out of the leading
  edge** — an open mouth — like a small grazer taking a bite.

Alternating the two reads as the forager **chomping** as it moves. The left
frames are the mirror of the right; up is the mirror of down.

## The form

The Glimmerfin reads, at a glance, as a **small, bright forager grazing in the
dark**:

- **Body:** a small, rounded body in bright cyan — compact, a little
  teardrop-shaped, the mouth end leading and a forked tail behind.
- **Mouth:** at the leading edge, opening and closing as the chomp (above). This
  is the front of the creature and points the way it swims.
- **Belly:** a lighter patch on the underside.
- **Tail / fins:** a small swept forked tail trailing behind, perhaps a hint of
  side fins.
- **Highlight:** a small bright glint on the body for life — but **no glow,
  halo, or light rays**; brightness is a runtime effect, not drawn here.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Body (bright cyan) | `#46f0e0` |
| Belly / lighter underside | `#9ffaf0` |
| Outline / mouth (darkest) | `#08201e` |
| Highlight (bright) | `#e8fffb` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
