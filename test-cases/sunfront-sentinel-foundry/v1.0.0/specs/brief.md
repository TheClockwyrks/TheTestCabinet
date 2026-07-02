# Sunfront Sentinel Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Sentinel Foundry**, a tall assembly
tower with a hammering stamping press and a turning drive gear, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: build something that reads unmistakably as this working foundry building
and runs correctly from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 72 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the tower, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `71` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the gear-bearing flank and press throat face toward
  `z = 55` (the front). Up is +y.
- Build the tower **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** where the form allows, with the press centered in its
  throat.
- The foundry is deliberately **tall and blocky** — a heavy masonry assembly
  tower rooted to the ground, filling most of the width and depth at its base.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  tower (the press already up in its throat, the gear already on the flank).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Press, gear, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the foundry a clear amber
**energy accent** — a glowing forge-mouth or vent at the press throat — so the
accent reads from multiple angles.

## The parts

The foundry is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished tower:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The foundry tower and its foundation |
| `piston` | `base` | `[28, 50, 28]` | The stamping press head |
| `gear` | `base` | `[42, 40, 20]` | The drive gear on the flank |

- **`base`** is the **root** — the fixed foundry tower. Sculpt a tall, blocky
  masonry tower in the brass and bronze plating (bronze on its underside and in
  the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, filling most of the width and depth at the foundation and
  rising most of the height. Open a **throat** up its center for the press to
  hammer in, and set the **solar-amber energy accent** — a forge-mouth or vent —
  at the throat so it glows. Flesh out the flank where the gear mounts and the
  throat walls where the press rides so the children have something to seat
  against.
- **`piston`** attaches in the tower's throat at **`[28, 50, 28]`**. Sculpt a
  heavy iron stamping-press head centered in the throat, sitting up near the top
  of the tower, sized to hammer straight down and back up within the throat
  without touching its walls. It meets the throat at its mount with no gap.
- **`gear`** attaches to the tower's flank at **`[42, 40, 20]`**. Sculpt a
  toothed iron drive gear (a disc with teeth around its rim) centered on that hub,
  standing proud of the flank so its teeth read, meeting the tower at the hub with
  no gap. Shape it so it turns cleanly about its hub.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint the case drives with a looping clip, so the foundry cycles without any
caller. There are **no** caller joints.

- **`piston_stamp`** — a **translation** along the **y** (up) axis, through the
  press mount at pivot **`[28, 50, 28]`**, **`drive = "auto"`**. Its range is
  **`min = -8` (bottom of the stamp) to `max = 0` (fully raised, at rest)**,
  resting at `0`. The clip drives the press straight down and back up in its
  throat, so it hammers on its own. Sculpt the press so it slides plausibly down
  and up about that mount without any voxel tearing away or clipping the throat
  walls.
- **`gear_spin`** — a **rotation** about the **z** (front-to-back) axis, through
  the gear hub at pivot **`[42, 40, 20]`**, **`drive = "auto"`**. Its range is a
  full turn, `min = -π`, `max = +π`, resting at `0`. The clip turns the gear a
  full revolution and loops, so it spins on its own. Sculpt the gear so it rotates
  plausibly about its hub without any voxel tearing away from the flank.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a second gear, a puff vent, or extra pipework), but you must **not
drop or contradict** the required parts or the two auto `piston_stamp` and
`gear_spin` joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the tower base and its throat, then the press, then the gear, checking each part's
preview as you go. Define the parts, pivots, and the two auto `piston_stamp` and
`gear_spin` joints through the tool's rig subcommands (the required parts and
joints are already pre-seeded in `rig.json`, but confirm they match this brief and
adjust pivots to your sculpt). Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
