# Sunfront Flak Foundry — sculpting and rigging brief

You are sculpting and rigging the Sunfront Flak Foundry, a tall works crowned with a
sweeping radar dish and carrying a bobbing piston, as a 3D voxel model with a rig a game
poses at runtime. There is no target model to copy: build something that reads
unmistakably as this working foundry building and runs correctly from the description
below.

This brief fixes what the Foundry is and how it must move. It deliberately does not give
you a parts list, joint placements, or pivots — working out the pieces a self-running
works needs, where they attach, and how they articulate is the test. Invent the rig.

## How the tool works

`voxel-anim` places discrete opaque cells. You paint solid material:

- Lay down cells with `set-voxel`/`fill-box` and the other cell operations (single
  voxels, filled and stroked boxes, 3D lines, spheres, and a mirror plane), each an
  opaque `#rrggbb` color; there is no transparency and no smoothing.
- Global `--part <name>` selects the part an op sculpts; each part is its own volume of
  cells, previewed on its own. Create a part with `define-part` before you sculpt into
  it.

Build one operation at a time. A sculpting op only records — run `voxel-anim render` to
(re)draw `parts/<part>.png` and the assembled `scene/*.png` and read them between
calls, and run it before you finish so the per-part `.glb` geometry is emitted (an
unrendered part scores as empty). `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **56 wide (x) × 80 tall (y) × 56 deep (z)**, in opaque voxels. It starts
  empty.
- x runs across the works, `0`–`55`. y runs up, `0` (bottom, the ground) to `79` (top).
  z runs front-to-back, `0`–`55`.
- **Forward is +z:** the piston-bearing flank faces toward `z = 55` (the front). Up is
  +y.
- Build the works symmetric left-to-right where the form allows (mirror across `x = 28`,
  between `x = 27` and `x = 28`), with the radar dish crowning the center of the top.
- The foundry is tall and blocky — a heavy masonry works rooted to the ground, filling
  most of the width and depth at its base.
- Each part is composited in these shared coordinates, where it sits on the assembled
  works.

## What the Foundry is (and what is yours to invent)

Fixed — the model must read unmistakably as all of these:

- A tall, blocky masonry works — a heavy Duneforged foundry rooted to the ground,
  filling most of the width and depth at its foundation and rising most of the height. It
  is the fixed base of the machine.
- A broad radar dish crowning the works near the top — a shallow bowl on a hub, sized to
  sweep clear around its vertical axis without striking the works below.
- A charging piston on the works' flank — a heavy iron cylinder or ram head on a shaft,
  standing proud so it reads, sized to bob straight down and back up without touching the
  works.
- A clear solar-amber energy accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, how the works is
tiered and paneled, how the dish and piston are shaped, and how you break the foundry
into rig parts and place its joints. Nothing here prescribes a shape; the test rewards a
bold, characterful design that is unmistakably the Sunfront Flak Foundry and animates
convincingly.

## Palette

Use only these opaque colors:

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Dish, piston, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the works a clear amber energy
accent — a glowing lamp at the dish hub or a piston-mount vent — so the accent reads from
multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author the
motion). Author each with `voxel-anim define-animation` then `add-keyframe`, choosing the
period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so the motion carries a weighted, eased cadence rather than
a mechanical linear slide. Both are self-playing idles — they loop continuously on their
own, with no caller — and the works body stays fixed throughout.

- **`dish_sweep`** — the crowning radar dish turns one full, smooth revolution on its own
  each loop, scanning the sky steadily and continuously with no cell tearing away from
  the crown.
- **`piston_bob`** — the flank piston drives straight down and back up on its own each
  loop, pumping with weight into the drop and the recovery rather than sliding on a flat
  linear ramp.

You may add extra parts, joints, and self-playing animations of your own (for example a
second vent, a spinning fan, or extra pipework); you must produce these two animations,
by these names, both self-playing, and must not contradict them (the works body stays
fixed — never dragged along by the dish or the piston).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the
`scene/*.png` previews between calls to confirm the parts fit, the dish sits centered on
its mast, the piston seats on its flank, and the animations read with weight. The
recorded per-part logs and `rig.json` are your submission.
