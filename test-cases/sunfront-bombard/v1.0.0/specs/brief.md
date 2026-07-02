# Sunfront Bombard — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bombard**, a low tracked siege
mortar with a swiveling turret and a long, high-lobbing barrel, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: build something that reads unmistakably as this tracked artillery
machine and poses correctly from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 44 tall (y) x 80 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the vehicle, `0`-`55`. **y** runs up, `0` (bottom, the
  ground) to `43` (top). **z** runs front-to-back, `0`-`79`.
- **Forward is +z:** the barrel points toward `z = 79` (the front) when the
  turret is at rest. Up is +y.
- Build the vehicle **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** — the two tracks mirror each other, and the turret and
  barrel are centered on it.
- The Bombard is a **tracked** machine — it slides along on its tracks, so it has
  **no legs and no walk motion**. Keep the hull low and long.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  vehicle (the turret already up on the hull, the barrel already out front).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — dark plating, underside, shadow (bronze) | `#7a5527` |
| Tracks, barrel, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Muzzle-glow accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the Bombard a clear
amber **muzzle glow at the mouth of the barrel**, so the accent reads from
multiple angles.

## The parts

The vehicle is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished vehicle:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The tracked hull and its two tracks |
| `turret` | `chassis` | `[28, 22, 36]` | The rotating turret on top |
| `barrel` | `turret` | `[28, 30, 48]` | The long mortar barrel, on the turret front |

- **`chassis`** is the **root** — the fixed base of the vehicle. Sculpt a low,
  boxy hull in the brass hull color (bronze on its underside and in the shadowed
  seams) sitting on the ground (from `y = 0`), running most of the depth. Down
  each side, along the full length, sculpt a **track** in the iron color, standing
  a little taller than the hull floor. Keep the hull top flat around `y = 22` so
  the turret has a mount to rest on.
- **`turret`** attaches to the top-center of the chassis at **`[28, 22, 36]`**.
  Sculpt a compact turret box centered over that mount, sitting from about
  `y = 22` up. It must sit **on** the chassis, meeting it at the mount with no gap
  and no voxel poking down into the hull.
- **`barrel`** attaches to the front of the turret at **`[28, 30, 48]`**. Sculpt
  a long, thick mortar barrel in the iron color projecting **forward (+z)** from
  the turret's front face, centered on the centerplane, with the **solar-amber
  muzzle glow** set into its mouth. It must meet the turret with no gap.

## The required joints

A consuming game drives the rig by joint name. There are **two required caller
joints**:

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  turret's vertical mount at pivot **`[28, 22, 36]`**, driven by the **caller**
  (the game). Its range is a **full half-turn each way**, `min = -π`, `max = +π`,
  resting at `0` (facing straight forward). Driving it must **swing the whole
  turret — and the barrel with it — left and right about that mount**, so the
  vehicle can aim in any direction.
- **`barrel_pitch`** — a **rotation** about the **x** (across) axis, through the
  barrel's mount at pivot **`[28, 30, 48]`**, driven by the **caller**. Its range
  is **`min = -0.2` (a shallow, near-level aim) to `max = 1.0` (a steep high
  lob)**, resting at **`0.4`** (a raised siege elevation). Driving it must
  **elevate and depress the barrel about that horizontal mount** so the mortar can
  lob high — the whole barrel as one solid piece, without any voxel tearing away
  from the turret or clipping into it.

Sculpt the turret and barrel so both motions read correctly: the barrel is a
child of the turret, so it swings with the turret on `turret_yaw` and pitches on
its own `barrel_pitch`, always staying attached.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle idle sway or a recoil animation), but you must **not drop
or contradict** the required parts, the required `turret_yaw` joint, or the
required `barrel_pitch` joint.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hull and its tracks, then the turret, then the barrel, checking each part's
preview as you go. Define the parts, pivots, and the two caller joints through the
tool's rig subcommands (the required parts and joints are already pre-seeded in
`rig.json`, but confirm they match this brief and adjust pivots to your sculpt).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
