# Sunfront Lancer — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lancer**, a tall bipedal
marksman-mech carrying a long center rail-lance, as a **3D voxel model** with a
small **rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this long-range walker and poses correctly
from the description below.

## The volume and coordinate system

- The volume is **44 wide (x) x 64 tall (y) x 64 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `63` (top). **z** runs front-to-back, `0`-`63`.
- **Forward is +z:** the rail-lance points toward `z = 63` (the front) when the
  weapon is at rest. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** — the two legs mirror each other, and the torso and
  rail-lance are centered on it.
- The volume is deliberately **deep** — most of that depth is there so the
  rail-lance can reach a long way forward from the chest.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (each leg segment already stacked under its hip, the lance already reaching out
  front).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Frame — primary plating (brass) | `#c69a4b` |
| Frame — secondary panels (sandstone) | `#d9c48c` |
| Shadowed structure (dark sandstone) | `#9c8455` |
| Rail-lance, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Charge-coil accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the lance a clear amber
**charge-coil** wrapped around its shaft, so the accent reads from multiple angles.

## The parts

The mech is a **rig** of eight required parts in a parent/child hierarchy. Each
leg is its **own** three-segment chain — a thigh, a shin, and a short flat foot
—
so the knee can bend to lift the foot instead of dragging a rigid leg. Sculpt each
part in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `thigh_l` | `torso` | `[14, 26, 24]` | The left upper leg (hangs from the left hip) |
| `shin_l` | `thigh_l` | `[14, 14, 24]` | The left lower leg (from the left knee) |
| `foot_l` | `shin_l` | `[14, 3, 24]` | The left foot (short and flat, from the ankle) |
| `thigh_r` | `torso` | `[30, 26, 24]` | The right upper leg |
| `shin_r` | `thigh_r` | `[30, 14, 24]` | The right lower leg |
| `foot_r` | `shin_r` | `[30, 3, 24]` | The right foot |
| `weapon` | `torso` | `[22, 44, 30]` | The long center rail-lance |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt an upright upper
  body in the brass frame color, with sandstone secondary panels and dark sandstone
  in the shadowed seams, and a head on top. Keep the underside around the hips
  (near `y = 26`) fleshed out where the thighs mount, and the chest fleshed out
  where the rail-lance seats, so the children have something to seat against.
- **The two legs are independent three-part chains, one on each hip directly above
  its own foot** (x and z held constant down each chain — `x = 14` on the left,
  `x = 30` on the right, `z = 24` for both — so only y descends and no shared pivot
  drags the feet through the ground):
  - **`thigh_l`** hangs from the left hip at **`[14, 26, 24]`** — the iron upper
    leg
    reaching down from the torso to the knee.
  - **`shin_l`** hangs from the left knee at **`[14, 14, 24]`** — the iron lower
    leg
    reaching down from the knee to the ankle.
  - **`foot_l`** hangs from the left ankle at **`[14, 3, 24]`** — a **short, flat**
    iron foot that meets the ground.
  - **`thigh_r` / `shin_r` / `foot_r`** mirror the left leg on the right side at
    `x = 30`, in the same iron color.
  - **Sculpt the rest pose as a clearly BENT leg**, not a straight column: the thigh
    angles down-and-forward from the hip and the shin folds back under it at the
    knee (a reverse/digitigrade fold), so the foot sits under the body with room
    to
    extend and fold as the mech walks. Each segment meets its parent at its mount
    with no gap.
- **`weapon`** attaches at the chest at **`[22, 44, 30]`**. Sculpt a long, slender
  rail-lance in the iron color, centered on the centerplane and projecting
  **forward (+z)** far out toward the front of the volume. Wrap a **solar-amber
  charge-coil** around its shaft. It must meet the chest at the mount with no gap.
  Shape it so it can tilt up and down about a horizontal axis through the mount.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  chest mount at pivot **`[22, 44, 30]`**, driven by the **caller** (the game).
  Its range is **`min = -0.6` to `max = 0.6`**, resting at `0` (lance level, aimed
  straight forward). Driving it must **tilt the whole rail-lance up and down about
  that mount** as one solid piece, so the mech can aim high or low. Only the weapon
  moves on this joint; no voxel of it should tear away from the frame or clip into
  the torso as it pitches.

Each leg carries **three `auto`-driven joints** — driven not by the caller but by
the required `walk` animation you author (below). Per leg, using `<id>` = `l` or
`r`:

- **`hip_<id>`** — a **rotation** about **x** through the hip pivot
  (`[14, 26, 24]` left, `[30, 26, 24]` right), **`min = -0.5`, `max = 0.5`,
  rest `0`**, `drive = "auto"`. The big fore-and-aft stride sweep.
- **`knee_<id>`** — a **rotation** about **x** through the knee pivot
  (`[14, 14, 24]` left, `[30, 14, 24]` right), **`min = -1.4`, `max = 0.2`,
  rest `-0.7`**, `drive = "auto"`. The fold that lifts the foot. **Rest `-0.7`
  is a
  clearly bent knee** (reverse/digitigrade — the shin swept rearward, never
  bending inside-out). If your sculpt folds the knee the wrong way, **flip the sign
  of the knee's animated values** — fix the direction, not just the range.
- **`foot_<id>`** — a **rotation** about **x** through the ankle pivot
  (`[14, 3, 24]` left, `[30, 3, 24]` right), **`min = -0.3`, `max = 0.3`,
  rest `0`**, `drive = "auto"`. A small ±~15° ankle tilt that **keeps the foot
  flat** — counter-rotate it against the shin so the mech never walks on its toes
  or heels.

Sculpt each leg so it folds plausibly at the hip and knee and keeps its foot flat
without any segment detaching from its parent.

## The required animations

You must **author** two animations with the `voxel-anim` animation subcommands —
`define-animation` to declare each, then `add-keyframe` to lay in its motion. Each
keyframe carries an interpolation (`--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` for bezier). Author the motion as **F-curves that
carry weight** — never a constant-speed linear slide between poses, which reads
as
weightless flailing.

- **`walk`** (period **800 ms**, looping) — drives all six leg joints
  (`hip_l`, `knee_l`, `foot_l`, `hip_r`, `knee_r`, `foot_r`) with the **left and
  right legs in opposite phase** (a half period, 400 ms, apart) so one foot is
  always planted. Each leg's cycle has two phases:
  1. **Stance** — the foot is **planted flat and still on the ground and translates
     straight backward relative to the body** (the machine passes over it). The
     hip
     sweeps forward-to-back and the knee extends/folds together to hold the foot
     at
     a fixed ground point; the ankle counter-rotates to keep the foot flat.
  2. **Swing** — the knee folds toward `-1.2` to **lift the foot clear**, the hip
     carries it forward, then the leg extends and **plants** — landing with an
     **`ease-in`** on the final descent for the weight of a heavy foot's "thump".

  Design the **foot path** first (flat ground-level segment back, then a lift arc
  forward), then solve the hip/knee/ankle angles that place the foot on it, then
  set
  the eased keys. There must be a segment where the foot is flat and still on the
  ground — no continuous-arc flailing.
- **`fire`** (period **500 ms**, looping) — drives only the caller `weapon_pitch`:
  a quick recoil nod off level, an overshoot back, and a settle. It touches no leg
  joint, so the legs hold their bent-knee stance while the lance recoils. Use eased
  curves (a sharp snap into the recoil, a softer settle), not a linear slide.

You **may add** your own extra parts, joints, or animations on top of this (for
example a subtle head scan), but you must **not drop or contradict** the required
parts, the required caller `weapon_pitch` joint, the six auto leg joints, or the
required `walk` and `fire` animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg's thigh, shin, and foot, then the rail-lance,
checking each part's preview as you go. Define the parts, pivots, the caller
`weapon_pitch` joint, and the six auto leg joints through the tool's rig
subcommands (the required parts, joints, and animation declarations are already
pre-seeded in `rig.json`, but confirm they match this brief and adjust pivots to
your sculpt), then author the `walk` and `fire` motion with `define-animation` /
`add-keyframe`. Run `voxel-anim --help` for the available operations (setting and
clearing single voxels, filling and stroking boxes, 3D lines, spheres, and a mirror
plane) and the rig and animation subcommands, and `voxel-anim <operation> --help`
for each one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
