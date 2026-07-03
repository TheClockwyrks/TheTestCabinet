# Sunfront Skyworks — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Skyworks**, an open launch-pad
hangar with a fast spinning turbine and a raising launch door, as a **3D voxel
model** with a **rig** a game can pose at runtime. There is no target model to
copy: build something that reads unmistakably as this launch-pad building and
runs correctly from the description below.

This brief fixes **what the Skyworks is** and **how it must move**. It
deliberately does **not** give you a parts list, joint placements, or ranges —
**working out the pieces a launch pad with a spinning turbine and a raising door
needs, where they attach, and how they articulate is the test.** Invent the rig.

## How the tool works

`voxel-anim` places **discrete opaque cubes** — it is a cube/voxel tool, not a
mesh tool. You paint cells with `set-voxel`, `fill-box`, box strokes, 3D lines,
and spheres, clear them, and mirror across a plane. Voxels are **opaque**
`#rrggbb` colors — there is no transparency.

- Global **`--part <name>`** selects the part an op sculpts; **each part is its
  own model**, previewed and logged on its own. Create a part with `define-part`
  before you sculpt into it.
- Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png`
  and the assembled `scene/*.png` — **read them between calls**. `voxel-anim
  --help` is the contract.

## The volume and coordinate system

- The volume is **64 wide (x) x 64 tall (y) x 64 deep (z)**, in opaque voxels.
  It starts **empty**.
- **x** runs across the pad, `0`-`63`. **y** runs up, `0` (bottom, the ground)
  to `63` (top). **z** runs front-to-back, `0`-`63`.
- **Forward is +z:** the launch door faces toward `z = 63` (the front). Up is
  +y.
- Build the pad **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** where the form allows, with the turbine centered over
  its mast and the door centered in the front face.
- Each part is sculpted in these shared coordinates, positioned where it sits on
  the assembled pad (the turbine already up on its mast, the door already in the
  front face).

## What the Skyworks is (and what is yours to invent)

Fixed — the pad must read unmistakably as **all** of these:

- A **broad, open launch pad** — a heavy masonry hangar rooted to the ground,
  filling most of the width and depth at its base, open above so the turbine
  reads high overhead. It is a **building**, not a plain box.
- A **center mast** rising up the pad's middle for the turbine to mount and spin
  on.
- A **bladed turbine** high on that mast (a hub with blades around its rim) that
  **spins** on its own (see the animations), reading clearly from above the open
  pad.
- A **heavy launch door** set in the pad's **front face** that **slides up and
  back down** on its own (see the animations).
- A clear **solar-amber energy accent** and the palette below.

**Everything else is yours to invent** — the exact silhouette, proportions, how
the hangar is massed and tiered, the design of the mast, the shape and blade
count of the turbine, how the door and its runners are built, and how you break
the pad into rig parts and place its joints. Nothing here prescribes a shape; the
test rewards a bold, characterful design that is unmistakably the Skyworks and
animates convincingly.

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

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name
(you author the motion). Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and setting each key's `--interp`
(`constant | linear | bezier | ease-in | ease-out | ease-in-out`, with the
optional `--in-handle` / `--out-handle` handles) so the motion carries **weight
as F-curves** and never just slides linearly. Both are **decorative idles**
(`auto_play = true`): they play continuously on their own so the Skyworks runs
without any caller.

- **`turbine_spin`** — the turbine sweep. Spins the turbine a **full revolution**
  overhead about its vertical axis, evenly and looping, so the pad runs on its
  own. The turbine spins as one solid piece about its hub, never tearing away
  from the mast; nothing else moves. Reads best as an even `linear` loop.
- **`launch_door_raise`** — the launch-door cycle. Slides the door **straight up
  in the front face, holds it open, then lowers it back**, looping on its own.
  Give it weight: `ease-in` / `ease-out` around the open hold rather than sliding
  linearly. The door slides as one solid piece within its runners, never tearing
  away or clipping the front face; nothing else moves.

You **may add** extra parts, joints, and auto-play animations of your own (a
second door panel, a beacon, extra pipework); you must produce **these two
animations, by these names**, and must not contradict them (e.g. don't drag the
pad along under either, or move the door under `turbine_spin`).

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` —
finish the pad base and its mast, then the turbine, then the door, checking each
part's `parts/<part>.png` and the assembled `scene/*.png` previews between calls
to confirm the parts fit, the turbine seats on its mast, and the door seats in
the front face. Define your parts with `define-part`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading the previews between calls to confirm the animations read
with weight. Run `voxel-anim --help` for the available operations (setting and
clearing single voxels, filling and stroking boxes, 3D lines, spheres, and a
mirror plane), the rig subcommands, and the animation subcommands
(`define-animation`, `add-keyframe`), and `voxel-anim <operation> --help` for
each one's exact flags. Call `voxel-anim` once per operation. The recorded
per-part logs and `rig.json` are your scored submission.
