# Sunfront Bulwark — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark**, a heavy bipedal war-mech
carrying a broad tower shield on its left arm, as a **3D voxel model** with a
small **rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this armored shield-mech and poses correctly
from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 68 tall (y) x 48 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `67` (top of the head). **z** runs front-to-back, `0`-`47`.
- **Forward is +z:** the head faces and the shield braces toward `z = 47` (the
  front) when the arm is at rest. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** — the two legs mirror each other and the torso and head
  are centered on it. The one deliberate exception is the shield arm, which sits
  out on the **left** side.
- The Bulwark is deliberately **broad and heavily armored** — a slow, plodding
  frontline tank, wide across the shoulders and thick in the leg, not a lithe
  runner.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (a leg already under its hip, the shield arm already up at the left shoulder).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Joints, shield frame, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Chest-core accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: set a clear amber **core into
the center of the chest**, so the accent reads from multiple angles.

## The parts

The mech is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The armored upper body and head |
| `leg_left` | `torso` | `[18, 28, 24]` | The left leg |
| `leg_right` | `torso` | `[38, 28, 24]` | The right leg |
| `weapon` | `torso` | `[16, 42, 26]` | The left tower-shield arm |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt a broad,
  heavily armored upper body in the brass armor color (bronze on its underside and
  in the shadowed seams) with a head set on top around `y = 60`, standing above
  the hips (from about `y = 28` up). Set the **solar-amber core** into the middle
  of the chest. Keep the shoulders and hips fleshed out where the arm and legs mount
  so the children have something to seat against.
- **`leg_left`** attaches under the left hip at **`[18, 28, 24]`**. Sculpt a thick,
  armored leg in brass and bronze with an iron hip and knee joint, reaching down
  to the ground and planted beneath the hip. It meets the torso at the mount with
  no gap.
- **`leg_right`** attaches under the right hip at **`[38, 28, 24]`**, a mirror of
  the left leg.
- **`weapon`** attaches at the left shoulder at **`[16, 42, 26]`**. Sculpt a broad
  **tower shield** carried on a short armored arm: a wide, tall slab of brass and
  bronze plating with an iron frame, held out on the left side and facing
  **forward (+z)**. It meets the shoulder at the mount with no gap. Shape it so
  the whole arm-and-shield assembly can swing up and down about a horizontal
  shoulder hinge.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  left shoulder hinge at pivot **`[16, 42, 26]`**, driven by the **caller** (the
  game). Its range is **`min = -0.5` (braced low) to `max = 0.7` (raised for the
  overhead smash)**, resting at `0` (shield held level, forward). Driving it must
  **swing the whole tower-shield arm as one solid piece up and down about that
  hinge** — so the mech can raise the shield and smash it down. Only the weapon
  moves on this joint; no voxel of it should tear away from the shoulder or clip
  into the torso as it swings.

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the legs walk without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[18, 28, 24]`**,
  `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[38, 28, 24]`**, driven in the
  opposite phase so the mech walks in a natural gait.

Sculpt each leg so it rotates plausibly forward and back about its hip mount
without detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle head turn, or shoulder detail), but you must **not drop or
contradict** the required parts, the required caller `weapon_pitch` joint, or the
two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the armored torso and head, then each leg, then the tower-shield arm, checking
each part's preview as you go. Define the parts, pivots, the caller `weapon_pitch`
joint, and the two auto stride joints through the tool's rig subcommands (the
required parts and joints are already pre-seeded in `rig.json`, but confirm they
match this brief and adjust pivots to your sculpt). Run `voxel-anim --help` for
the available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` between calls to judge each part against
this brief.
