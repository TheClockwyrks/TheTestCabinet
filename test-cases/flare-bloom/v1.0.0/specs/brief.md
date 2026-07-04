# Flare Bloom — drawing brief

You are drawing the **flare bloom**, a **sprite sheet** for a deep-sea
maze-chase game. The flare is the bright **radial burst** the **Flarefish**
predator sets off: blind between flares, it floods a wide circle of the dark
trench with warm light to hunt in. It is an **area effect**, not a creature — the
bloom lights a radius far larger than the Flarefish's own little sprite, which is
why it gets a large canvas of its own.

You are drawing the flare as a short **animation** in three beats — a charge-up,
a bloom, and a fade — centered in the frame.

## Compositing — warm light on transparency

The flare is drawn as warm light on a fully **transparent** background, so it
composites over the dark trench (the game draws it as an additive glow).

- The only opaque pixels are the flare itself; do **not** fill the background.
- Keep everything in the **warm palette** below — there is no cold color in a
  flare.

## The frames

- Each frame is its own **128×128-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward.
  Coordinates are **within the frame** (0–127). The center of the frame is near
  **(64, 64)** — build every flare around that point.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**, played as one flare.

## What goes in each frame

The flare in **three beats**:

| Frames | Beat | Contents |
| --- | --- | --- |
| 0, 1, 2 | **charge-up** | a small warm glow at the center swelling and brightening toward a white core — the telegraph before the flare |
| 3, 4, 5 | **bloom** | a bright radial burst: a white-hot core ringed by warm light spreading outward, growing to its widest, brightest peak at frame 5 |
| 6, 7 | **fade** | the bloom collapses and dims back toward dark |

Make it read as a **flare going off**, not a steady lamp:

- In the **charge-up**, the glow is small and tight, brightening from warm toward
  a white core across the three frames.
- In the **bloom**, draw a **white-hot core** at the center with **concentric
  warm rings** (or rays) spreading outward and softening to the orange edge — a
  burst of light flooding out in all directions. Each bloom frame is wider and
  brighter than the last, peaking at frame 5 (its widest ring reaching toward the
  frame edges, radius ~58).
- In the **fade**, shrink and dim the bloom back down over the two frames.
- Keep the burst **round and centered** on (64, 64).

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Flare peak / core (white-hot) | `#ffffff` |
| Flare glow (warm) | `#ffd166` |
| Flare edge (warm orange, outer rings) | `#ff7a59` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–127). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
