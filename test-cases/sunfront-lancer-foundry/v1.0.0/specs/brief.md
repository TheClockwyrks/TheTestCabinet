# Sunfront Lancer Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lancer Foundry**, a tall, slender
industrial spire with a sliding rail-arm and a spinning focus-ring, as a **3D
voxel model** with a small **rig** a game can pose at runtime. There is no target
model to copy: build something that reads unmistakably as this foundry tower and
animates correctly from the description below.

## The volume and coordinate system

- The volume is **44 wide (x) x 84 tall (y) x 44 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the spire, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `83` (top). **z** runs front-to-back, `0`-`43`.
- **Forward is +z**, up is +y.
- Build the spire **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** — the shaft, rail-arm, and focus-ring are centered on
  it.
- The foundry is deliberately **tall and slender** — a narrow tower that fills
  most of the height but only the middle of the footprint, rising off the ground.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  spire (the rail-arm already set into the mid-shaft, the focus-ring already at
  the crown).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Mechanisms, rail, ring (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the spire a clear amber
energy accent — a charge-band up the shaft or a lit focus-ring core, with
solar-hot highlights — so the accent reads from multiple angles.

## The parts

The foundry is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished spire:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The tower shaft and its footing |
| `rail_arm` | `base` | `[22, 50, 22]` | The sliding mid-shaft rail-arm |
| `focus_ring` | `base` | `[22, 68, 22]` | The spinning focus-ring at the crown |

- **`base`** is the **root** — the fixed foundation of the foundry. Sculpt a solid
  masonry footing in the brass and bronze colors sitting on the ground (from
  `y = 0`), rising into a narrow, tapering shaft in brass and sandstone that runs
  most of the height. Work an amber charge-band or seam up the shaft for the
  accent. Keep the mid-shaft and crown fleshed out where the rail-arm and
  focus-ring mount so the children have something to seat against.
- **`rail_arm`** attaches to the mid-shaft at **`[22, 50, 22]`**. Sculpt a heavy
  iron assembly arm — a bracket or carriage clasping the shaft — centered on the
  centerplane and meeting the shaft along its rail with no gap. Shape it so it can
  ride straight up and back down along the shaft (a vertical slide).
- **`focus_ring`** attaches to the crown at **`[22, 68, 22]`**. Sculpt a machined
  iron ring circling the top of the shaft, centered on the centerplane, with a
  solar-hot core so it reads as an energy focus. Shape it so it can spin freely
  about the vertical axis without detaching from the crown.

## The required joints

This is a **structure**: it has no caller-driven controls. Instead, both moving
parts **animate on their own** — each carries an **auto**-driven joint you must
declare and then drive with a looping animation you author, so the foundry works
without any caller:

- **`rail_arm_slide`** — a **translation** along the **y** (up) axis, through the
  rail-arm's mount at pivot **`[22, 50, 22]`**, `min = 0` (seated at the bottom,
  at rest), `max = 10` (fully raised), rest `0`, **`drive = "auto"`**. Sculpt the
  arm so it slides plausibly along the shaft without any voxel tearing away from
  its rail or clipping through the shaft.
- **`focus_ring_spin`** — a **rotation** about the **y** (up) axis, through the
  ring's mount at pivot **`[22, 68, 22]`**, a full turn (`min = -π`, `max = +π`),
  rest `0`, **`drive = "auto"`**. Sculpt the ring so it rotates plausibly about
  that vertical axis without detaching from the crown.

The `base` stays **fixed** — only the rail-arm and the focus-ring move.

## The required animations

You must **author** two looping, auto-play animations — one per moving part — so
the foundry cycles on its own. The case declares each animation's identity and
intent; **you produce the motion**. For each one, create it with the `voxel-anim`
animation subcommands (`define-animation`, then `add-keyframe`) and shape it as
an
**F-curve** — set each keyframe's interpolation (`--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` bezier tangents) so the motion carries **weight**
rather than sliding linearly. Run `voxel-anim --help` and `voxel-anim
define-animation --help` / `voxel-anim add-keyframe --help` for the exact flags.

- **`rail_arm_slide`** — period **1600 ms**, `loop`, **auto-play**, driving the
  `rail_arm_slide` joint. Ride the rail-arm smoothly up its full ten voxels and
  back down, easing into the top and bottom of the stroke (ease-in-out) so it
  settles rather than snapping — a heavy carriage riding the shaft.
- **`focus_ring_spin`** — period **2000 ms**, `loop`, **auto-play**, driving the
  `focus_ring_spin` joint. Turn the focus-ring one full, continuous revolution
  (`-π → +π`) at a steady pace (linear, so the spin never stutters).

You **may add** your own extra parts, joints, or auto-play animations on top of
this (for example a subtle idle glow or extra detail vents), but you must **not
drop or contradict** the required parts, the two auto joints, or the two required
animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the base tower and its footing, then the rail-arm, then the focus-ring, checking
each part's preview as you go. Define the parts, pivots, and the two auto joints
through the tool's rig subcommands (the required parts, joints, and animations are
already pre-seeded in `rig.json`, but confirm they match this brief and adjust
pivots to your sculpt), then author each required animation's F-curve keyframes
with `define-animation`/`add-keyframe`. Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig and animation subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` between calls to judge each part against
this brief.
