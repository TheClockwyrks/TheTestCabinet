# Sunfront Monolith — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Monolith**, a towering super-heavy
bipedal war-mech carrying a giant cannon on its right arm, as a **3D voxel model**
with a small **rig** a game can pose at runtime. There is no target model to copy:
build something that reads unmistakably as this hulking walking mech and poses
correctly from the description below.

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
  (a leg already under its hip, the cannon already up at the shoulder).

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

The mech is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The massive upper body and head |
| `leg_left` | `torso` | `[20, 34, 28]` | The left leg |
| `leg_right` | `torso` | `[44, 34, 28]` | The right leg |
| `weapon` | `torso` | `[44, 52, 32]` | The giant right arm-cannon |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt a massive,
  broad-shouldered torso in the brass plating color (bronze on its underside and
  in the shadowed seams, sandstone secondary panels) rising from the hips, with
  a head on top. Set the **solar-amber core** into the front of the chest and add
  **amber shoulder lights**. Keep the hips and the right shoulder fleshed out and
  heavy where the legs and cannon mount so the children have something to seat
  against.
- **`leg_left`** attaches to the left hip at **`[20, 34, 28]`**. Sculpt a single
  thick, jointed leg in the iron color reaching down to a planted foot on the
  ground from its hip mount, positioned under the left side of the torso. It sits
  **below and against** the torso with no gap at the mount.
- **`leg_right`** attaches to the right hip at **`[44, 34, 28]`**, a mirror of the
  left leg in the same iron color.
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

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the mech walks without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[20, 34, 28]`**,
  `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[44, 34, 28]`**, driven in the
  opposite phase so the mech walks in a slow, heavy gait.

Sculpt each leg so it swings plausibly forward and back about its hip without
detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle head turn, or an extra left-arm detail), but you must **not
drop or contradict** the required parts, the required caller `weapon_pitch` joint,
or the two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg, then the cannon, checking each part's preview
as you go. Define the parts, pivots, the caller `weapon_pitch` joint, and the two
auto stride joints through the tool's rig subcommands (the required parts and
joints are already pre-seeded in `rig.json`, but confirm they match this brief and
adjust pivots to your sculpt). Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
