# Sunfront Monolith Forge — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Monolith Forge**, a towering great
forge with a massive pounding hammer and a turning gear crown, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: build something that reads unmistakably as this working forge building
and runs correctly from the description below.

## The volume and coordinate system

- The volume is **68 wide (x) x 84 tall (y) x 68 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the forge, `0`-`67`. **y** runs up, `0` (bottom, the ground)
  to `83` (top). **z** runs front-to-back, `0`-`67`.
- **Forward is +z:** the forge's mouth and hammer throat face toward `z = 67`
  (the front). Up is +y.
- Build the forge **symmetric about the lengthwise vertical centerplane between
  `x = 33` and `x = 34`** where the form allows, with the hammer centered in its
  throat and the gear crown centered on top.
- The forge is deliberately **huge and blocky** — the largest structure in the
  roster, a massive masonry forge rooted to the ground, filling most of the width
  and depth at its base.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  forge (the hammer already up in its throat, the gear crown already on top).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Hammer, gear, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the forge a clear amber
**energy accent** — a glowing forge-mouth or vent at the hammer throat — so the
accent reads from multiple angles.

## The parts

The forge is a **rig** of three required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished forge:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The forge tower and its foundation |
| `hammer` | `base` | `[34, 58, 34]` | The massive stamping hammer head |
| `gear_crown` | `base` | `[34, 74, 34]` | The gear crown atop the forge |

- **`base`** is the **root** — the fixed forge tower. Sculpt a huge, blocky
  masonry forge in the brass and bronze plating (bronze on its underside and in
  the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, filling most of the width and depth at the foundation and
  rising most of the height. Open a **throat** up its center for the hammer to
  pound in, and set the **solar-amber energy accent** — a forge-mouth or vent —
  at the throat so it glows. Flesh out the crest where the gear crown mounts and
  the throat walls where the hammer rides so the children have something to seat
  against.
- **`hammer`** attaches in the forge's throat at **`[34, 58, 34]`**. Sculpt a
  massive iron stamping-hammer head centered in the throat, sitting up near the
  top of the tower, sized to pound straight down deep into the throat and back up
  without touching its walls. It meets the throat at its mount with no gap.
- **`gear_crown`** attaches to the forge's crest at **`[34, 74, 34]`**. Sculpt a
  broad toothed iron gear crown (a disc with teeth around its rim) centered on
  that hub atop the forge, standing proud of the crest so its teeth read, meeting
  the tower at the hub with no gap. Shape it so it turns cleanly about its hub.

## The required joints

Both animated elements **run on their own** — each carries an **auto**-driven
joint, so the forge cycles without any caller. There are **no** caller joints.

- **`hammer_stamp`** — a **translation** along the **y** (up) axis, through the
  hammer mount at pivot **`[34, 58, 34]`**, **`drive = "auto"`**. Its range is
  **`min = -18` (bottom of the stamp) to `max = 0` (fully raised, at rest)**,
  resting at `0`. Its animation (below) drives the great hammer straight down deep
  and back up in its throat, so it pounds on its own. Sculpt the hammer so it
  slides plausibly down and up about that mount without any voxel tearing away or
  clipping the throat walls.
- **`crown_spin`** — a **rotation** about the **y** (up) axis, through the gear
  crown hub at pivot **`[34, 74, 34]`**, **`drive = "auto"`**. Its range is a
  full turn, `min = -π`, `max = +π`, resting at `0`. Its animation turns the crown
  a full revolution and loops, so it spins on its own. Sculpt the gear crown so
  it
  rotates plausibly about its hub without any voxel tearing away from the crest.

## The required animations

The forge ships **two required animations** you must **author**. The case declares
each animation's identity and intent only — its name, period, and the joint it
drives — **not** its keyframes. You produce the motion yourself as an **F-curve**:
call `voxel-anim define-animation` to create it, then `voxel-anim add-keyframe`
to
place each keyframe on its joint's track, choosing an `--interp` per keyframe
(`constant`, `linear`, `bezier`, `ease-in`, `ease-out`, or `ease-in-out`, with
optional `--out-handle`/`--in-handle`) so the motion carries **weight** — an eased
curve, never a flat linear slide. Both are **decorative, self-playing idles**
(`auto_play`): they run continuously so the forge cycles on its own.

- **`hammer_stamp`** — period **1600 ms**, looping, driving the `hammer_stamp`
  joint. Author the great hammer dropping deep down its throat and rising back to
  rest: pull it down toward `-18`, then lift it back to `0` over the loop. Give
  the
  drop its weight — ease **into** the bottom of the stamp so it lands with a thud,
  rather than sliding linearly — and let it recover more smoothly on the way up.
- **`crown_spin`** — period **2600 ms**, looping, driving the `crown_spin` joint.
  Author the gear crown turning one steady full revolution about its hub (from
  `-π` to `+π`) and looping seamlessly, at a constant pace so the spin reads as
  a
  continuous turn.

You **may add** your own extra parts, joints, or auto-play animations on top of
this (for example a second gear, a puff vent, or extra pipework), but you must
**not drop or contradict** the required parts, the two auto `hammer_stamp` and
`crown_spin` joints, or the two required animations that drive them.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the forge base and its throat, then the hammer, then the gear crown, checking each
part's preview as you go. Define the parts, pivots, the two auto `hammer_stamp`
and
`crown_spin` joints, and their two required animations through the tool's rig and
animation subcommands (the required parts, joints, and animation declarations are
already pre-seeded in `rig.json`, but the animations carry **no** keyframes — you
author each F-curve with `define-animation`/`add-keyframe` — and confirm the parts
and joints match this brief, adjusting pivots to your sculpt). Run `voxel-anim
--help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
