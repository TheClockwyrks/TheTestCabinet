# Sunfront Lumen — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lumen**, a floating beacon drone with
two counter-rotating rings around a glowing core and a forward beam emitter, as
a **3D voxel model** with a small **rig** a game can pose at runtime. There is no
target model to copy: build something that reads unmistakably as this hovering
beacon and moves the way the animation contract below demands.

This test measures **creativity and craft**, not instruction-following: the brief
tells you *what the Lumen is* and *how it must move*, but the parts you build, how
you break the drone into moving pieces, where you place the joints, and how you
shape every form are **entirely yours to invent**. Work out the pieces a hovering,
ring-spinning, beam-nodding drone needs.

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

## What the Lumen is (and what is yours to invent)

Fixed — the drone must read unmistakably as **all** of these:

- A **compact hovering core hull** — the fixed body of the drone, in the brass
  shell color (bronze on its underside and in the shadowed seams), floating in the
  middle of the volume with clear air below it so it reads as airborne, **not a
  plain box**.
- A bright **solar-hot heart** at the center of the core — the glowing core the
  whole drone is built around.
- **Two rings** in the iron color, one orbiting each side of the core — hoops
  standing on edge, facing forward, that **spin on their own** in **opposite**
  directions (see the animations).
- A **beam emitter** projecting **forward (+z)** from the core face, in the iron
  color with a **solar-amber** lens, that **tilts up and down** about a horizontal
  hinge across its mount (see the animations).
- A clear **solar-amber** accent on the emitter and the **solar-hot** heart, so
  the glow shows from many angles.

**Everything else is yours to invent** — the exact silhouette and proportions of
the core, how you shape the rings and the emitter, and how you break the drone
into rig parts and place its joints. Nothing here prescribes a shape or a joint;
the test rewards a bold, characterful design that is unmistakably the Lumen and
animates convincingly.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name
(you author the motion). Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with the
optional `--in-handle`/`--out-handle` bezier handles) so the motion **carries
weight** and eases and settles — it must **not** slide linearly. Run `voxel-anim
--help` and `voxel-anim define-animation --help` / `voxel-anim add-keyframe --help`
for the exact flags. Each of the three **loops**:

- **`ring_spin`** — the continuous decorative idle (a **self-playing** animation:
  it plays on its own, without a caller, under the playables and at rest). Turns
  the two rings a full revolution each, in **opposite** directions, so they
  counter-rotate smoothly and endlessly around the core.
- **`hover`** — the movement state a game triggers (a **game-triggered playable**,
  the drone's equivalent of a walker's `walk`). Bobs the whole legless craft
  gently up and down so it reads as floating in place: ease up to the top of the
  bob, hang, ease back down, hang — never a straight saw-tooth slide.
- **`pulse`** — the emitter showcase a reviewer triggers (a **game-triggered
  playable**). Nods the front beam emitter up, back to level, down, and level
  again about its mount, each turn eased so the beam settles rather than snapping.

You **may add** your own extra parts, joints, or animations on top of this (for
example a third ring or a subtle emitter flicker), but you must **not drop or
contradict** the three required animations above, and their motion must match
their intent (don't spin the rings under `pulse`, or nod the emitter under
`hover`).

## Working the tool

Define your parts with `voxel-anim define-part` (giving each a parent and a
pivot), sculpt each with `--part <name>`, set pivots with the rig subcommands,
place joints with `define-joint`, and **author the three required animations**
(`ring_spin`, `hover`, `pulse`) with `define-animation` and `add-keyframe` as
described above — reading `parts/<part>.png` and the assembled-scene previews under
`scene/` (`scene/iso.png`, `scene/front.png`, `scene/side.png`, `scene/top.png`)
between calls to confirm the rings sit out at the core's sides, the emitter meets
the core face, and the animations read with weight. Run `voxel-anim --help` for the
available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane), the rig subcommands, and the
animation subcommands, and `voxel-anim <operation> --help` for each one's exact
flags. Call `voxel-anim` once per operation. The recorded per-part logs and
`rig.json` are your scored submission.
