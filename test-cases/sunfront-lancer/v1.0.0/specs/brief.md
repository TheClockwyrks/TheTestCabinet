# Sunfront Lancer — sculpting and rigging brief

You are sculpting and rigging the Sunfront Lancer, a tall bipedal marksman-mech
carrying a long center rail-lance, as a 3D voxel model with a rig a game can pose
at runtime. Build it with `voxel-anim` by painting discrete opaque cells. There is
no target model to copy: it must read unmistakably as this long-range walker and
satisfy the animation contract below.

This brief fixes what the Lancer is and how it must move. It does not give you a
parts list, joint placements, or pose angles — working out the pieces a walking,
aiming marksman-mech needs, where they attach, and how they articulate is the test.
Invent the rig.

## How the tool works

`voxel-anim` paints discrete opaque voxel cells. You shape each part by setting and
clearing cells:

- Paint with `set-voxel`/`fill-box`/`stroke-box`/`line`/`sphere` (each an opaque
  `#rrggbb` color); a `mirror` plane can reflect your work across the centerplane.
- Global `--part <name>` selects the part an op paints; each part is its own volume,
  sculpted and previewed on its own. Create a part with `define-part` before you
  paint into it.

Build one operation at a time. A sculpting op only records — run `voxel-anim render` to
(re)draw `parts/<part>.png` and the assembled `scene/*.png` and read them between
calls, and run it before you finish so the per-part `.glb` geometry is emitted (an
unrendered part scores as empty). `voxel-anim --help` is the
contract.

## The volume and coordinate system

- The volume is **24 wide (x) × 50 tall (y) × 50 deep (z)**, in opaque voxels. It
  starts empty.
- x runs across the mech, `0`–`23`. y runs up, `0` (bottom, the ground) to `49`
  (top). z runs front-to-back, `0`–`49`.
- **Forward is +z:** the rail-lance points toward `z = 49` (the front) when the
  weapon is at rest. Up is +y.
- Build the mech symmetric about the lengthwise vertical centerplane at `x = 12`
  (between `x = 11` and `x = 12`) — the two legs mirror each other, and the body and
  rail-lance are centered on it.
- The volume is deliberately deep — most of that depth is there so the rail-lance
  can reach a long way forward from the chest.
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  mech.

## What the Sunfront Lancer is (and what is yours to invent)

The mech must read unmistakably as all of these:

- An upright body with a head on top — the fixed core of the machine, in the brass
  frame color with sandstone secondary panels.
- Two legs that carry it and walk (see the animations), each foot planting and
  lifting clear of the ground.
- A long, slender center rail-lance carried forward (+z) from the chest on the
  centerline, that aims up and down about a horizontal axis through its chest mount.
- A clear solar-amber charge-coil wrapped around the lance's shaft, so the team-tint
  accent reads from many angles.
- The palette below.

Everything else is yours to invent — the exact silhouette, proportions, how the
body and head are massed, how the legs are shaped and fold, how the lance is built,
and how you break the mech into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is
unmistakably the Lancer and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Frame — primary plating (brass) | `#c69a4b` |
| Frame — secondary panels (sandstone) | `#d9c48c` |
| Shadowed structure (dark sandstone) | `#9c8455` |
| Rail-lance, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Charge-coil accent (solar amber) | `#ff9d2e` |

Give the lance a clear amber charge-coil wrapped around its shaft, so the accent
reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name; you
author the motion with `voxel-anim define-animation` then `add-keyframe`, choosing
the period and each key's `--interp` (`constant`/`linear`/`bezier` or
`ease-in`/`ease-out`/`ease-in-out`) so the motion carries weight — legs and the
lance are heavy, so ease it rather than sliding linearly, and give a foot-plant or a
weapon recoil a sharp `ease-in` for a satisfying thump.

- **`walk`** — a game-triggered playable. The mech strides forward on its two legs
  and reads as a heavy machine pushing itself forward, not flailing: the feet plant
  on the ground and the body advances over them. Author it in place — the body stays
  centered in the volume and the clip must not translate the whole model across the
  scene; the leg cycle alone carries the stride, and a consuming game supplies the
  real forward travel. The legs move; the rail-lance holds level.
- **`fire`** — a game-triggered playable, a viewer play button so a reviewer can
  watch the lance work without dragging a slider. The rail-lance recoils about its
  chest mount: a quick recoil nod off level, an overshoot back, and a settle. Only
  the lance moves; the legs hold their stance.

You may add extra parts, joints, and animations of your own (for example a subtle
head scan); you must produce these two animations, by these names, and must not
contradict them (don't move the legs under `fire` or the lance under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the legs seat under the body and reach the ground, the
lance meets the chest, and the animations read with weight. The recorded per-part
logs and `rig.json` are your scored submission.
