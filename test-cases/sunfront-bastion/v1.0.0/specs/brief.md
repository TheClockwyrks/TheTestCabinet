# Sunfront Bastion — sculpting and rigging brief

You are sculpting and rigging the Sunfront Bastion, a huge fortified keep with a
rotating solar collector crown, a raising gate, and a slowly turning beacon, as a 3D
voxel model with a rig a game runs at runtime. There is no target model to copy: build
something that reads unmistakably as this imposing fortress and runs correctly from the
description below. This is the biggest, most detailed building of its set — spend the
volume on it.

This brief fixes what the Bastion is and how it must move. It deliberately does not give
you a parts list, joint placements, or pose angles — working out the pieces a keep whose
crown spins, gate raises, and beacon sweeps needs, where they attach, and how they
articulate is the test. Invent the rig.

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

- The volume is **90 wide (x) × 120 tall (y) × 90 deep (z)**, in opaque voxels. It
  starts empty.
- **x** runs across the keep, `0`–`89`. **y** runs up, `0` (bottom, the ground) to `119`
  (top). **z** runs front-to-back, `0`–`89`.
- **Forward is +z:** the gated front wall faces toward `z = 89` (the front). Up is +y.
- Build the keep symmetric left-to-right where the form allows (mirror across `x = 45`,
  between `x = 44` and `x = 45`), massive and blocky — a heavy masonry fortress rooted to
  the ground, filling most of the width and depth at its base and rising to a walled
  summit.
- Each part is composited in these shared coordinates, where it sits on the assembled
  keep.

## What the Bastion is (and what is yours to invent)

Fixed — the fortress must read unmistakably as all of these:

- A massive, heavily detailed masonry keep — thick ramparts and corner towers rising to
  a walled summit, with a central spire — not a plain box, and plainly the biggest, most
  detailed building of the roster.
- A gated front wall: a clear opening in the front wall holds the gate.
- A solar collector crown ringing the keep's summit, standing proud of the walls, that
  rotates on its own.
- A signal beacon crowning the central spire that sweeps slowly on its own.
- A clear solar-amber energy accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, how the ramparts
and towers are massed, how the spire rises, how the crown, gate, and beacon are shaped,
and how you break the keep into rig parts and place its joints. Nothing here prescribes a
shape; the test rewards a bold, characterful design that is unmistakably the Sunfront
Bastion and animates convincingly. Leave the children something to seat against — an
opening in the front wall for the gate, a ring at the summit for the crown, and a spire
top for the beacon — so they meet the keep with no gap.

## Palette

Use only these opaque colors:

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Crown, gate, beacon, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The solar-amber accent is the team-tint region: give the bastion a clear amber energy
accent — a glowing collector ring, a lit beacon lens, and a charged gate seam — so the
accent reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with three required animation declarations by name (you author
the motion). Author each with `voxel-anim define-animation` then `add-keyframe`, choosing
the period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so the motion carries an eased, deliberate cadence rather
than a mechanical linear slide. All three are self-playing idles — they loop continuously
on their own, with no caller — and the keep itself stays fixed throughout.

- **`crown_spin`** — the collector crown turns one full, smooth revolution on its own
  each loop, sweeping steadily and continuously with no cell tearing away from the
  summit.
- **`gate_raise`** — the front gate lifts straight up within the wall opening, holds
  open, then lowers back down each loop, with weight into the lift and the settle.
- **`beacon_spin`** — the beacon atop the central spire turns one slow full revolution on
  its own each loop, sweeping steadily with no cell tearing away from the spire.

You may add extra parts, joints, and animations of your own; you must produce these three
animations, by these names, all self-playing, and must not contradict them (the keep base
stays fixed — never carried along by the crown, gate, or beacon).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the three animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the
`scene/*.png` previews between calls to confirm the parts fit, the crown rings the
summit, the gate seats in the front wall, the beacon stands on the spire, and the
animations read with weight. The recorded per-part logs and `rig.json` are your
submission.
