# Sunfront Bombard — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bombard**, a four-legged siege mortar
walker with a swiveling turret and a long, high-lobbing barrel, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: build something that reads unmistakably as this striding artillery walker
and poses correctly from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 52 tall (y) x 80 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the walker, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `51` (top). **z** runs front-to-back, `0`-`79`.
- **Forward is +z:** the walker faces toward `z = 79` (the front), and the barrel
  points that way when the turret is at rest. Up is +y.
- Build the walker **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** — the two leg groups mirror each other, and the body,
  turret, and barrel are centered on it.
- The Bombard is a **four-legged walker** — it strides on four legs, so it stands
  raised off the ground with clearance under the hull. Keep the hull low and long
  and the legs splayed out to carry it.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  walker (a leg already under its flank, the turret already up on the hull, the
  barrel already out front of the turret).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrel, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Muzzle-glow accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the Bombard a clear amber
**muzzle glow at the mouth of the barrel**, so the accent reads from multiple
angles.

## The parts

The walker is a **rig** of five required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished walker:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored hull |
| `legs_left` | `body` | `[13, 14, 40]` | The left group of legs |
| `legs_right` | `body` | `[43, 14, 40]` | The right group of legs |
| `turret` | `body` | `[28, 30, 44]` | The rotating turret on top |
| `barrel` | `turret` | `[28, 38, 56]` | The long mortar barrel, on the turret front |

- **`body`** is the **root** — the fixed core of the walker. Sculpt a low, boxy
  hull in the brass hull color (bronze on its underside and in the shadowed seams)
  sitting up off the ground on the legs, running most of the depth and width. Keep
  its top flat around `y = 30` so the turret has a mount to rest on, and keep the
  flanks solid where the legs mount.
- **`legs_left`** attaches to the left flank at **`[13, 14, 40]`**. Sculpt a group
  of legs in the iron color — a front and a rear leg, splayed and jointed, reaching
  down and out to the ground from a shared low mount, positioned under the left
  side of the body. They sit **below and against** the body with no gap at the
  mount.
- **`legs_right`** attaches to the right flank at **`[43, 14, 40]`**, a mirror of
  the left group in the same iron color.
- **`turret`** attaches to the top-center of the body at **`[28, 30, 44]`**.
  Sculpt a compact turret box centered over that mount, sitting from about
  `y = 30` up. It must sit **on** the body, meeting it at the mount with no gap
  and no voxel poking down into the hull.
- **`barrel`** attaches to the front of the turret at **`[28, 38, 56]`**. Sculpt
  a long, thick mortar barrel in the iron color projecting **forward (+z)** from
  the turret's front face, centered on the centerplane, with the **solar-amber
  muzzle glow** set into its mouth. It must meet the turret with no gap. Shape it
  so it elevates up about a horizontal hinge across the turret.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joints are:

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the turret's
  vertical mount at pivot **`[28, 30, 44]`**, driven by the **caller** (the game).
  Its range is a **full half-turn each way**, `min = -π`, `max = +π`, resting at
  `0` (facing straight forward). Driving it must **swing the whole turret — and
  the barrel with it — left and right about that mount**, so the walker can aim
  in any direction.
- **`barrel_pitch`** — a **rotation** about the **x** (across) axis, through the
  barrel's mount at pivot **`[28, 38, 56]`**, driven by the **caller**. Its range
  is **`min = -0.2` (a shallow, near-level aim) to `max = 1.0` (a steep high
  lob)**, resting at **`0.4`** (a raised siege elevation). Driving it must
  **elevate and depress the barrel about that horizontal mount** so the mortar can
  lob high — the whole barrel as one solid piece, without any voxel tearing away
  from the turret or clipping into it.

The two leg groups **animate on their own** — each carries an **auto**-driven
scuttle joint the case drives with a looping clip, so the legs skitter without the
caller:

- **`legs_left_scuttle`** — a **rotation** about **x** through **`[13, 14, 40]`**,
  `min = -0.6`, `max = 0.6`, rest `0`, **`drive = "auto"`**.
- **`legs_right_scuttle`** — the same about **`[43, 14, 40]`**, driven in the
  opposite phase so the walker scuttles in a natural gait.

Sculpt the turret and barrel so both caller motions read correctly — the barrel
is a child of the turret, so it swings with it on `turret_yaw` and pitches on its
own
`barrel_pitch`, always staying attached — and sculpt each leg group so it rotates
plausibly forward and back about its mount without detaching from the body.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example an ammo feed, spent-casing chutes, or extra detail legs), but you must
**not drop or contradict** the required parts, the required caller `turret_yaw`
and `barrel_pitch` joints, or the two auto scuttle joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hull, then each leg group, then the turret, then the barrel, checking each
part's preview as you go. Define the parts, pivots, the caller `turret_yaw` and
`barrel_pitch` joints, and the two auto scuttle joints through the tool's rig
subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt). Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
