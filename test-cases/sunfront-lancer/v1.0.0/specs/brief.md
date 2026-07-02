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
  (a leg already under its hip, the lance already reaching out front).

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

The mech is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The upper body and head |
| `leg_left` | `torso` | `[14, 26, 24]` | The left leg |
| `leg_right` | `torso` | `[30, 26, 24]` | The right leg |
| `weapon` | `torso` | `[22, 44, 30]` | The long center rail-lance |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt an upright upper
  body in the brass frame color, with sandstone secondary panels and dark sandstone
  in the shadowed seams, and a head on top. Keep the underside around the hips
  (near `y = 26`) fleshed out where the legs mount, and the chest fleshed out where
  the rail-lance seats, so the children have something to seat against.
- **`leg_left`** attaches under the left hip at **`[14, 26, 24]`**. Sculpt a single
  tall leg in the iron color reaching down to the ground from the hip mount,
  positioned under the left side of the torso. It sits **below and against** the
  torso with no gap at the mount.
- **`leg_right`** attaches under the right hip at **`[30, 26, 24]`**, a mirror of
  the left leg in the same iron color.
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

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the mech walks without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[14, 26, 24]`**,
  `min = -0.6`, `max = 0.6`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[30, 26, 24]`**, driven in the
  opposite phase so the mech strides in a natural gait.

Sculpt each leg so it rotates plausibly forward and back about its hip mount
without detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle head scan, or extra frame detail), but you must **not drop
or contradict** the required parts, the required caller `weapon_pitch` joint, or
the two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg, then the rail-lance, checking each part's
preview as you go. Define the parts, pivots, the caller `weapon_pitch` joint, and
the two auto stride joints through the tool's rig subcommands (the required parts
and joints are already pre-seeded in `rig.json`, but confirm they match this brief
and adjust pivots to your sculpt). Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
