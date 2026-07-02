# Sunfront Scarab Hatchery — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Scarab Hatchery**, a squat, wide
hive-mound clustered with hatch cells, as a **3D voxel model** with a small
**rig** that animates on its own at runtime. There is no target model to copy:
build something that reads unmistakably as this hive-mound building and animates
correctly from the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 40 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mound, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `39` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the front face of the mound is toward `z = 55`. Up is +y.
- Build the mound **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** — the hatch and vent are centered on it and the hatch
  cells mirror across it.
- The hatchery is deliberately **squat and wide** — a low, broad hive-mound that
  hugs the ground, not a tall tower. It fills most of the length and width and
  rises only partway up the volume.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  building (the hatch already up on the crown, the vent already set into the side).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Mechanisms, hatch ring, vent louvers (iron) | `#565c64` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the hatchery a clear
amber glow in the **hatch cells** clustered across the mound (with solar-hot at
the brightest points), so the accent reads from multiple angles.

## The parts

The hatchery is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished building:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The hive-mound foundation and shell |
| `hatch` | `base` | `[28, 20, 40]` | The central iris hatch on the crown |
| `vent` | `base` | `[28, 10, 16]` | The side exhaust vent |

- **`base`** is the **root** — the fixed foundation of the building. Sculpt a low,
  wide domed hive-mound in the brass masonry color (bronze on its underside and
  in the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, running most of the depth and width. Cluster **hatch
  cells** across its surface — recessed cells with a **solar-amber** glow
  (solar-hot at the brightest points) — so it reads as a living hive. Flatten
  the crown around
  `y = 20` so the hatch has a mount to sit on, and flesh out the side around
  `[28, 10, 16]` so the vent has something to seat against.
- **`hatch`** attaches to the crown of the mound at **`[28, 20, 40]`**. Sculpt a
  round iris hatch — an iron ring with amber-glowing segments — centered over that
  mount, sitting from about `y = 20` up. It must sit **on** the base, meeting it
  at the mount with no gap and no voxel poking down into the mound.
- **`vent`** attaches to the side of the mound at **`[28, 10, 16]`**. Sculpt a
  low exhaust vent — iron louvers over an amber glow — set into the mound's side,
  centered on the centerplane and meeting the base at the mount with no gap. Shape
  it so it can rise straight up and settle back without detaching.

## The required joints

Both animated elements **move on their own** — each carries an **auto**-driven
joint the case drives with a looping clip, so the hatchery cycles without any
caller. There are **no** caller-driven joints on this building.

- **`hatch_turn`** — a **rotation** about the **y** (up) axis, through the hatch's
  vertical mount at pivot **`[28, 20, 40]`**, **`drive = "auto"`**. Its range is
  a **full half-turn each way**, `min = -π`, `max = +π`, resting at `0`. Its clip
  sweeps the hatch smoothly through a full turn each cycle, like a slowly rotating
  iris. Sculpt the hatch so it rotates plausibly about that vertical axis: no voxel
  should tear away from the mount or clip into the mound as it turns.
- **`vent_bob`** — a **translation** along the **y** (up) axis, through the vent's
  mount at pivot **`[28, 10, 16]`**, **`drive = "auto"`**. Its range is `min = 0`
  (fully seated, at rest) to `max = 6` voxels up, resting at `0`. Its clip lifts
  the vent up then settles it back each cycle. Sculpt the vent so it slides
  straight up and down about its mount without detaching from the base.

Sculpt each sub-part so it moves plausibly about its mount and always stays
attached to the base.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example subtle steam plumes, or extra detail hatch cells), but you must **not
drop or contradict** the required parts or the two required auto joints
`hatch_turn` and `vent_bob`.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hive-mound base and its hatch cells, then the iris hatch, then the vent,
checking each part's preview as you go. Define the parts, pivots, and the two auto
joints through the tool's rig subcommands (the required parts and joints are
already pre-seeded in `rig.json`, but confirm they match this brief and adjust
pivots to your sculpt). Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines,
spheres, and a mirror plane) and the rig subcommands, and `voxel-anim <operation>
--help` for each one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
