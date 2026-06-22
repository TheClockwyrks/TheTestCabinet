# Foray Raider — drawing brief

You are drawing the **Foray raider**, a **sprite sheet** for *Foray*, a top-down
ant-colony raiding game. Two colonies raid each other's territory for seeds and
royal jelly; the **raider is the forager** — the lean, fast caste that crosses
into enemy ground, picks up a seed, and hauls it home. You are drawing the
*forager*, in **two states** — empty-handed and **laden** (carrying a seed) —
the same sprite for either colony (see **Palette** for why the body is drawn in
neutral grey).

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–15) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**: four empty facings, then the same four
  facings laden with a seed. The raider is shown from directly above (top-down):

  | Frame | State | Facing |
  | --- | --- | --- |
  | 0 | empty | facing **down** |
  | 1 | empty | facing **up** |
  | 2 | empty | facing **left** |
  | 3 | empty | facing **right** |
  | 4 | laden | facing **down** |
  | 5 | laden | facing **up** |
  | 6 | laden | facing **left** |
  | 7 | laden | facing **right** |

- Keep a pixel of margin so the ant sits inside its frame, neither tiny in a
  corner nor clipped at the edge. The laden frames are the **same raider as the
  empty frame of the matching facing**, with a seed added — so frame 4 is frame
  0 carrying a seed, frame 5 is frame 1 carrying a seed, and so on.

## The form

The raider reads, at a glance, as a **lean, fast forager**, clearly lighter than
the heavy soldier it dodges:

- **Head:** a small, neat head leading the facing direction — **no mandibles**
  (those belong to the soldier). The lean head is part of how the raider reads
  apart from the defender.
- **Body:** a slim, narrow thorax-and-abdomen — visibly leaner than a soldier's,
  so the silhouette reads as quick and unarmored.
- **Legs:** a few thin legs hinted along the sides, longer and finer than a
  soldier's; enough to read as a nimble six-legged insect.
- **Shading:** a darker rim, a mid body fill, and a lighter highlight along the
  leading edge.

### The laden state (frames 4–7)

A laden raider is **carrying a seed home** and reads as **slow and heavy**:

- A **gold seed** rides on the raider's back — a rounded gold lump clearly sitting
  *on top of* the body, the most eye-catching thing in the frame.
- The carried seed makes the raider read as **weighed down**: the body sits a
  little lower and heavier than the matching empty frame, so empty-vs-laden is
  obvious at a glance (this carry-weight tell is the raider's whole job).

## Palette

The raider's **body** is **recolored per colony at runtime by a palette swap**,
so you draw the body **once in a neutral grey ramp** — never in red or blue. The
**carried seed is shared gold** and is *not* recolored. Use only these colors
(the drawing is regenerated pixel-for-pixel, so stray or off-palette colors and
anti-aliased fringes count against you):

| Role | Hex | Notes |
| --- | --- | --- |
| Body, darkest | `#3a3a3a` | recolorable — becomes the colony's dark tone |
| Body, mid | `#6a6a6a` | recolorable — the main body fill |
| Body, light | `#9a9a9a` | recolorable — the leading-edge highlight |
| Head accent | `#cccccc` | recolorable — the brightest body color |
| Carried seed (gold) | `#ffd964` | **laden frames only**; shared, not recolored |
| Outline | `#0a0806` | fixed dark outline; not recolored |

The four `#3a3a3a`/`#6a6a6a`/`#9a9a9a`/`#cccccc` greys are the **recolorable
ramp** — remapped to the colony's red or blue ramp at draw time. The gold seed
(`#ffd964`) and the `#0a0806` outline stay the same for both colonies, so the
carried seed pops gold against either. Do not use any other color.

## Working the tool

Build each frame up in sensible layers — a dark outline, then the slim body
fill, then the highlight and head, and (for frames 4–7) the gold seed on the back
last — drawing into the frame you select with `--frame <index>`, using plain
in-frame coordinates (0–15). Run `draw-sheet --help` for the available operations
(filling and stroking circles and rectangles, lines, single pixels, flood fill,
and a horizontal mirror) and `draw-sheet <operation> --help` for each one's exact
flags. Call `draw-sheet` once per operation and read `frames/<index>.png` between
calls to judge that frame against this brief. A good order is to finish the four
empty facings first (mirroring left from right, up from down), check that they
read leaner than a soldier, then add the gold seed to make the four laden frames.
