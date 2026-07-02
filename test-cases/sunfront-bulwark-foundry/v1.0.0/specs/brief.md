# Sunfront Bulwark Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark Foundry**, a heavy armored
bunker-forge with a raising blast door and a turning drive flywheel, as a **3D
voxel model** with a small **rig** that animates on its own. There is no target
model to copy: build something that reads unmistakably as this fortified forge
and animates correctly from the description below.

## The volume and coordinate system

- The volume is **60 wide (x) x 72 tall (y) x 60 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the building, `0`-`59`. **y** runs up, `0` (bottom, the
  ground) to `71` (top). **z** runs front-to-back, `0`-`59`.
- **Forward is +z:** the blast door faces toward `z = 59` (the front). Up is +y.
- Build the foundry as a **squat, heavy, fortified block** — a thick-walled
  bunker, wider and deeper than it is tall, that fills most of the width and
  depth and sits flat on the ground from `y = 0`.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  building (the door already set into the front wall, the flywheel already on
  the flank).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Plating — primary armor (brass) | `#c69a4b` |
| Plating — dark armor, underside, shadow (bronze) | `#7a5527` |
| Masonry — secondary walls, trim (sandstone) | `#d9c48c` |
| Mechanisms — door, flywheel, fittings (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Forge glow accent (solar amber) | `#ff9d2e` |
| Molten core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the foundry a clear
amber **forge glow** — a molten seam behind the blast door and a hot core in the
building — so the accent reads from multiple angles.

## The parts

The foundry is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished building:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The armored bunker-forge building |
| `blast_door` | `base` | `[30, 24, 58]` | The raising front blast door |
| `flywheel` | `base` | `[46, 44, 24]` | The turning drive flywheel |

- **`base`** is the **root** — the fixed body of the foundry. Sculpt a squat,
  thick-walled fortified block in the brass armor color (bronze on its underside
  and shadowed seams, sandstone masonry for secondary walls and trim), sitting on
  the ground and filling most of the width and depth. At the front, frame a broad
  **door opening** for the blast door, with a molten **solar-amber forge glow**
  showing behind it. On the right flank, build an **axle housing** for the
  flywheel to seat against. Keep the front frame and the flank housing fleshed
  out so the children have something to mount to.
- **`blast_door`** attaches at the front door frame at **`[30, 24, 58]`**. Sculpt
  a broad, heavy slab door in the iron color filling the front opening, centered
  on the centerplane, meeting its frame with no gap. Shape it so it can slide
  **straight up and down** within the frame like a portcullis.
- **`flywheel`** attaches to the right-flank axle at **`[46, 44, 24]`**. Sculpt
  a large, round drive wheel in the iron color — a rim with spokes to a hub —
  standing upright on the flank so its face is visible from the side, centered on
  its axle at the mount with no gap. Shape it so it can turn about that axle.

## The required joints

This foundry has **no caller controls** — both moving parts **animate on their
own** through **auto**-driven joints the case drives with looping clips:

- **`blast_door_raise`** — a **translation** along the **y** (up) axis, through
  the door mount at pivot **`[30, 24, 58]`**, **`drive = "auto"`**. Its range is
  **`min = 0` (shut, at rest) to `max = 14` (fully raised)**, resting at `0`. It
  lifts the whole door straight up and drops it back down, so the door opens and
  closes on its own. No voxel of the door should tear away or leave its frame as
  it travels.
- **`flywheel_spin`** — a **rotation** about the **z** (front-to-back) axis,
  through the axle pivot **`[46, 44, 24]`**, **`drive = "auto"`**. Its range is
  a full turn each way, `min = -π`, `max = +π`, resting at `0`. It turns the whole
  wheel steadily about its axle. No voxel of the wheel should tear away from the
  hub or clip into the base as it turns.

Sculpt each part so it moves plausibly about its mount without detaching from the
base.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a venting stack, a smaller gear, or a subtle glow flicker), but you
must **not drop or contradict** the required parts or the two auto joints
`blast_door_raise` and `flywheel_spin`.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` —
finish the armored base and its door frame and axle housing, then the blast door,
then the flywheel, checking each part's preview as you go. Define the parts,
pivots, and the two auto joints through the tool's rig subcommands (the required
parts and joints are already pre-seeded in `rig.json`, but confirm they match
this brief and adjust pivots to your sculpt). Run `voxel-anim --help` for the
available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim`
once per operation and read `parts/<part>.png` between calls to judge each part
against this brief.
