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

The mech is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `leg_left` | `torso` | `[14, 26, 20]` | The left leg |
| `leg_right` | `torso` | `[30, 26, 20]` | The right leg |
| `weapon` | `torso` | `[30, 40, 24]` | The right-arm rifle |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt an upright
  torso in the brass plating color (bronze on its underside and in the shadowed
  seams, sandstone secondary panels) rising from the hips, with a head on top.
  Set the **solar-amber visor** across the front of the head. Keep the hips and
  the right shoulder fleshed out where the legs and rifle mount so the children
  have something to seat against.
- **`leg_left`** attaches to the left hip at **`[14, 26, 20]`**. Sculpt a single
  jointed leg in the iron color reaching down to a planted foot on the ground from
  its hip mount, positioned under the left side of the torso. It sits **below and
  against** the torso with no gap at the mount.
- **`leg_right`** attaches to the right hip at **`[30, 26, 20]`**, a mirror of the
  left leg in the same iron color.
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

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the mech walks without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[14, 26, 20]`**,
  `min = -0.6`, `max = 0.6`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[30, 26, 20]`**, driven in the
  opposite phase so the mech walks in a natural gait.

Sculpt each leg so it swings plausibly forward and back about its hip without
detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle head turn, or an extra left-arm detail), but you must **not
drop or contradict** the required parts, the required caller `weapon_pitch` joint,
or the two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg, then the rifle, checking each part's preview
as you go. Define the parts, pivots, the caller `weapon_pitch` joint, and the two
auto stride joints through the tool's rig subcommands (the required parts and
joints are already pre-seeded in `rig.json`, but confirm they match this brief and
adjust pivots to your sculpt). Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
