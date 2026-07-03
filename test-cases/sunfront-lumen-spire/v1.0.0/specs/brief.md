# Sunfront Lumen Spire — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lumen Spire**, a slim beacon spire
with a **spinning halo ring** and a **pulsing solar lens**, as a **3D voxel model**
with a small **rig** a game runs at runtime. There is no target model to copy: build
something that reads unmistakably as this beacon spire and satisfies the animation
contract below.

This brief fixes **what the Spire is** and **how it must move**. It deliberately does
**not** give you a parts list, joint placements, or pose ranges — **working out the
pieces a spinning, pulsing beacon needs, where they attach, and how they articulate is
the test.** Invent the rig.

## How the tool works

`voxel-anim` places **discrete opaque cells** — this is a cube-voxel tool, not a mesh
tool:

- `set-voxel` places one cell; `fill-box`/`stroke-box`, 3D lines, and spheres lay
  down runs of cells; a **mirror** plane reflects the cells you place.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its own
  field**, painted and previewed on its own. Create a part with `define-part` before
  you sculpt into it.
- Voxels are **opaque** `#rrggbb` — there is no transparency.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is the
contract.

## The volume and coordinate system

- The volume is **44 wide (x) x 88 tall (y) x 44 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the spire, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `87` (top). **z** runs front-to-back, `0`-`43`.
- **Forward is +z:** the spire faces toward `z = 43` (the front). Up is +y.
- Build the spire **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** where the form allows, with the halo ring and lens
  centered on the spire's vertical axis.
- The spire is deliberately **slim and tall** — a slender masonry beacon tower rooted
  to the ground, narrow in width and depth, rising most of the height.
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  spire.

## What the Spire is (and what is yours to invent)

Fixed — the spire must read unmistakably as **all** of these:

- A **slim, tall masonry tower** — a slender signalling spire rooted to the ground,
  with a broader footing that tapers up into a narrow shaft rising most of the height,
  fleshed out into a **crown** near its top and brought to a **tip** above it. Not a
  plain box, and not an abstract stack of boxes.
- A **halo ring** — an open loop, wider than the shaft — encircling the crown, standing
  clear of the shaft so the loop reads. It **turns on its own** (see the animations).
- A **solar lens** — a compact, bright solar-hot core in an iron housing — seated atop
  the spire's tip. It **bobs up and down on its own** (see the animations).
- A clear, strong **solar-hot** energy accent and the palette below.

**Everything else is yours to invent** — the exact silhouette and proportions, how the
tower is tiered and tapered, how the crown and tip are shaped, how the ring and lens are
styled, and how you break the spire into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is unmistakably
the Lumen Spire and animates convincingly.

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

The **solar-amber** accent is the team-tint region: give the spire a **strong** solar
energy accent — a bright solar-hot lens core, with solar-amber glow bleeding down the
halo ring and crown — so the accent reads boldly from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are **self-playing** decorative idles — they run continuously
on their own, with **no caller controls**; the spire cycles by itself. Author each with
`voxel-anim define-animation` then `add-keyframe`, choosing the period and setting each
key's interpolation (`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`,
with optional `--out-handle`/`--in-handle` bezier handles) so the motion **carries
weight** and eases through its extremes rather than sliding at constant speed.

- **`halo_ring_spin`** — the halo sweep (a self-playing idle). Turns the halo ring a
  **full, continuous revolution** about the spire's vertical axis over one period,
  wrapping **seamlessly** as it loops. A steady rotation reads best with `linear`
  interpolation so the spin never stalls at the wrap.
- **`lens_pulse`** — the beacon bob (a self-playing idle). Lifts the solar lens **off
  its seat and settles it back down** within one period. Use eased interpolation (e.g.
  `ease-out` on the way up, `ease-in` back to the seat) so the lens hangs at the top and
  settles with weight rather than bouncing linearly, and keep the travel small enough
  that the lens never leaves the tip.

Both animations must move only their own element — the ring under `halo_ring_spin`, the
lens under `lens_pulse` — while the spire's tower and foundation stay put. You **may
add** extra parts, joints, and animations of your own (a second ring, a light halo,
extra finials); you must produce **both** these animations, by these names, and must not
contradict them (don't move the tower, and don't let one element's motion drag the
other).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations' keyframes —
reading `parts/<part>.png` and the `scene/*.png` previews between calls to confirm the
parts fit (the ring encircling the crown, the lens seated on the tip) and that the
animations read with weight. Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines, spheres, and
a mirror plane), the rig subcommands, and the animation subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. The recorded per-part logs
and `rig.json` are your scored submission.
