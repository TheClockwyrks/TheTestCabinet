# Foray Soldier — drawing brief

You are drawing the **Foray soldier**, an animated **sprite sheet** for *Foray*,
a top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds and royal jelly; the **soldier is the defender** — the heavy, armored
caste that guards the nest and tags intruders. You are drawing the *defender*,
the same sprite for either colony (see **Palette** for why it is drawn in
neutral grey). It must read as **walking**: the renderer plays a short walk
cycle as the soldier moves, so you are drawing animation frames, not four still
poses.

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–15) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **16 frames, numbered 0–15**: a **four-step walk cycle** in each of
  **four facings**, laid out facing-major.

  | Frames | Facing | Role |
  | --- | --- | --- |
  | 0, 1, 2, 3 | **down** (toward the bottom of the screen) | walk steps 1–4 |
  | 4, 5, 6, 7 | **up** | walk steps 1–4 |
  | 8, 9, 10, 11 | **left** | walk steps 1–4 |
  | 12, 13, 14, 15 | **right** | walk steps 1–4 |

- Within a facing the four frames are **one walk cycle**, played in order and
  looping (after the 4th comes the 1st again). The four facings are the same
  soldier rotated, so they read as one creature seen from four sides — the left
  cycle is the mirror of the right; up is the mirror of down.
- Keep a pixel of margin so the ant sits inside its frame, neither tiny in a
  corner nor clipped at the edge — including the small bob (below), which must
  stay in frame.

## The walk cycle

Insects walk in an **alternating tripod gait**: three legs (front+rear on one
side, middle on the other) swing while the other three plant, then they swap.
Animate that across the four frames of each facing so the loop reads as a
purposeful scuttle, not a flicker:

- **Step 1 (frame 0/4/8/12):** contact pose — one leg-tripod forward, the other
  back; body at its base position.
- **Step 2:** passing pose — legs gathered under the body, body lifted/eased
  ~1 px along the travel axis (a small bob).
- **Step 3:** contact pose mirrored — the opposite tripod now forward; body back
  at base.
- **Step 4:** passing pose mirrored — legs gathered the other way, body bobbed
  again.

The legs are short and need not be individually detailed at this size — a few
pixels per side that visibly **alternate** between frames is enough. The head,
mandibles, and body silhouette stay constant within a facing; only the legs and
the small bob change. Played 0→1→2→3→0 it should read as the soldier walking.

## The form

Each frame reads, at a glance, as a **heavy armored ant**, distinct from the
lean raider it defends against:

- **Head:** a broad, armored head leading the facing direction, carrying **two
  forward-curving mandibles** — the soldier's signature. The mandibles are the
  single feature that must read in every frame: they mark this as the fighting
  caste.
- **Body:** a stout, segmented thorax-and-abdomen behind the head — bulkier and
  more angular than a forager's, so the silhouette reads as armored and slow.
- **Legs:** a few short legs along the sides that **alternate** across the cycle
  (see **The walk cycle**) — enough to read as a six-legged insect in motion.
- **Shading:** a darker rim around the body, a mid body fill, and a lighter
  highlight along the leading edge so the form reads as rounded armor.

## Palette

This sprite is **recolored per colony at runtime by a palette swap**, so you
draw it **once in a neutral grey ramp** — never in red or blue. Use only these
colors:

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

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–15). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
