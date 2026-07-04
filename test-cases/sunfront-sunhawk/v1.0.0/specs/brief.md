# Sunfront Sunhawk — sculpting and rigging brief

You are sculpting and rigging the Sunfront Sunhawk, a wide, flat gunship aircraft with
two spinning rotors and an underslung forward cannon — built by painting opaque cells
with `voxel-anim`, as a rigged 3D voxel model a game poses at runtime. There is no
target model to copy: it must read unmistakably as the Sunhawk and satisfy the
animation contract below.

This brief fixes what the Sunhawk is and how it must move. It deliberately does not give
you a parts list, joint placements, or pose angles — working out the pieces a hovering,
firing gunship needs, where they attach, and how they articulate is the test. Invent the
rig.

## How the tool works

`voxel-anim` places discrete opaque voxels — you build each part by painting cells:

- Set and clear single voxels, fill and stroke boxes, draw 3D lines and spheres, and
  use a mirror plane to keep the aircraft symmetric — each cell an opaque `#rrggbb`
  color (there is no transparency).
- Global `--part <name>` selects the part an op sculpts; each part is sculpted
  separately in its own preview and log. Create a part with `define-part` before you
  sculpt into it.

Build one operation at a time. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — read them between calls. `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **74 wide (x) × 28 tall (y) × 76 deep (z)**, in opaque voxels, starting
  empty.
- x runs across the aircraft, `0`–`73`. y runs up, `0` (bottom) to `27` (top). z runs
  front-to-back, `0`–`75`.
- Forward is +z: the nose and cannon point toward `z = 75` (the front) at rest. Up is
  +y.
- Build the aircraft symmetric about the lengthwise vertical centerplane between
  `x = 36` and `x = 37` — the two rotors mirror each other, and the fuselage and cannon
  are centered on it.
- The Sunhawk is deliberately wide and flat — a low, broad gunship, not a tall one. It
  fills most of the width and length while staying shallow in height.
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  aircraft.

## What the Sunhawk is (and what is yours to invent)

Fixed — the aircraft must read unmistakably as all of these:

- A wide, flat armored fuselage — a low, broad gunship hull with a shaped nose at the
  front (`z` toward `75`), not a plain box.
- A rotor out on each side (one per flank, plainly side-mounted on a stub or nacelle)
  that spins (see the animations).
- An underslung forward cannon projecting forward (+z) from beneath the nose, shaped so
  it can tilt up and down about a horizontal hinge across its mount.
- A clear solar-amber intake accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, how the
fuselage is shaped and tiered, how the rotors and nacelles are designed, how the cannon
is massed, and how you break the aircraft into rig parts and place its joints. Nothing
here prescribes a shape; the test rewards a bold, characterful design that is
unmistakably the Sunhawk and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — secondary panels (sandstone) | `#d9c48c` |
| Underside, shadowed seams (bronze) | `#7a5527` |
| Rotors, cannon, mechanisms (iron) | `#565c64` |
| Intake accent (solar amber) | `#ff9d2e` |

Give the Sunhawk clear amber intakes on the fuselage (a glow at the cannon's muzzle
reads well too), so the solar-amber accent shows from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with three required animation declarations by name (you author
the motion). Author each with `voxel-anim define-animation` then `add-keyframe`,
choosing the period and each key's interpolation with `--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out` (and, where it helps,
`--in-handle`/`--out-handle`) so the motion carries weight and ease, not a mechanical
linear slide.

- **`rotor_spin`** — the rotor blur (a self-playing idle). Both rotors whirl a full turn
  on their own across a short period so the blades read as a continuous blur, playing
  under the other animations and at rest. A smooth, near-constant-rate spin is right
  here.
- **`hover`** — the hover / cruise movement (a game-triggered playable). The whole craft
  bobs gently up and down (rise, hold near the top, settle, hold near the bottom) so it
  reads as a gunship holding station — buoyant, not a sawtooth. The rotors keep
  spinning; the cannon holds.
- **`strafe`** — the cannon gun-run (a game-triggered playable). The underslung cannon
  sweeps down to rake the ground and back up, then loops, settling onto the target with
  weight before it tips back up, while the fuselage holds station. The cannon moves; the
  hull stays put.

You may add extra parts, joints, and animations of your own (for example a tail fin,
landing skids, or a subtle banking idle); you must produce these three animations, by
these names, and must not contradict them (e.g. don't move the hull around under
`strafe`, or stop the rotors).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the three animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls to
confirm the parts fit, the rotors seat on their mounts, the cannon hangs under the nose,
and the animations read with weight. Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D lines,
spheres, and a mirror plane) and the rig subcommands, and `voxel-anim <operation>
--help` for each one's exact flags. The recorded per-part logs and `rig.json` are your
scored submission.
