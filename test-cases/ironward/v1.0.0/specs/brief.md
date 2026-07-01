# Ironward Siege Tank — sculpting and rigging brief

You are sculpting and rigging the **Ironward Siege Tank**, a heavy tracked tank
with a swiveling turret, as a **3D voxel model** with a small **rig** a game can
pose at runtime. There is no target model to copy: build something that reads
unmistakably as this tank and poses correctly from the description below.

## The volume and coordinate system

- The volume is **60 wide (x) x 40 tall (y) x 80 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the tank, `0`-`59`. **y** runs up, `0` (bottom, the ground)
  to `39` (top). **z** runs front-to-back, `0`-`79`.
- **Forward is +z:** the gun points toward `z = 79` (the front) when the turret
  is at rest. Up is +y.
- Build the tank **symmetric about the lengthwise vertical centerplane between
  `x = 29` and `x = 30`** — the two tracks mirror each other, and the turret and
  barrel are centered on it.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled tank.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull (olive) | `#5d6b3a` |
| Underside (dark olive) | `#3b4526` |
| Tracks (dark) | `#2a2c2e` |
| Barrel & fittings (gunmetal) | `#6b7078` |
| Accent (warm) | `#b5502a` |

## The parts

The tank is a **rig** of three required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished tank:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The tank body and its two tracks |
| `turret` | `chassis` | `[30, 20, 40]` | The rotating turret on top |
| `barrel` | `turret` | `[30, 28, 50]` | The main gun, on the turret front |

- **`chassis`** is the **root** — the fixed base of the tank. Sculpt a low, boxy
  hull in the olive hull color (dark olive on its underside) sitting on the ground
  (from `y = 0`), running most of the depth. Down each side, along the full length,
  sculpt a **track** in the track color, standing a little taller than the hull
  floor. Keep the hull top flat around `y = 20` so the turret has a mount to rest
  on.
- **`turret`** attaches to the top-center of the chassis at **`[30, 20, 40]`**.
  Sculpt a compact turret box (a hatch or cupola in the accent color reads well)
  centered over that mount, sitting from about `y = 20` up. It must sit **on** the
  chassis, meeting it at the mount with no gap and no voxel poking down into the
  hull.
- **`barrel`** attaches to the front of the turret at **`[30, 28, 50]`**. Sculpt
  a long, straight gun barrel in the gunmetal color projecting **forward (+z)**
  from the turret's front face, centered on the centerplane. It must meet the
  turret with no gap.

## The required joint

A consuming game drives the rig by joint name. The **required** joint is:

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the turret's
  vertical mount at pivot **`[30, 20, 40]`**, driven by the **caller** (the game).
  Its range is a **full half-turn each way**, `min = -π`, `max = +π`, resting at
  `0` (facing straight forward). Driving it must **swing the whole turret — and
  the barrel with it — left and right about that mount**, so the tank can aim in
  any direction. Sculpt the turret so it rotates plausibly about that vertical axis:
  no voxel of the turret should tear away from the mount or clip into the hull as
  it turns.

Design the turret and barrel so this motion reads correctly: the barrel is a child
of the turret, so it swings along with it and always stays attached.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example an optional caller joint **`barrel_pitch`** — a rotation about the
**x** axis through the barrel's mount that elevates and depresses the gun — or a
subtle idle motion), but you must **not drop or contradict** the required parts
and the required `turret_yaw` joint.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the chassis and its tracks, then the turret, then the barrel, checking each
part's preview as you go. Define the parts, pivots, and the `turret_yaw` joint
through the
tool's rig subcommands (the required parts and joint are already pre-seeded in
`rig.json`, but confirm they match this brief and adjust pivots to your sculpt).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
