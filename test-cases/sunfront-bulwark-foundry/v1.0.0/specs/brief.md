# Sunfront Bulwark Foundry — sculpting and rigging brief

You are sculpting and rigging the Sunfront Bulwark Foundry, a heavy armored bunker-forge
with a raising blast door and a turning drive flywheel, as a 3D voxel model with a small
rig that animates on its own. There is no target model to copy: build something that reads
unmistakably as this fortified forge and animates correctly from the description below.

This brief fixes what the Foundry is and how it must move. It does not give you a parts
list, joint placements, or pivots — working out the pieces a bunker-forge with a raising
door and a turning wheel needs, where they attach, and how they articulate is the test.
Invent the rig.

## The volume and coordinate system

- The volume is **66 wide (x) × 56 tall (y) × 66 deep (z)**, in opaque voxels. It starts
  empty.
- x runs across the building, 0–65. y runs up, 0 (the ground) to 55 (top). z runs
  front-to-back, 0–65. Forward is +z: the blast door faces toward z = 65. Up is +y.
- Build the foundry as a squat, heavy, fortified block — a thick-walled bunker, wider and
  deeper than it is tall, that fills most of the width and depth and sits flat on the
  ground from y = 0.
- Build it symmetric about the vertical centerplane between x = 32 and x = 33 where the
  form allows.
- Each part is sculpted separately with `voxel-anim --part <name>`, in this same volume's
  coordinates, positioned where the part sits on the assembled building.

## Palette

Use only these opaque colors:

| Role | Hex |
| --- | --- |
| Plating — primary armor (brass) | `#c69a4b` |
| Plating — dark armor, underside, shadow (bronze) | `#7a5527` |
| Masonry — secondary walls, trim (sandstone) | `#d9c48c` |
| Mechanisms — door, flywheel, fittings (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Forge glow accent (solar amber) | `#ff9d2e` |
| Molten core highlight (solar hot) | `#ffd76b` |

The solar-amber accent is the team-tint region: give the foundry a clear amber forge
glow — a molten seam behind the blast door and a hot core in the building — so the accent
reads from multiple angles.

## What the Foundry is (and what is yours to invent)

The foundry must read unmistakably as all of these:

- A squat, thick-walled armored bunker-forge — a heavy fortified building in the brass
  armor color (bronze on its underside and shadowed seams, sandstone masonry for secondary
  walls and trim), sitting on the ground and filling most of the width and depth. It is
  the fixed body of the foundry.
- A broad blast door set into the front of the building, filling a wide door opening, with
  a molten solar-amber forge glow showing behind it.
- A great drive flywheel — a large, round wheel (a rim with spokes to a hub) standing
  upright on the flank, its face visible from the side.
- A clear solar-amber forge accent and the palette above.

Everything else is yours to invent — the silhouette, proportions, how the bunker is massed
and detailed, how the door and its frame are shaped, how the flywheel and its axle housing
are built, and how you break the foundry into rig parts and place its joints. The test
rewards a bold, characterful design that is unmistakably the Foundry and animates
convincingly. Keep the front opening and the flank fleshed out so the door and the wheel
have something to mount to.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author the
motion). Both are decorative self-playing idles (`auto_play`) that loop continuously on
their own, with no caller. Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and interpolation so the motion carries weight.

- **`blast_door_raise`** — the heavy front blast door raises straight up, holds open for a
  beat, then settles back shut — a weighty portcullis cycle; the building holds still.
- **`flywheel_spin`** — the great flank flywheel turns a full revolution continuously and
  reads as smooth rotation with no jerk at the loop seam; the building body holds still.

You may add your own extra parts, joints, or auto-play animations on top of this; you must
produce these two animations, by these names, and must not contradict them.

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the
`scene/*.png` previews between calls to confirm the parts fit, the door sits square in
its front opening, the flywheel seats on its flank, and the animations read with weight.
Run `voxel-anim --help` for the available operations, the rig subcommands, and the
animation subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation. The recorded per-part logs and `rig.json` are
your submission.
