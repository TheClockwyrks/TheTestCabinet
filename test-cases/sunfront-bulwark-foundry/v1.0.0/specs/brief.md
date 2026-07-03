# Sunfront Bulwark Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark Foundry**, a heavy armored
bunker-forge with a **raising blast door** and a **turning drive flywheel**, as a
**3D voxel model** with a small **rig** that animates on its own. There is no
target model to copy: build something that reads unmistakably as this fortified
forge and animates correctly from the description below.

This brief fixes **what the Foundry is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pivots — **working out the
pieces a bunker-forge with a raising door and a turning wheel needs, where they
attach, and how they articulate is the test.** Invent the rig.

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
  building.

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

## What the Foundry is (and what is yours to invent)

Fixed — the foundry must read unmistakably as **all** of these:

- A **squat, thick-walled armored bunker-forge** — a heavy fortified building in
  the brass armor color (bronze on its underside and shadowed seams, sandstone
  masonry for secondary walls and trim), sitting on the ground and filling most of
  the width and depth. It is the **fixed body** of the foundry.
- A **broad blast door** set into the **front** of the building, filling a wide
  door opening, with a molten **solar-amber forge glow** showing behind it.
- A **great drive flywheel** — a large, round wheel (a rim with spokes to a hub)
  standing upright on the **flank**, its face visible from the side.
- A clear **solar-amber** forge accent and the palette above.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
bunker is massed and detailed, how the door and its frame are shaped, how the
flywheel and its axle housing are built, and how you break the foundry into rig
parts and place its joints. Nothing here prescribes a shape; the test rewards a
bold, characterful design that is unmistakably the Foundry and animates
convincingly. Keep the front opening and the flank fleshed out so the door and the
wheel have something to mount to, and shape each moving element so it can travel
about its mount without detaching from the body.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are **decorative self-playing idles** (`auto_play` — they
play continuously on their own, with no caller). This foundry has **no caller
controls**. Author each with `voxel-anim define-animation` then `add-keyframe`,
choosing the period and giving each keyframe an `--interp` (`constant`, `linear`,
`bezier`, `ease-in`, `ease-out`, or `ease-in-out`) and, where it helps,
`--out-handle`/`--in-handle`, so the motion **carries weight** through eased curves
rather than sliding linearly.

- **`blast_door_raise`** — the door cycle. Raises the heavy front blast door
  **straight up** off its shut rest, **holds it open** at the top for a beat, then
  **eases it back down** and settles it shut — a weighty portcullis cycle. The door
  travels along a clean vertical track and stays within its frame; no voxel tears
  away or leaves the opening as it moves.
- **`flywheel_spin`** — the drive wheel. Turns the great flank flywheel **steadily**
  about its axle, a **full continuous revolution** each loop, reading as smooth
  rotation with no jerk at the loop seam. No voxel of the wheel tears away from the
  hub or clips into the building as it turns.

You **may add** your own extra parts, joints, or auto-play animations on top of this
(for example a venting stack, a smaller gear, or a subtle glow flicker), but you must
produce these two animations, by these names, and must not contradict them.

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls to
confirm the parts fit, the door sits square in its front opening, the flywheel seats
on its flank, and the animations read with weight. Run `voxel-anim --help` for the
available operations (setting and clearing single voxels, filling and stroking boxes,
3D lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per operation.
The recorded per-part logs and `rig.json` are your scored submission.
