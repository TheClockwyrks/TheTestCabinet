# Sunfront Flakhound — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Flakhound**, a four-legged anti-air
walker with a traversing back turret and twin elevating flak barrels, as a **3D
voxel model** with a small **rig** a game can pose at runtime. There is no target
model to copy: build something that reads unmistakably as this striding flak
platform and poses correctly from the description below.

## The volume and coordinate system

- The volume is **52 wide (x) x 48 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the walker, `0`-`51`. **y** runs up, `0` (bottom, the ground)
  to `47` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the walker faces toward `z = 55` (the front), and the barrels
  point that way when the turret is at rest. Up is +y.
- Build the walker **symmetric about the lengthwise vertical centerplane between
  `x = 25` and `x = 26`** — the two leg banks mirror each other, and the body,
  turret, and barrels are centered on it.
- The walker is a squat, sturdy striding platform: a compact armored body carried
  on four legs, with the turret raised on its back so the barrels clear the body.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  walker (a leg already under its flank, the turret already up on the back, the
  barrels already out front of the turret).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Body — primary plating (brass) | `#c69a4b` |
| Body — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, turret, flak barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Targeting-eye accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the walker a clear amber
**targeting eye on the turret**, facing forward between the barrels, so the accent
reads from multiple angles.

## The parts

The walker is a **rig** of five required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished walker:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored body and hull |
| `legs_left` | `body` | `[12, 10, 28]` | The left bank of legs |
| `legs_right` | `body` | `[40, 10, 28]` | The right bank of legs |
| `turret` | `body` | `[26, 30, 28]` | The traversing flak turret |
| `barrel` | `turret` | `[26, 36, 34]` | The twin elevating flak barrels |

- **`body`** is the **root** — the fixed core of the walker. Sculpt a squat,
  armored body in the brass plating color (bronze on its underside and in the
  shadowed seams) sitting up off the ground on the legs, running most of the depth
  and width. Keep its back (around `y = 30`) fleshed out and roughly flat so the
  turret has a mount to sit on, and keep the flanks solid where the legs mount.
- **`legs_left`** attaches to the left flank at **`[12, 10, 28]`**. Sculpt a bank
  of legs in the iron color — two or three splayed, jointed legs reaching down and
  out to the ground from a shared low mount, positioned under the left side of the
  body. They sit **below and against** the body with no gap at the mount.
- **`legs_right`** attaches to the right flank at **`[40, 10, 28]`**, a mirror of
  the left bank in the same iron color.
- **`turret`** attaches to the back of the body at **`[26, 30, 28]`**. Sculpt a
  compact turret box in the iron color centered over that mount, sitting from about
  `y = 30` up, and set the **solar-amber targeting eye** into its front face. It
  must sit **on** the body, meeting it at the mount with no gap and no voxel poking
  down into the hull.
- **`barrel`** attaches to the turret front at **`[26, 36, 34]`**. Sculpt a pair
  of long, straight flak barrels in the iron color projecting **forward (+z)** from
  the turret's front face, centered on the centerplane and meeting the turret with
  no gap. Shape them so they elevate up about a horizontal hinge across the turret.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joints are:

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the turret's
  vertical mount at pivot **`[26, 30, 28]`**, driven by the **caller** (the game).
  Its range is a **full half-turn each way**, `min = -π`, `max = +π`, resting at
  `0` (facing straight forward). Driving it must **swing the whole turret — and
  the barrels with it — about that mount**, so the walker can traverse onto any
  bearing.
- **`barrel_pitch`** — a **rotation** about the **x** (across) axis, through the
  barrel hinge at pivot **`[26, 36, 34]`**, driven by the **caller** (the game).
  Its range is **`min = 0` (level, forward) to `max = 1.3` (steeply skyward)**,
  resting at `0.5` (a raised idle elevation). Driving it must **elevate and
  depress the twin barrels as one solid piece** about that hinge, so the walker
  can aim up at the air.

The two leg banks **animate on their own** — each carries an **auto**-driven
scuttle joint the case drives with a looping clip, so the legs skitter without the
caller:

- **`legs_left_scuttle`** — a **rotation** about **x** through **`[12, 10, 28]`**,
  `min = -0.6`, `max = 0.6`, rest `0`, **`drive = "auto"`**.
- **`legs_right_scuttle`** — the same about **`[40, 10, 28]`**, driven in the
  opposite phase so the walker scuttles in a natural gait.

Sculpt the turret and barrels so this motion reads correctly — the barrels are a
child of the turret, so they swing with it and always stay attached — and sculpt
each leg bank so it rotates plausibly forward and back about its mount without
detaching from the body.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example an ammo feed, spent-casing chutes, or extra detail legs), but you must
**not drop or contradict** the required parts, the required caller `turret_yaw`
and `barrel_pitch` joints, or the two auto scuttle joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the armored body, then each leg bank, then the turret, then the barrels, checking
each part's preview as you go. Define the parts, pivots, the caller `turret_yaw`
and `barrel_pitch` joints, and the two auto scuttle joints through the tool's rig
subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt). Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
