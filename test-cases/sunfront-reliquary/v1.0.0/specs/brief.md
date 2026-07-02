# Sunfront Reliquary — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Reliquary**, a tall, precious
monument that cradles a glowing solar core, encircled by a turning orbital ring
and crowned by counter-rotating guardian fins, as a **3D voxel model** with a
small **rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this revered, holy monument and runs
correctly from the description below.

## The volume and coordinate system

- The volume is **60 wide (x) x 96 tall (y) x 60 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the monument, `0`-`59`. **y** runs up, `0` (bottom, the
  ground) to `95` (top). **z** runs front-to-back, `0`-`59`.
- **Forward is +z:** the face of the plinth and the open front of the core cradle
  face toward `z = 59` (the front). Up is +y.
- Build the monument **symmetric about the lengthwise vertical centerplane between
  `x = 29` and `x = 30`** where the form allows, with the core, ring, and fins
  centered on that axis.
- The reliquary is deliberately **tall and reverent** — a heavy masonry plinth
  rooted to the ground rising into a cradle that holds the glowing core aloft, so
  the whole form reads as precious and holy.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  monument (the core already cradled at its heart, the ring already encircling it,
  the fins already crowning it).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Ring, fins, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Core glow highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the reliquary a heavy,
clear amber **energy accent** with a **solar-hot** highlight at the core — a
brilliant, glowing solar core at its heart — so the accent reads as precious from
multiple angles.

## The parts

The reliquary is a **rig** of four required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished monument:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The monument plinth and core cradle |
| `orbital_ring` | `base` | `[30, 60, 30]` | The ring encircling the core |
| `core` | `base` | `[30, 56, 30]` | The glowing solar core |
| `guardian_fins` | `base` | `[30, 78, 30]` | The crowning guardian fins |

- **`base`** is the **root** — the fixed monument. Sculpt a tall, blocky masonry
  plinth in the brass and bronze plating (bronze on its underside and in the
  shadowed seams, sandstone panels for lighter structure) sitting on the ground
  from `y = 0`, filling most of the width and depth at the foundation and rising
  into a cradle that holds the core aloft near mid-height. Open the cradle around
  the core's mount so the core reads as enshrined, and flesh out the structure
  where the ring encircles it and where the fins crown it so the children have
  something to seat against.
- **`core`** attaches at the heart of the cradle at **`[30, 56, 30]`**. Sculpt a
  bright, glowing solar core — a rounded mass built up in the **solar-amber** and
  **solar-hot** accents so it reads as precious and radiant, cradled in the
  monument with no gap, and sized to rise and settle within its cradle without
  touching its walls.
- **`orbital_ring`** attaches encircling the core at **`[30, 60, 30]`**. Sculpt
  a toothless iron ring (a horizontal band centered on that pivot) standing proud
  around the core so it reads as an orbiting halo, centered on the vertical axis
  so it turns cleanly about its center.
- **`guardian_fins`** attach at the crown at **`[30, 78, 30]`**. Sculpt a set of
  iron guardian fins (blades radiating outward from that hub above the core)
  centered on the vertical axis so they turn cleanly about their hub, standing
  proud above the core so they read as a protective crown.

## The required joints

All three animated elements **run on their own** — each carries an
**auto**-driven joint the case drives with a looping clip, so the monument cycles
without any caller. There are **no** caller joints.

- **`ring_spin`** — a **rotation** about the **y** (up) axis, through the ring's
  center at pivot **`[30, 60, 30]`**, **`drive = "auto"`**. Its range is a full
  turn, `min = -π`, `max = +π`, resting at `0`. The clip turns the ring a full
  revolution and loops, so it orbits on its own. Sculpt the ring so it rotates
  plausibly about its center without any voxel tearing away.
- **`core_pulse`** — a **translation** along the **y** (up) axis, through the core
  mount at pivot **`[30, 56, 30]`**, **`drive = "auto"`**. Its range is
  **`min = 0` (settled, at rest) to `max = 6` (top of the rise)**, resting at `0`.
  The clip lifts the core up and settles it back in a slow breathing pulse, so it
  rises and falls on its own. Sculpt the core so it slides plausibly up and down
  about that mount without any voxel tearing away or clipping the cradle walls.
- **`fins_spin`** — a **rotation** about the **y** (up) axis, through the fins'
  hub at pivot **`[30, 78, 30]`**, **`drive = "auto"`**. Its range is a full turn,
  `min = -π`, `max = +π`, resting at `0`. The clip turns the fins a full
  revolution and loops in the **opposite direction to the ring**, so they
  counter-rotate on their own. Sculpt the fins so they rotate plausibly about
  their hub without any voxel tearing away.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a second inner ring, glinting facets, or extra masonry buttresses),
but you must **not drop or contradict** the required parts or the three auto
`ring_spin`, `core_pulse`, and `fins_spin` joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the plinth and its cradle, then the core, then the ring, then the fins, checking
each part's preview as you go. Define the parts, pivots, and the three auto
`ring_spin`, `core_pulse`, and `fins_spin` joints through the tool's rig
subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt). Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
