# Sunfront Skyworks — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Skyworks**, an open launch-pad
hangar with a fast spinning turbine and a raising launch door, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target
model to copy: build something that reads unmistakably as this launch-pad
building and runs correctly from the description below.

## The volume and coordinate system

- The volume is **64 wide (x) x 64 tall (y) x 64 deep (z)**, in opaque voxels.
  It starts **empty**.
- **x** runs across the pad, `0`-`63`. **y** runs up, `0` (bottom, the ground)
  to `63` (top). **z** runs front-to-back, `0`-`63`.
- **Forward is +z:** the launch door faces toward `z = 63` (the front). Up is
  +y.
- Build the pad **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** where the form allows, with the turbine centered over
  the mast and the door centered in the front face.
- The Skyworks is a **broad, open launch pad** — a heavy masonry hangar rooted
  to the ground, filling most of the width and depth at its base, open above so
  the turbine reads high overhead.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled pad
  (the turbine already up on its mast, the door already in the front face).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Turbine, door, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the pad a clear amber
**energy accent** — a glowing pad ring, launch lights, or a hub glow at the
turbine — so the accent reads from multiple angles.

## The parts

The Skyworks is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished pad:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The launch-pad hangar and its foundation |
| `turbine` | `base` | `[32, 50, 32]` | The spinning turbine on the center mast |
| `launch_door` | `base` | `[32, 20, 50]` | The launch door in the front face |

- **`base`** is the **root** — the fixed launch pad. Sculpt a broad, open
  hangar in the brass and bronze plating (bronze on its underside and in the
  shadowed seams, sandstone panels for lighter structure) sitting on the ground
  from `y = 0`, filling most of the width and depth at the foundation. Raise a
  **center mast** up its middle for the turbine to spin on, and leave the pad
  open above so the turbine reads high overhead. Set the **solar-amber energy
  accent** — a glowing pad ring or launch lights — so it glows. Flesh out the
  front face where the door rides and the mast top where the turbine mounts so
  the children have something to seat against.
- **`turbine`** attaches to the top of the center mast at **`[32, 50, 32]`**.
  Sculpt a bladed iron turbine (a hub with blades around its rim) centered on
  that hub, standing high over the pad so its blades read, meeting the mast at
  the hub with no gap. Shape it so it spins cleanly about its vertical axis.
- **`launch_door`** attaches in the pad's front face at **`[32, 20, 50]`**.
  Sculpt a heavy iron launch door centered in the front face, sized to slide
  straight up and back down within its runners, meeting the pad at its runners
  with no gap.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint that its required animation drives, so the Skyworks cycles without any
caller. There are **no** caller joints.

- **`turbine_spin`** — a **rotation** about the **y** (up) axis, through the
  turbine hub at pivot **`[32, 50, 32]`**, **`drive = "auto"`**. Its range is a
  full turn, `min = -π`, `max = +π`, resting at `0`. Sculpt the turbine so it
  rotates plausibly about its hub without any voxel tearing away from the mast.
- **`launch_door_raise`** — a **translation** along the **y** (up) axis, through
  the door mount at pivot **`[32, 20, 50]`**, **`drive = "auto"`**. Its range is
  **`min = 0` (fully closed, at rest) to `max = 16` (fully raised)**, resting at
  `0`. Sculpt the door so it slides plausibly up and down in its runners without
  any voxel tearing away or clipping the front face.

## The required animations

The rig ships **two required animations** you must author. Each is pre-declared
in
`rig.json` as a name, its loop/`auto_play` intent, and the single joint it drives;
you supply its **motion** by authoring its F-curves. Both are **decorative
idles** (`auto_play = true`): they play continuously on their own so the Skyworks
runs without any caller.

- **`turbine_spin`** (period `700 ms`, `loop = true`, `auto_play = true`, drives
  the `turbine_spin` joint) — spins the turbine a **full revolution fast** and
  loops. Author a continuous, even rotation from `-π` back around to `+π`.
- **`launch_door_raise`** (period `3400 ms`, `loop = true`, `auto_play = true`,
  drives the `launch_door_raise` joint) — slides the door **up, holds it open,
  then lowers it back**. Give it weight: ease the door into and out of the open
  hold rather than sliding it linearly.

Author each animation with the `voxel-anim` animation subcommands —
`define-animation` to declare it, then `add-keyframe` to place its keys (see
`voxel-anim --help`). Set each keyframe's interpolation with `--interp`
(`constant | linear | bezier | ease-in | ease-out | ease-in-out`), and shape the
curve with the optional `--out-handle` / `--in-handle` handles, so the motion
carries **weight as F-curves** and never just slides linearly. The turbine's spin
reads best as an even `linear` loop; the door should `ease-in` / `ease-out` around
its open hold.

You **may add** your own extra parts, joints, or auto-play animations on top of
this (for example a second door panel, a beacon, or extra pipework), but you must
**not drop or contradict** the required parts, the two auto `turbine_spin` and
`launch_door_raise` joints, or their two required animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` —
finish the pad base and its mast, then the turbine, then the door, checking each
part's preview as you go. Define the parts, pivots, the two auto `turbine_spin`
and `launch_door_raise` joints, and the two required animations' F-curves through
the tool's rig and animation subcommands (the required parts, joints, and
animation declarations are already pre-seeded in `rig.json`, but confirm they
match this brief, adjust pivots to your sculpt, and author each animation's
keyframes). Run `voxel-anim --help` for the available operations (setting and
clearing single voxels, filling and stroking boxes, 3D lines, spheres, and a
mirror plane), the rig subcommands, and the animation subcommands
(`define-animation`, `add-keyframe`), and `voxel-anim <operation> --help` for each
one's exact flags. Call `voxel-anim` once per operation and read
`parts/<part>.png` between calls to judge each part against this brief.
