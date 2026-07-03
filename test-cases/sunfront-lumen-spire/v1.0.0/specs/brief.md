# Sunfront Lumen Spire — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lumen Spire**, a slim beacon spire
with a spinning halo ring and a pulsing solar lens, as a **3D voxel model** with
a small **rig** a game can pose at runtime. There is no target model to copy:
build something that reads unmistakably as this beacon spire and runs correctly
from the description below.

## The volume and coordinate system

- The volume is **44 wide (x) x 88 tall (y) x 44 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the spire, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `87` (top). **z** runs front-to-back, `0`-`43`.
- **Forward is +z:** the spire faces toward `z = 43` (the front). Up is +y.
- Build the spire **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** where the form allows, with the halo ring and lens
  centered on the spire's vertical axis.
- The spire is deliberately **slim and tall** — a slender masonry beacon tower
  rooted to the ground, narrow in width and depth, rising most of the height.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  spire (the halo ring already up around the crown, the lens already atop the tip).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Ring, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the spire a **strong**
solar energy accent — a bright solar-hot lens core, with solar-amber glow bleeding
down the halo ring and crown — so the accent reads boldly from multiple angles.

## The parts

The spire is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished spire:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The spire tower and its foundation |
| `halo_ring` | `base` | `[22, 66, 22]` | The halo ring around the crown |
| `lens` | `base` | `[22, 74, 22]` | The solar lens atop the tip |

- **`base`** is the **root** — the fixed spire tower. Sculpt a slim, tall masonry
  spire in the brass and bronze plating (bronze on its underside and in the
  shadowed seams, sandstone panels for lighter structure) sitting on the ground
  from `y = 0`, with a broader footing that tapers up into a narrow shaft rising
  most of the height. Flesh out the crown near `y = 66` where the halo ring
  encircles it, and bring the shaft to a tip near `y = 74` where the lens seats,
  so the children have something to mount against.
- **`halo_ring`** attaches around the spire's crown at **`[22, 66, 22]`**. Sculpt
  an iron ring (an open loop, wider than the shaft) centered on that hub,
  encircling the crown so it stands clear of the shaft and its loop reads,
  meeting the spire at the hub with no gap. Shape it so it turns cleanly about the
  vertical axis.
- **`lens`** attaches atop the spire's tip at **`[22, 74, 22]`**. Sculpt a compact
  solar lens — a bright solar-hot core in an iron housing — centered on that seat,
  sitting above the tip, sized to bob straight up and back down without leaving
  the tip. It meets the spire at its seat with no gap.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint that the required animations (below) drive, so the spire cycles without any
caller. There are **no** caller joints.

- **`halo_ring_spin`** — a **rotation** about the **y** (up) axis, through the
  ring hub at pivot **`[22, 66, 22]`**, **`drive = "auto"`**. Its range is a full
  turn, `min = -π`, `max = +π`, resting at `0`. Sculpt the ring so it rotates
  plausibly about that vertical axis without any voxel tearing away from the crown.
- **`lens_pulse`** — a **translation** along the **y** (up) axis, through the lens
  seat at pivot **`[22, 74, 22]`**, **`drive = "auto"`**. Its range is
  **`min = 0` (seated, at rest) to `max = 4` (top of the pulse)**, resting at `0`.
  Sculpt the lens so it slides plausibly up and down about that seat without any
  voxel tearing away or clipping the tip.

## The required animations

The spire ships **no caller controls** — instead you must **author** two
**decorative, self-playing** animations that make the spire idle on its own. Each
is already declared in the rig as a required animation (name, period, `loop`,
`auto_play`, and the joint it drives); you supply the **motion** — the F-curve
keyframes — with the `voxel-anim` animation subcommands (`define-animation`, then
`add-keyframe`). Author the motion as **F-curves**, not linear slides: choose each
keyframe's interpolation (`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`,
with optional `--out-handle`/`--in-handle` bezier handles) so the motion carries
weight and eases through its extremes rather than sliding at constant speed.

- **`halo_ring_spin`** — `auto_play = true`, `loop = true`, period **2200 ms**,
  driving the `halo_ring_spin` joint. Author a **full, continuous revolution** of
  the ring about the vertical axis over one period (sweeping the joint's `-π..+π`
  range and wrapping seamlessly as it loops). A steady rotation reads best with
  `linear` interpolation so the spin never stalls at the wrap.
- **`lens_pulse`** — `auto_play = true`, `loop = true`, period **1500 ms**,
  driving the `lens_pulse` joint. Author a **rise-and-settle bob**: the lens eases
  up off its seat to the top of its range and eases back down within one period,
  landing softly. Use eased interpolation (e.g. `ease-out` up, `ease-in` back to
  the seat) so the lens hangs at the top and settles with weight rather than
  bouncing linearly.

You **may add** your own extra parts, joints, or auto-play animations on top of
this (for example a second ring, a light halo, or extra finials), but you must
**not drop or contradict** the required parts, the two auto `halo_ring_spin` and
`lens_pulse` joints, or the two required animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the spire base and its crown, then the halo ring, then the lens, checking each
part's preview as you go. Define the parts, pivots, and the two auto
`halo_ring_spin` and `lens_pulse` joints through the tool's rig subcommands (the
required parts, joints, and animations are already pre-seeded in `rig.json`, but
confirm they match this brief and adjust pivots to your sculpt), then **author the
two required animations' motion** with `define-animation` and `add-keyframe`. Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane), the
rig subcommands, and the animation subcommands, and `voxel-anim <operation> --help`
for each one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
