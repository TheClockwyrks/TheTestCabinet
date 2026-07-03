# Sunfront Flak Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Flak Foundry**, a tall works crowned
with a sweeping radar dish and carrying a bobbing piston, as a **3D voxel model**
with a small **rig** a game can pose at runtime. There is no target model to copy:
build something that reads unmistakably as this working foundry building and runs
correctly from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 76 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the works, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `75` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the piston-bearing flank faces toward `z = 55` (the front).
  Up is +y.
- Build the works **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** where the form allows, with the radar dish crowning the
  center of the top.
- The foundry is deliberately **tall and blocky** — a heavy masonry works rooted
  to the ground, filling most of the width and depth at its base.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  works (the dish already up on its mast, the piston already on the flank).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Dish, piston, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the works a clear amber
**energy accent** — a glowing lamp at the dish hub or a piston-mount vent — so
the accent reads from multiple angles.

## The parts

The foundry is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished works:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The foundry works and its foundation |
| `dish` | `base` | `[28, 64, 28]` | The radar dish crowning the works |
| `piston` | `base` | `[40, 34, 24]` | The charging piston on the flank |

- **`base`** is the **root** — the fixed foundry works. Sculpt a tall, blocky
  masonry structure in the brass and bronze plating (bronze on its underside and
  in the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, filling most of the width and depth at the foundation and
  rising most of the height. Raise a short central **mast** at its crown for the
  dish to sit on, and flesh out the flank where the piston mounts so the children
  have something to seat against. Set the **solar-amber energy accent** — a lamp
  or vent — where it reads.
- **`dish`** attaches to the mast at the crown at **`[28, 64, 28]`**. Sculpt a
  broad radar dish (a shallow bowl on a hub) centered over that mast near the top
  of the works, sized to sweep clear around its vertical axis without striking the
  works below. It meets the mast at its mount with no gap.
- **`piston`** attaches to the works' flank at **`[40, 34, 24]`**. Sculpt a heavy
  iron charging piston (a cylinder or ram head on a shaft) seated against the
  flank, standing proud so it reads, sized to bob straight down and back up
  without touching the works. It meets the flank at its mount with no gap.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint moved by a looping decorative animation you author (see below), so the
foundry cycles without any caller. There are **no** caller joints.

- **`dish_sweep`** — a **rotation** about the **y** (up) axis, through the dish
  mast at pivot **`[28, 64, 28]`**, **`drive = "auto"`**. Its range is a full
  turn, `min = -π`, `max = +π`, resting at `0`. Sculpt the dish so it rotates
  plausibly about that mast without any voxel tearing away or striking the works
  below.
- **`piston_bob`** — a **translation** along the **y** (up) axis, through the
  piston mount at pivot **`[40, 34, 24]`**, **`drive = "auto"`**. Its range is
  **`min = -5` (bottom of the bob) to `max = 0` (fully raised, at rest)**, resting
  at `0`. Sculpt the piston so it slides plausibly down and up about that mount
  without any voxel tearing away from the flank.

## The required animations

You must **author the motion** of each required animation yourself, as **F-curves**,
with the `voxel-anim` animation subcommands — `define-animation` to declare it,
then
`add-keyframe` to lay in each keyframe (see `voxel-anim --help`). The case does
**not** ship the keyframes: it declares each animation's identity and intent, and
**you** produce the curves. Each is a decorative **auto-play** idle
(`auto_play =
true`, `loop = true`) — it plays continuously on its own with no caller — and drives
its single joint. Give the motion weight with per-keyframe interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` Bézier tangents); the elements should move with an
eased, deliberate cadence, never a mechanical linear slide.

- **`dish_sweep`** — `period_ms = 3000`. Drive the `dish_sweep` joint one full,
  smooth revolution (about `-π → +π`) across the loop, so the radar dish scans the
  sky steadily and continuously on its own.
- **`piston_bob`** — `period_ms = 1200`. Drive the `piston_bob` joint down from
  `0`
  (fully raised) to `-5` (bottom of the bob) and back up to `0`, with weight into
  the drop and the recovery — the piston pumps straight down and rises again on
  its
  own each loop, with an eased cadence rather than a flat linear ramp.

You **may add** your own extra parts, joints, or auto-play animations on top of
this
(for example a second vent, a spinning fan, or extra pipework), but you must **not
drop or contradict** the required parts, the two auto `dish_sweep` and `piston_bob`
joints, or their two required animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the works base and its mast, then the dish, then the piston, checking each part's
preview as you go. Define the parts, pivots, and the two auto `dish_sweep` and
`piston_bob` joints through the tool's rig subcommands (the required parts, joints,
and animation declarations are already pre-seeded in `rig.json`, but confirm they
match this brief and adjust pivots to your sculpt), then **author each required
animation's F-curves** with `define-animation` and `add-keyframe`. Run `voxel-anim
--help` for the available operations (setting and clearing single voxels, filling
and stroking boxes, 3D lines, spheres, and a mirror plane), the rig subcommands,
and
the animation subcommands, and `voxel-anim <operation> --help` for each one's exact
flags. Call `voxel-anim` once per operation and read `parts/<part>.png` between
calls to judge each part against this brief.
