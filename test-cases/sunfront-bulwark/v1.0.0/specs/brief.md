# Sunfront Bulwark — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark**, a heavy bipedal war-mech
that braces a broad **tower shield** on its **left arm** and swings a heavy
**siege maul** in its **right arm**, as a **3D voxel model** with a small **rig**
a game can pose at runtime. There is no target model to copy: build something that
reads unmistakably as this armored shield-and-maul mech and poses correctly from
the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 68 tall (y) x 48 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `67` (top of the head). **z** runs front-to-back, `0`-`47`.
- **Forward is +z:** the head faces and the shield braces toward `z = 47` (the
  front) when the arms are at rest. Up is +y.
- Build the **torso, head, and the two legs symmetric** about the lengthwise
  vertical centerplane between `x = 27` and `x = 28`. The **two arms are the
  deliberate exceptions**: the **left** arm (out toward `x = 0`) carries the tower
  shield, and the **right** arm (out toward `x = 55`) wields the maul.
- The Bulwark is deliberately **broad and heavily armored** — a slow, plodding
  frontline tank, wide across the shoulders and thick in the leg, not a lithe
  runner.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (a leg already under its hip, the maul arm already up at the right shoulder).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Joints, shield frame, maul head, mechanisms (iron) | `#565c64` |
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
| `torso` | *(root)* | `[0, 0, 0]` | Body, head, both shoulders, and the left shield arm |
| `leg_left` | `torso` | `[18, 28, 24]` | The left leg |
| `leg_right` | `torso` | `[38, 28, 24]` | The right leg |
| `weapon` | `torso` | `[40, 44, 26]` | The right arm gripping the siege maul |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt a broad,
  heavily armored upper body in the brass armor color (bronze on its
  underside and in the shadowed seams) with a head set on top around
  `y = 60`, standing above the hips (from about `y = 28` up). Set the
  **solar-amber core** into the middle of
  the chest. It must have **two clear, blocky shoulders**. On the **left**
  shoulder, sculpt a **full bent arm** (upper arm, forearm) that braces a **broad
  tower shield** across the front of the body: a wide, tall slab of brass and
  bronze plating with an iron rim, facing **forward (+z)**. The **left arm and its
  shield are part of the torso** and do not move — but the arm must be **visibly
  present** holding the shield, not a shield stuck flat to the chest. Keep the
  right shoulder and the two hips fleshed out where the maul arm and the legs mount
  so the children have something to seat against.
- **`leg_left`** attaches under the left hip at **`[18, 28, 24]`**. Sculpt a
  thick, armored leg in brass and bronze with an iron hip and knee joint,
  reaching down to the ground and planted beneath the hip. It meets the torso
  at the mount with no
  gap.
- **`leg_right`** attaches under the right hip at **`[38, 28, 24]`**, a mirror of
  the left leg.
- **`weapon`** attaches at the **right shoulder** at **`[40, 44, 26]`**.
  Sculpt a **full right arm** — a blocky upper arm and forearm with an iron
  elbow, ending in a **fist that grips the haft of a heavy siege maul**: a long
  iron-headed war maul (a great hammer) on a brass haft, held up and ready. The
  whole **arm-and-maul** is one part. It meets the right shoulder at the mount
  with no gap, and is shaped
  so the entire arm-and-maul assembly can swing up over the head and down in a
  smash about a horizontal shoulder hinge.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  **right** shoulder hinge at pivot **`[40, 44, 26]`**, driven by the **caller**
  (the game). Its range is **`min = -0.5` (maul swung down and forward to
  strike) to `max = 1.1` (maul raised high overhead)**, resting at **`0.2`**
  (maul held up and ready). Driving it must **swing the whole right arm-and-maul
  as one solid piece up over the head and down**, so the mech can wind up and
  smash. Only the weapon moves on this joint; no voxel of it should tear away
  from the shoulder or clip into the torso as it swings.

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the legs walk without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[18, 28, 24]`**,
  `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[38, 28, 24]`**, driven in the
  opposite phase so the mech walks in a natural gait.

Sculpt each leg so it rotates plausibly forward and back about its hip mount
without detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle head turn, or making the left shield arm its own part), but
you must **not drop or contradict** the required parts, the required caller
`weapon_pitch` joint, or the two auto stride joints — and the finished mech must
clearly have **two arms**, a shield on the left and the maul on the right.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the armored torso, head, shoulders, and the left shield arm, then each leg, then
the right maul arm, checking each part's preview as you go. Define the parts,
pivots, the caller `weapon_pitch` joint, and the two auto stride joints through
the tool's rig subcommands (the required parts and joints are already pre-seeded
in `rig.json`, but confirm they match this brief and adjust pivots to your
sculpt).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
