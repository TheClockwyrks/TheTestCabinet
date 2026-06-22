# Foray Raider — drawing brief

You are drawing the **Foray raider**, an animated **sprite sheet** for *Foray*,
a top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds and royal jelly; the **raider is the forager** — the lean, fast caste that
crosses into enemy ground, picks up a seed, and hauls it home. You are drawing
the *forager*, in **two states** — empty-handed and **laden** (carrying a
seed) — the same sprite for either colony (see **Palette** for why the body is
drawn in neutral grey). It must read as **walking**: the renderer plays a walk
cycle as the raider moves, so you are drawing animation frames, not still poses.

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–15) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **32 frames, numbered 0–31**: a **four-step walk cycle** in each of
  **four facings**, drawn **twice** — empty (0–15) and laden with a seed
  (16–31), laid out facing-major. The raider is shown from directly above:

  | Frames | State | Facing | Role |
  | --- | --- | --- | --- |
  | 0, 1, 2, 3 | empty | **down** | walk steps 1–4 |
  | 4, 5, 6, 7 | empty | **up** | walk steps 1–4 |
  | 8, 9, 10, 11 | empty | **left** | walk steps 1–4 |
  | 12, 13, 14, 15 | empty | **right** | walk steps 1–4 |
  | 16, 17, 18, 19 | laden | **down** | walk steps 1–4 |
  | 20, 21, 22, 23 | laden | **up** | walk steps 1–4 |
  | 24, 25, 26, 27 | laden | **left** | walk steps 1–4 |
  | 28, 29, 30, 31 | laden | **right** | walk steps 1–4 |

- Within a facing the four frames are **one walk cycle**, played in order and
  looping. Each laden cycle is **the matching empty cycle carrying a seed** — so
  frames 16–19 are frames 0–3 with a gold seed added, 20–23 are 4–7 laden, and
  so on. Keep a pixel of margin so the ant (and its seed, and the small bob) sits
  inside its frame, never clipped. Left mirrors right; up mirrors down.

## The walk cycle

Insects walk in an **alternating tripod gait**: three legs swing while the other
three plant, then they swap. Animate that across the four frames of each facing
so the loop reads as a scuttle, not a flicker:

- **Step 1 (frame 0/4/8/12, …):** contact pose — one leg-tripod forward, the
  other back; body at its base position.
- **Step 2:** passing pose — legs gathered under the body, body eased ~1 px along
  the travel axis (a small bob).
- **Step 3:** contact pose mirrored — the opposite tripod now forward; body back
  at base.
- **Step 4:** passing pose mirrored — legs gathered the other way, body bobbed.

The legs are thin and need not be individually detailed — a few pixels per side
that visibly **alternate** between frames is enough. The head and body silhouette
stay constant within a facing; only the legs and the small bob change.

## The form

Each frame reads, at a glance, as a **lean, fast forager**, clearly lighter than
the heavy soldier it dodges:

- **Head:** a small, neat head leading the facing direction — **no mandibles**
  (those belong to the soldier). The lean head is part of how the raider reads
  apart from the defender.
- **Body:** a slim, narrow thorax-and-abdomen — visibly leaner than a soldier's,
  so the silhouette reads as quick and unarmored.
- **Legs:** thin legs along the sides, longer and finer than a soldier's, that
  **alternate** across the cycle (see **The walk cycle**).
- **Shading:** a darker rim, a mid body fill, and a lighter highlight along the
  leading edge.

### The laden state (frames 16–31)

A laden raider is **carrying a seed home** and reads as **slow and heavy**:

- A **gold seed** rides on the raider's back — a rounded gold lump clearly sitting
  *on top of* the body, the most eye-catching thing in the frame, present in
  every frame of the laden cycles.
- The carried seed makes the raider read as **weighed down**: across the laden
  cycle the body sits a little lower and the stride is shorter than the matching
  empty cycle, so the laden walk looks more labored — empty-vs-laden is obvious
  at a glance. This carry-weight tell is the raider's whole job.

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

Build each frame up in sensible layers — a dark outline, then the slim body fill,
the highlight and head, the legs in their pose for that step, and (for the laden
frames) the gold seed on the back last — drawing into the frame you select with
`--frame <index>`, using plain in-frame coordinates (0–15). Run `draw-sheet
--help` for the available operations (filling and stroking circles and rectangles,
lines, single pixels, flood fill, and a horizontal mirror) and `draw-sheet
<operation> --help` for each one's exact flags. Call `draw-sheet` once per
operation and read `frames/<index>.png` between calls to judge that frame against
this brief.

A good order: finish one empty facing as a cycle first (draw the shared body once
and vary the legs/bob per step), check it reads leaner than a soldier and plays
as a walk, then do the other empty facings (mirroring where it helps), then add
the gold seed and the heavier, shorter-stride bob to make the four laden cycles.
