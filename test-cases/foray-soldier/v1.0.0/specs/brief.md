# Foray Soldier — drawing brief

You are drawing the **Foray soldier**, a **sprite sheet** for *Foray*, a
top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds and royal jelly; the **soldier is the defender** — the heavy, armored
caste that guards the nest and tags intruders. You are drawing the *defender*,
the same sprite for either colony (see **Palette** for why it is drawn in
neutral grey).

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–15) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **4 frames, numbered 0–3**, one per facing — the soldier is shown
  from directly above (top-down), turned to face four directions:

  | Frame | Facing |
  | --- | --- |
  | 0 | facing **down** (toward the bottom of the screen) |
  | 1 | facing **up** |
  | 2 | facing **left** |
  | 3 | facing **right** |

- Keep a pixel of margin so the ant sits inside its frame, neither tiny in a
  corner nor clipped at the edge. The four frames are the same soldier rotated,
  so they should read as one creature seen from four sides — the left frame is
  the mirror of the right; up is the mirror of down.

## The form

The soldier reads, at a glance, as a **heavy armored ant**, distinct from the
lean raider it defends against:

- **Head:** a broad, armored head leading the facing direction, carrying **two
  forward-curving mandibles** — the soldier's signature. The mandibles are the
  single feature that must read: they mark this as the fighting caste.
- **Body:** a stout, segmented thorax-and-abdomen behind the head — bulkier and
  more angular than a forager's, so the silhouette reads as armored and slow.
- **Legs:** a few short legs hinted along the sides; they need not be detailed
  at this size, only enough to read as a six-legged insect rather than a blob.
- **Shading:** a darker rim around the body, a mid body fill, and a lighter
  highlight along the leading edge so the form reads as rounded armor.

## Palette

This sprite is **recolored per colony at runtime by a palette swap**, so you
draw it **once in a neutral grey ramp** — never in red or blue. Use only these
colors (the drawing is regenerated pixel-for-pixel, so stray or off-palette
colors and anti-aliased fringes count against you):

| Role | Hex | Notes |
| --- | --- | --- |
| Body, darkest | `#3a3a3a` | recolorable — becomes the colony's dark tone |
| Body, mid | `#6a6a6a` | recolorable — the main body fill |
| Body, light | `#9a9a9a` | recolorable — the leading-edge highlight |
| Head / mandibles accent | `#cccccc` | recolorable — the brightest body color |
| Outline | `#0a0806` | fixed dark outline; not recolored |

The four `#3a3a3a`/`#6a6a6a`/`#9a9a9a`/`#cccccc` greys are the **recolorable
ramp** — at draw time they are remapped to the colony's red or blue ramp, so the
soldier reads as red or blue without redrawing. The `#0a0806` outline stays dark
for both colonies. Do not use any other color.

## Working the tool

Build each frame up in sensible layers — a dark outline, then the body fill, the
highlight, and finally the head with its two mandibles — drawing into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–15). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief. A good order is to finish the down-facing frame, check
that the mandibles read, then do up, left, and right — mirroring left from right
and up from down where it helps.
