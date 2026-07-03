# Sunfront Monolith — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Monolith**, a towering super-heavy
bipedal war-mech carrying a giant cannon on its right arm, as a **3D voxel model**
with a **rig** a game can pose and animate at runtime. There is no target model
to
copy: build something that reads unmistakably as this hulking walking mech and
poses and walks correctly from the description below.

## The volume and coordinate system

- The volume is **64 wide (x) x 80 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`63`. **y** runs up, `0` (bottom, the ground)
  to `79` (top of the head). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the mech faces toward `z = 55` (the front), and the cannon
  points that way when it is level. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** — the two legs mirror each other, and the torso and head
  are centered on it (the right-arm cannon deliberately breaks that symmetry).
- The Monolith is deliberately **huge and imposing** — an expensive capstone
  bruiser, broad and heavily armored, filling most of the height and width. It
  stands planted on the ground, with the massive torso and head stacked above the
  hips.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (a leg segment already under its hip, the cannon already up at the shoulder).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Plating — primary armor (brass) | `#c69a4b` |
| Dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels (sandstone) | `#d9c48c` |
| Cannon, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Core and shoulder-light accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the mech a clear amber
**core set into the chest**, plus **amber shoulder lights**, so the accent reads
from multiple angles.

## The parts

The mech is a **rig** of eight required parts in a parent/child hierarchy. Each
leg is its **own independent chain of three segments** — a thigh, a shin, and a
short flat foot — so the leg can lift and plant its foot rather than only swing
rigidly. Sculpt each part in its own local coordinates within the shared volume,
positioned where it sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The massive upper body and head |
| `thigh_l` | `torso` | `[20, 34, 28]` | Left upper leg (hip) |
| `shin_l` | `thigh_l` | `[20, 18, 28]` | Left lower leg (knee) |
| `foot_l` | `shin_l` | `[20, 3, 28]` | Left short flat foot (ankle) |
| `thigh_r` | `torso` | `[44, 34, 28]` | Right upper leg (hip) |
| `shin_r` | `thigh_r` | `[44, 18, 28]` | Right lower leg (knee) |
| `foot_r` | `shin_r` | `[44, 3, 28]` | Right short flat foot (ankle) |
| `weapon` | `torso` | `[44, 52, 32]` | The giant right arm-cannon |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt a massive,
  broad-shouldered torso in the brass plating color (bronze on its underside and
  in the shadowed seams, sandstone secondary panels) rising from the hips, with
  a head on top. Set the **solar-amber core** into the front of the chest and add
  **amber shoulder lights**. Keep the hips and the right shoulder fleshed out and
  heavy where the legs and cannon mount so the children have something to seat
  against.
- **Each leg is its own three-segment chain**, on its own hip **directly above its
  own foot** — the x and z of the chain stay fixed (left leg at `x = 20, z = 28`,
  right at `x = 44, z = 28`); only y descends. Sculpt the thigh from the hip down
  to the knee, the shin from the knee down to the ankle, and a **short, flat foot**
  at the bottom, all in the iron color. **Rest the leg with a clearly bent knee**
  (a folded, standing crouch), never a straight column — a near-straight leg cannot
  keep its foot planted as the body passes over it. The left chain
  (`thigh_l`→`shin_l`→`foot_l`) sits under the left hip; the right chain mirrors
  it.
  Each segment sits **below and against** its parent with no gap at the joint.
- **`weapon`** attaches to the right shoulder at **`[44, 52, 32]`**. Sculpt a
  giant arm-cannon in the iron color carried on the right arm and projecting
  **forward (+z)**, meeting the shoulder at the mount with no gap. Shape it so it
  can tilt up and down about a horizontal hinge across the shoulder.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  shoulder mount at pivot **`[44, 52, 32]`**, driven by the **caller** (the game).
  Its range is **`min = -0.7` (aimed down) to `max = 0.7` (aimed up)**, resting
  at `0` (level, pointing straight forward). Driving it must **tilt the cannon up
  and down about that hinge** — the whole weapon as one solid piece — so the mech
  can aim. Only the weapon moves on this joint; no voxel of it should tear away
  from the arm or clip into the torso as it pitches.

Each leg carries **three `auto`-driven joints** the required **`walk`** animation
drives (you author its motion — see below). Per leg (`l` on the left,
`r` on the right):

- **`hip_<id>`** — a **rotation** about **x** through the hip pivot
  (`[20, 34, 28]` / `[44, 34, 28]`), `min = -0.5`, `max = 0.5`, rest `0` — the big
  fore/aft stride sweep.
- **`knee_<id>`** — a **rotation** about **x** through the knee pivot
  (`[20, 18, 28]` / `[44, 18, 28]`), `min = -1.4`, `max = 0.2`, **rest `-0.7`**
  (a
  clearly bent knee) — the shin fold. It must fold in the **reverse / digitigrade**
  direction (the natural walker knee, folding the shin rearward); if your sculpt
  makes the knee bend "inside-out", **flip the sign of the knee's animated values**
  (fix the direction, not just the range).
- **`foot_<id>`** — a **rotation** about **x** through the ankle pivot
  (`[20, 3, 28]` / `[44, 3, 28]`), `min = -0.3`, `max = 0.3`, rest `0` — the ankle
  tilt that counter-rotates against the shin to keep the **foot flat** (only about
  ±15° across the whole cycle, never on toes or heels).

Sculpt each leg so it swings and folds plausibly about these joints without any
segment detaching from its parent.

You **may add** your own extra parts, joints, or animations on top of this (for
example a subtle head turn, or an extra left-arm detail), but you must **not drop
or contradict** the required parts, the required caller `weapon_pitch` joint, the
six auto leg joints, or the two required animations below.

## The required animations — author the motion as F-curves

Your rig must carry two animations. The case declares only their **identity and
intent**; **you author each one's motion** with the `voxel-anim` animation
subcommands — `define-animation` to declare it, then `add-keyframe` to set each
keyframe — as **F-curves** (per-keyframe `--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` on bezier keys). The motion must **carry weight
through curves**, never slide linearly between poses. Run `voxel-anim --help` for
the exact animation subcommands and flags.

- **`walk`** (period **1100 ms**, loops, a named playable a game triggers) — drives
  **all six leg joints** (`hip_l`, `knee_l`, `foot_l`, `hip_r`, `knee_r`,
  `foot_r`). It is the mech's slow, heavy stride. The two legs run in **opposite
  phase** — the left and right a half period (550 ms) apart, so one foot is planted
  while the other swings. Each leg's cycle has **two phases**:
  1. **Stance** — the foot is **planted flat and still on the ground** and
     translates straight **backward relative to the body**: the machine passes
     forward over the planted foot. The hip and knee **extend and fold together**
     to hold the foot at a fixed ground point while the body moves over it, and
     the
     ankle counter-rotates to keep the foot flat.
  2. **Swing** — the knee folds to **lift the foot clear** of the ground, the leg
     travels **forward**, then **plants** again at the front of the stride.

  This planted stance segment is the single most important thing: a cycle where
  the
  foot is in a continuous arc and never sits still on the ground reads as
  **flailing**, not walking. Design the **foot path** first (a flat ground-level
  segment moving straight back, then a lifting arc forward), then solve the hip,
  knee, and ankle angles that place the foot on that path, then set them as eased
  keyframes. As a slow, super-heavy bruiser the Monolith **rolls smoothly**
  (`ease-in-out` through most of the cycle) with a firm, sharp **`ease-in` into
  each foot-plant** for the weight/"thump" of a heavy foot landing.
- **`fire`** (period **600 ms**, loops, a named playable) — drives only
  `weapon_pitch`. Snap the cannon into a quick recoil nod, overshoot back, and
  settle, so a reviewer can watch the cannon recoil through its hinge without
  dragging the slider by hand. Touch no leg joint; the legs hold still while it
  plays. Author it as F-curves too (a fast `ease-out` snap, a settle back), not
  a
  linear slide.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg segment (thigh, shin, foot), then the cannon,
checking each part's preview as you go. Define the parts, pivots, the caller
`weapon_pitch` joint, and the six auto leg joints through the tool's rig
subcommands, then define and key the `walk` and `fire` animations (the required
parts, joints, and animation declarations are already pre-seeded in `rig.json`,
but
confirm they match this brief, adjust pivots to your sculpt, and add the keyframes).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig **and animation** subcommands, and `voxel-anim <operation> --help` for each
one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
