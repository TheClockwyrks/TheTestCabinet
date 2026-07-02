# Sunfront Scarab — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Scarab**, a low, wide four-legged
war-beetle with snapping front mandibles, as a **3D voxel model** with a small
**rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this scuttling beetle machine and poses
correctly from the description below.

## The volume and coordinate system

- The volume is **48 wide (x) x 28 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the beetle, `0`-`47`. **y** runs up, `0` (bottom, the ground)
  to `27` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the head and mandibles point toward `z = 55` (the front)
  when the jaws are at rest. Up is +y.
- Build the beetle **symmetric about the lengthwise vertical centerplane between
  `x = 23` and `x = 24`** — the two leg banks mirror each other, and the body and
  mandibles are centered on it.
- The beetle is deliberately **low and wide** — a fast, ground-hugging swarm bug,
  not a tall one. It fills most of the length and width, sitting only a little way
  up off the ground.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  beetle (a leg already under its flank, the mandibles already out at the head).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Shell — primary plating (brass) | `#c69a4b` |
| Shell — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, mandibles, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Eye-cluster accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the beetle a clear amber
**eye-cluster on the head**, above and between the mandibles, so the accent reads
from multiple angles.

## The parts

The beetle is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished beetle:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The domed carapace body and head |
| `legs_left` | `body` | `[10, 8, 28]` | The left bank of legs |
| `legs_right` | `body` | `[38, 8, 28]` | The right bank of legs |
| `mandibles` | `body` | `[24, 8, 50]` | The snapping front jaws |

- **`body`** is the **root** — the fixed core of the beetle. Sculpt a low, wide
  domed carapace in the brass shell color (bronze on its underside and in the
  shadowed seams) sitting a little off the ground, running most of the depth and
  width. At the front (`z` toward `55`) shape a head, and set the **solar-amber
  eye-cluster** into it above the jaw line. Keep the flanks and head fleshed out
  where the legs and mandibles mount so the children have something to seat
  against.
- **`legs_left`** attaches to the left flank at **`[10, 8, 28]`**. Sculpt a bank
  of legs in the iron color — two or three splayed, jointed legs reaching down and
  out to the ground from a shared low mount, positioned under the left side of the
  body. They sit **below and against** the body with no gap at the mount.
- **`legs_right`** attaches to the right flank at **`[38, 8, 28]`**, a mirror of
  the left bank in the same iron color.
- **`mandibles`** attaches to the head at **`[24, 8, 50]`**. Sculpt a pair of
  curved, pointed jaws in the iron color projecting **forward (+z)** from the head,
  centered on the centerplane and meeting the head at the mount with no gap. Shape
  them so they can swing open and shut about a horizontal hinge across the head.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`mandibles_snap`** — a **rotation** about the **x** (across) axis, through the
  jaw hinge at pivot **`[24, 8, 50]`**, driven by the **caller** (the game). Its
  range is **`min = 0` (fully closed, at rest) to `max = 0.9` (widest gape)**,
  resting at `0`. Driving it must **swing the mandibles open and shut about that
  hinge** — the whole jaw assembly as one solid piece — so the beetle can bite.
  Only the mandibles move on this joint; no voxel of them should tear away from
  the head or clip into the body as they open.

The two leg banks **animate on their own** — each carries an **auto**-driven
scuttle joint the case drives with a looping clip, so the legs skitter without the
caller:

- **`legs_left_scuttle`** — a **rotation** about **x** through **`[10, 8, 28]`**,
  `min = -0.6`, `max = 0.6`, rest `0`, **`drive = "auto"`**.
- **`legs_right_scuttle`** — the same about **`[38, 8, 28]`**, driven in the
  opposite phase so the beetle scuttles in a natural gait.

Sculpt each leg bank so it rotates plausibly forward and back about its mount
without detaching from the body.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle antenna twitch, or extra detail legs), but you must **not
drop or contradict** the required parts, the required caller `mandibles_snap`
joint, or the two auto scuttle joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the carapace body and head, then each leg bank, then the mandibles, checking each
part's preview as you go. Define the parts, pivots, the caller `mandibles_snap`
joint, and the two auto scuttle joints through the tool's rig subcommands (the
required parts and joints are already pre-seeded in `rig.json`, but confirm they
match this brief and adjust pivots to your sculpt). Run `voxel-anim --help` for
the available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` between calls to judge each part against
this brief.
