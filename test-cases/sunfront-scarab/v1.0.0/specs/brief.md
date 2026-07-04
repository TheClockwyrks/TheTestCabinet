# Sunfront Scarab — sculpting and rigging brief

You are sculpting and rigging the Sunfront Scarab, a low, wide four-legged war-beetle
with snapping front mandibles, as a 3D voxel model with a small rig a game can pose at
runtime. Build it with `voxel-anim` (painting opaque cells one operation at a time) as
a rigged model that reads unmistakably as this scuttling beetle machine, walks
believably on its legs, and snaps its jaws on demand. There is no target model to copy.

This test measures creativity and craft, not instruction-following. The brief fixes
what the Scarab is and how it must move; it deliberately does not hand you a parts list,
joint placements, or pose angles — working out the pieces a walking, biting beetle
needs, where they attach, and how they articulate is the test. Invent the rig.

## The volume and coordinate system

- The volume is **26 wide (x) × 12 tall (y) × 30 deep (z)**, in opaque voxels. It
  starts empty.
- x runs across the beetle, `0`–`25`. y runs up, `0` (bottom, the ground) to `11`
  (top). z runs front-to-back, `0`–`29`.
- Forward is +z: the head and mandibles point toward `z = 29` (the front) when the jaws
  are at rest. Up is +y.
- Build the beetle symmetric about the lengthwise vertical centerplane between `x = 12`
  and `x = 13` — the four legs mirror left/right, and the body and mandibles are
  centered on it.
- The beetle is deliberately low and wide — a fast, ground-hugging swarm bug, not a
  tall one. It fills most of the length and width, riding a little way up off the
  ground on its legs.
- Each part is sculpted separately with `voxel-anim --part <name>`, in this same
  volume's coordinates, positioned where the part sits on the assembled beetle (a leg
  already under its corner, the mandibles already out at the head).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Shell — primary plating (brass) | `#c69a4b` |
| Shell — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, mandibles, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Eye-cluster accent (solar amber) | `#ff9d2e` |

Give the beetle a clear solar-amber eye-cluster on the head, above and between the
mandibles, so the accent reads from multiple angles.

## What the Scarab is (and what is yours to invent)

Fixed — the beetle must read unmistakably as all of these:

- A low, wide domed carapace body — the brass shell (bronze on its underside and in the
  shadowed seams), riding raised off the ground and running most of the length and
  width, with a head at the front carrying the solar-amber eye-cluster above the jaw
  line.
- Four legs, one at each corner, in the iron color, that carry the beetle and walk (see
  the animations).
- A pair of snapping mandibles in the iron color projecting forward (+z) from the head,
  meeting the head at the mount with no gap, that swing open and shut on demand.

Everything else is yours to invent — the exact silhouette and proportions of the
carapace, the number of segments and joints in each leg, where the mandible hinge sits,
and how you break the beetle into rig parts. Nothing here prescribes a shape; the test
rewards a bold, characterful design that is unmistakably the Scarab and animates
convincingly.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author
the motion). Author each with `voxel-anim define-animation` then `add-keyframe`,
choosing the period and each key's `--interp` (`constant`/`linear`/`bezier` or
`ease-in`/`ease-out`/`ease-in-out`, with optional `--in-handle`/`--out-handle`) so the
motion carries weight — legs are heavy, so ease them rather than sliding linearly.

- **`walk`** — the walk (a game-triggered playable, `loop = true`). The feet plant flat
  on the ground and the beetle scuttles over them so it reads as a beetle pushing itself
  forward, not flailing. Authored in place: the body does not translate across the scene
  — the leg cycle alone carries the stride (played on its own the planted foot slides
  straight back under the body, treadmill-style, then swings forward), and a game
  supplies the real travel. The legs move; the jaws hold shut.
- **`bite`** — the weapon showcase (a game-triggered playable, `loop = true`). The front
  mandibles snap wide open, then shut, and hold shut before looping — a fast snap open,
  a firm close — so a reviewer can watch the jaws work. It touches no leg — the legs
  stay planted.

You may add your own extra parts, joints, or animations on top of this (for example a
subtle antenna twitch), but you must not drop or contradict the required `walk` and
`bite` animations, by those names.

## Working the tool

The only way to place a voxel and edit the rig is the `voxel-anim` binary already on
your `PATH`. Define your own parts with `define-part` (giving each a parent and a
pivot), sculpt each up in sensible layers by selecting it with `--part <name>`, set
pivots with `set-pivot`, place joints with `define-joint`, and author the two
animations' keyframes with `define-animation`/`add-keyframe`. Run `voxel-anim --help`
for the available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane), the rig subcommands, and the animation
subcommands, and `voxel-anim <operation> --help` for each one's exact flags. Call
`voxel-anim` once per operation and read `parts/<part>.png` (and the assembled
`scene/*.png` previews) between calls to judge each part against this brief — that each
leg's chain seats under its own corner of the body, the mandibles meet the head, and
the animations read with weight.
