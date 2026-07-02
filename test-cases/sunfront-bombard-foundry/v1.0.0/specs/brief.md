# Sunfront Bombard Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bombard Foundry**, a heavy
mortar-works with a swinging overhead crane arm and a bobbing loading piston,
as a **3D voxel model** with a small **rig** a game can pose at runtime. There is
no
target model to copy: build something that reads unmistakably as this working
foundry building and runs correctly from the description below.

## The volume and coordinate system

- The volume is **60 wide (x) x 68 tall (y) x 60 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the works, `0`-`59`. **y** runs up, `0` (bottom, the ground)
  to `67` (top). **z** runs front-to-back, `0`-`59`.
- **Forward is +z:** the crane arm reaches out and the piston flank face toward
  `z = 59` (the front). Up is +y.
- Build the works **symmetric about the lengthwise vertical centerplane between
  `x = 29` and `x = 30`** where the form allows.
- The foundry is deliberately **heavy and blocky** — a squat masonry mortar-works
  rooted to the ground, filling most of the width and depth at its base.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled works
  (the crane arm already cantilevered off the top, the piston already in the
  flank).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Crane, piston, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the works a clear amber
**energy accent** — a glowing forge-mouth or loading vent at the piston flank —
so the accent reads from multiple angles.

## The parts

The foundry is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished works:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The mortar-works tower and foundation |
| `crane_arm` | `base` | `[30, 52, 30]` | The overhead crane arm |
| `piston` | `base` | `[16, 30, 40]` | The loading piston head |

- **`base`** is the **root** — the fixed mortar-works. Sculpt a heavy, blocky
  masonry works in the brass and bronze plating (bronze on its underside and in
  the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, filling most of the width and depth at the foundation and
  rising most of the height. Set the **solar-amber energy accent** — a forge-mouth
  or loading vent — at the piston flank so it glows. Flesh out the top where the
  crane arm's shoulder mounts and the flank where the piston rides so the children
  have something to seat against.
- **`crane_arm`** attaches at the top of the works at **`[30, 52, 30]`**. Sculpt
  a long iron crane arm cantilevered forward from that shoulder mount, standing
  proud
  over the works, sized to swing fore and aft about the mount without touching the
  base below. It meets the works at its shoulder with no gap.
- **`piston`** attaches to the works' flank at **`[16, 30, 40]`**. Sculpt a heavy
  iron loading-piston head seated in the flank, sized to bob straight down and back
  up within its bay without touching its walls. It meets the flank at its mount
  with no gap.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint the case drives with a looping clip, so the foundry cycles without any
caller. There are **no** caller joints.

- **`crane_swing`** — a **rotation** about the **x** (across) axis, through the
  crane arm's shoulder mount at pivot **`[30, 52, 30]`**, **`drive = "auto"`**.
  Its range is **`min = -0.4` to `max = 0.4`** radians, resting at `0` (level).
  The clip rocks the arm fore and aft about its shoulder, so it swings on its
  own. Sculpt the arm so it swings plausibly about that mount without any voxel
  tearing away or clipping the works.
- **`piston_bob`** — a **translation** along the **y** (up) axis, through the
  piston mount at pivot **`[16, 30, 40]`**, **`drive = "auto"`**. Its range is
  **`min = -6` (bottom of the stroke) to `max = 0` (fully raised, at rest)**,
  resting at `0`. The clip drives the piston straight down and back up in its bay,
  so it bobs on its own. Sculpt the piston so it slides plausibly down and up about
  that mount without any voxel tearing away or clipping the bay walls.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a second piston, a puff vent, or extra pipework), but you must **not
drop or contradict** the required parts or the two auto `crane_swing` and
`piston_bob` joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the works base, then the crane arm, then the piston, checking each part's preview
as you go. Define the parts, pivots, and the two auto `crane_swing` and
`piston_bob` joints through the tool's rig subcommands (the required parts and
joints are already pre-seeded in `rig.json`, but confirm they match this brief and
adjust pivots to your sculpt). Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines,
spheres, and a mirror plane) and the rig subcommands, and `voxel-anim <operation>
--help` for each one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
