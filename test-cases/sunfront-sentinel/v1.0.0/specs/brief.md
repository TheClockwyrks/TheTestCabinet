# Sunfront Sentinel — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Sentinel**, an upright bipedal
war-mech carrying a rifle on its right arm, as a **3D voxel model** with a small
**rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this walking mech and poses correctly from
the description below.

## The volume and coordinate system

- The volume is **44 wide (x) x 64 tall (y) x 40 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `63` (top of the head). **z** runs front-to-back, `0`-`39`.
- **Forward is +z:** the mech faces toward `z = 39` (the front), and the rifle
  points that way when it is level. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** — the two legs mirror each other, and the torso and head
  are centered on it (the right-arm rifle deliberately breaks that symmetry).
- The Sentinel is deliberately **tall and upright** — a backbone ranged trooper
  standing on two legs, filling most of the height. It stands planted on the
  ground, with the torso and head stacked above the hips.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (a leg already under its hip, the rifle already up at the shoulder).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Torso — primary plating (brass) | `#c69a4b` |
| Dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels (sandstone) | `#d9c48c` |
| Rifle, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Visor accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the mech a clear amber
**visor across the head**, so the accent reads from multiple angles.

## The parts

The mech is a **rig** of eight required parts in a parent/child hierarchy. Each
leg is its **own** three-segment chain — a thigh, a shin, and a short foot —
rather than a single swung block. Sculpt each part in its own local coordinates
within the shared volume, positioned where it sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `thigh_l` | `torso` | `[14, 26, 20]` | Left upper leg (thigh) |
| `shin_l` | `thigh_l` | `[14, 14, 20]` | Left lower leg (shin) |
| `foot_l` | `shin_l` | `[14, 3, 20]` | Left flat foot |
| `thigh_r` | `torso` | `[30, 26, 20]` | Right upper leg (thigh) |
| `shin_r` | `thigh_r` | `[30, 14, 20]` | Right lower leg (shin) |
| `foot_r` | `shin_r` | `[30, 3, 20]` | Right flat foot |
| `weapon` | `torso` | `[30, 40, 24]` | The right-arm rifle |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt an upright
  torso in the brass plating color (bronze on its underside and in the shadowed
  seams, sandstone secondary panels) rising from the hips, with a head on top.
  Set the **solar-amber visor** across the front of the head. Keep the hips and
  the right shoulder fleshed out where the legs and rifle mount so the children
  have something to seat against.
- **The left leg** is a three-part chain hung under the left hip. **`thigh_l`**
  attaches to the torso at **`[14, 26, 20]`** (the hip); **`shin_l`** hangs from
  the knee at **`[14, 14, 20]`**; **`foot_l`** is a short, **flat** foot on the
  ankle at **`[14, 3, 20]`**. Notice the x and z stay fixed down the chain and
  only y descends — so the whole leg stands **directly above its own foot**.
  Sculpt it in the iron color, each segment seating against its parent with no
  gap. Sculpt the leg in a clearly **bent-knee** stance (the knee folded, not a
  straight column) so the foot can stay planted as the body passes over it.
- **The right leg** — **`thigh_r`** `[30, 26, 20]`, **`shin_r`** `[30, 14, 20]`,
  **`foot_r`** `[30, 3, 20]` — mirrors the left in the same iron color.
- **`weapon`** attaches to the right shoulder at **`[30, 40, 24]`**. Sculpt a
  rifle in the iron color carried on the right arm and projecting **forward (+z)**,
  meeting the shoulder at the mount with no gap. Shape it so it can tilt up and
  down about a horizontal hinge across the shoulder.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  shoulder mount at pivot **`[30, 40, 24]`**, driven by the **caller** (the game).
  Its range is **`min = -0.7` (aimed down) to `max = 0.7` (aimed up)**, resting
  at `0` (level, pointing straight forward). Driving it must **tilt the rifle up
  and down about that hinge** — the whole weapon as one solid piece — so the mech
  can aim. Only the weapon moves on this joint; no voxel of it should tear away
  from the arm or clip into the torso as it pitches.

Each leg carries **three `auto` joints**, driven by the `walk` animation (below),
never by the caller. Per leg (`<id>` is `l` then `r`):

- **`hip_<id>`** on the thigh — **rotation** about **x** through the hip pivot,
  `min = -0.5`, `max = 0.5`, rest `0`. The big fore/aft sweep of the leg.
- **`knee_<id>`** on the shin — **rotation** about **x** through the knee pivot,
  `min = -1.4`, `max = 0.2`, **rest = `-0.7`** (a clearly **bent** knee at rest,
  never straight). This is a **reverse / digitigrade** knee: `-0.7` must fold the
  shin **rearward**. If your sculpt makes the knee bend "inside-out", flip the
  **sign** of the knee's animated values (fix the direction, not just the range).
- **`foot_<id>`** on the foot — **rotation** about **x** through the ankle pivot,
  `min = -0.3`, `max = 0.3`, rest `0`. A small ankle tilt (only ±~15° across the
  whole cycle) that **keeps the foot flat** by counter-rotating against the shin.

Sculpt each leg so it bends at hip, knee, and ankle without any segment detaching
from its parent across these ranges.

## The required animations

You must also **author two animations** with the tool's animation subcommands —
`define-animation` to declare each one, then `add-keyframe` to lay down its
motion. Author the motion as **F-curves**, not straight lines: each `add-keyframe`
takes an `--interp` (`constant` | `linear` | `bezier`, or the easing presets
`ease-in` | `ease-out` | `ease-in-out`) with optional `--out-handle`/`--in-handle`
Bézier tangents, so the motion carries weight instead of sliding linearly. The two
required animations are:

- **`walk`** — period **800 ms**, `loop = true`, **not** auto-play; it drives all
  six leg joints (`hip_l`, `knee_l`, `foot_l`, `hip_r`, `knee_r`, `foot_r`) and
  **no** weapon joint. Author a believable walk cycle with a **planted stance
  phase**: for each leg there must be a segment of the cycle where the **foot is
  flat and still on the ground** and translates straight **backward relative to
  the body** (the mech passing over it) while the hip and knee extend and fold to
  hold the foot at a fixed ground point — then a **swing** where the knee folds
  to
  lift the foot clear, carries it forward, and **plants** it again. Put an
  **`ease-in` on the descent into the foot-plant** so each step lands with weight
  (a "thump"), and keep the ankle counter-rotating so the foot stays flat (±~15°)
  throughout. Design the **foot path first**, then solve the hip/knee/ankle angles
  that place the foot on it. Phase the two legs in **opposite** phase (a half
  period apart) so the mech is always supported. There must **not** be a
  continuous, foot-never-still arc — that reads as flailing, not walking.
- **`fire`** — period **500 ms**, `loop = true`, **not** auto-play; it drives only
  `weapon_pitch`. Snap the rifle into a quick recoil nod (a fast `ease-in` kick),
  overshoot back, and settle, so a reviewer can watch it recoil without dragging
  the slider.

You **may add** your own extra parts, joints, or animations on top of this (for
example a subtle head turn, or a self-playing idle detail), but you must **not
drop or contradict** the required parts, the required caller `weapon_pitch` joint,
the six auto leg joints, or the two required animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg segment (thigh, shin, foot), then the rifle,
checking each part's preview as you go. Define the parts, pivots, the caller
`weapon_pitch` joint, and the six auto leg joints through the tool's rig
subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt), then author
the `walk` and `fire` animations with `define-animation` and `add-keyframe`. Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane), the
rig subcommands, and the animation subcommands, and `voxel-anim <operation>
--help` for each one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
