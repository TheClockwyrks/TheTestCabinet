# Sunfront Lumen — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lumen**, a floating beacon drone with
two counter-rotating rings around a glowing core and a forward beam emitter, as
a **3D voxel model** with a small **rig** a game can pose at runtime. There is no
target model to copy: build something that reads unmistakably as this hovering
beacon and poses correctly from the description below.

## The volume and coordinate system

- The volume is **40 wide (x) x 56 tall (y) x 40 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the drone, `0`-`39`. **y** runs up, `0` (bottom) to `55`
  (top). **z** runs front-to-back, `0`-`39`.
- **Forward is +z:** the emitter beam points toward `z = 39` (the front) when it
  is at rest. Up is +y.
- Build the drone **symmetric about the lengthwise vertical centerplane between
  `x = 19` and `x = 20`** — the two rings mirror each other, and the core and
  emitter are centered on it.
- The Lumen **floats** — it has no legs and does not touch the ground. Sculpt the
  core hovering in the middle-to-upper part of the volume, leaving clear space
  below it so it reads as airborne.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled drone
  (a ring already out at its side, the emitter already out front).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Shell — primary plating (brass) | `#c69a4b` |
| Shell — dark plating, underside, shadow (bronze) | `#7a5527` |
| Rings, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Emitter energy accent (solar amber) | `#ff9d2e` |
| Core heart, glowing highlight (solar hot) | `#ffd76b` |

The Lumen's signature is its **core**: give it a bright **solar-hot heart** at the
center of the core hull, with the **solar-amber** accent on the emitter, so the
glow reads from multiple angles.

## The parts

The drone is a **rig** of four required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished drone:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `core` | *(root)* | `[0, 0, 0]` | The floating core hull and its heart |
| `ring_left` | `core` | `[10, 34, 20]` | The left orbiting ring |
| `ring_right` | `core` | `[30, 34, 20]` | The right orbiting ring |
| `emitter` | `core` | `[20, 26, 30]` | The forward beam projector |

- **`core`** is the **root** — the fixed body of the drone. Sculpt a compact
  hovering core hull in the brass shell color (bronze on its underside and in the
  shadowed seams), centered on the centerplane and floating in the middle of the
  volume with clear air below it. At its center set a bright **solar-hot heart**,
  the glowing core the drone is built around. Keep the sides fleshed out where the
  rings mount and the front face fleshed out where the emitter mounts, so the
  children have something to seat against.
- **`ring_left`** attaches to the left side at **`[10, 34, 20]`**. Sculpt a ring
  in the iron color — a hoop standing on its edge, facing forward, orbiting the
  core on the left — positioned just outboard of the core. It sits **beside** the
  core with no gap at the mount.
- **`ring_right`** attaches to the right side at **`[30, 34, 20]`**, a mirror of
  the left ring in the same iron color.
- **`emitter`** attaches to the front of the core at **`[20, 26, 30]`**. Sculpt
  a beam projector in the iron color with a **solar-amber** lens, projecting
  **forward (+z)** from the core face, centered on the centerplane and meeting the
  core at the mount with no gap. Shape it so it can tilt up and down about a
  horizontal hinge across the mount.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`emitter_pitch`** — a **rotation** about the **x** (across) axis, through the
  emitter mount at pivot **`[20, 26, 30]`**, driven by the **caller** (the game).
  Its range is **`min = -0.6` to `max = 0.6`**, resting at `0` (aiming level and
  forward). Driving it must **tilt the whole emitter up and down about that
  hinge** — the beam projector as one solid piece — so the drone can aim its beam.
  Only the emitter moves on this joint; no voxel of it should tear away from the
  core or clip into it as it tilts.

The two rings **spin on their own** — each carries an **auto**-driven spin joint
the case drives with a looping clip, so the rings turn without the caller:

- **`ring_left_spin`** — a **rotation** about **z** (front-to-back) through
  **`[10, 34, 20]`**, `min = -π`, `max = +π`, rest `0`, **`drive = "auto"`**, so
  the ring turns like a wheel facing forward.
- **`ring_right_spin`** — the same about **`[30, 34, 20]`**, driven in the
  **opposite direction** so the two rings counter-rotate.

Sculpt each ring so it turns plausibly about its mount, as a full hoop, without
detaching from the core.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a subtle core bob, or a third ring), but you must **not drop or
contradict** the required parts, the required caller `emitter_pitch` joint, or the
two auto spin joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the core hull and its heart, then each ring, then the emitter, checking each
part's preview as you go. Define the parts, pivots, the caller `emitter_pitch`
joint, and the two auto spin joints through the tool's rig subcommands (the
required parts and joints are already pre-seeded in `rig.json`, but confirm they
match this brief and adjust pivots to your sculpt). Run `voxel-anim --help` for
the available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` between calls to judge each part against
this brief.
