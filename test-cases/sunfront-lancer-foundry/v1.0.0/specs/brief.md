# Sunfront Lancer Foundry — sculpting and rigging brief

You are sculpting and rigging the Sunfront Lancer Foundry, a tall, slender industrial
spire with a sliding rail-arm and a spinning focus-ring, as a 3D voxel model with a rig
a game plays at runtime. There is no target model to copy: build something that reads
unmistakably as this foundry tower and runs correctly from the description below.

This brief fixes what the foundry is and how it must move. It deliberately does not give
you a parts list, joint placements, or pose angles — working out the pieces a spire with
a sliding arm and a spinning ring needs, where they attach, and how they articulate is
the test. Invent the rig.

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

- The volume is **46 wide (x) × 86 tall (y) × 46 deep (z)**, in opaque voxels. It starts
  empty.
- **x** runs across the spire, `0`–`45`. **y** runs up, `0` (bottom, the ground) to `85`
  (top). **z** runs front-to-back, `0`–`45`.
- **Forward is +z**, up is +y.
- Build the spire symmetric left-to-right where the form allows (mirror across `x = 23`,
  between `x = 22` and `x = 23`) — a narrow, tapering tower that fills most of the height
  but only the middle of the footprint, rising off the ground.
- Each part is composited in these shared coordinates, where it sits on the assembled
  spire.

## Palette

Use only these opaque colors:

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Mechanisms, rail, ring (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The solar-amber accent is the team-tint region: give the spire a clear amber energy
accent — a charge-band up the shaft or a lit focus-ring core, with solar-hot highlights —
so the accent reads from multiple angles.

## What the foundry is (and what is yours to invent)

Fixed — the spire must read unmistakably as all of these:

- A solid masonry base tower in the brass and bronze colors — a footing on the ground
  (from `y = 0`) rising into a narrow, tapering shaft in brass and sandstone that runs
  most of the height. This base is the fixed foundation and never moves. Work an amber
  charge-band or seam up the shaft for the accent.
- A heavy rail-arm — an iron bracket or carriage — set into the mid-shaft, clasping the
  shaft and meeting it with no gap, that rides straight up and back down along the shaft.
- A machined focus-ring circling the crown at the top of the shaft, with a solar-hot core
  so it reads as an energy focus, that spins about the vertical axis.
- A clear solar-amber accent and the palette above.

Everything else is yours to invent — the exact silhouette and proportions, how the tower
is tiered and tapered, how the rail-arm and focus-ring are shaped, and how you break the
spire into rig parts and place its joints. Nothing here prescribes a shape; the test
rewards a bold, characterful design that is unmistakably the foundry and animates
convincingly. Keep the mid-shaft and crown fleshed out where the rail-arm and focus-ring
mount so the moving pieces have something to seat against, and keep the base fixed — only
the rail-arm and the focus-ring move.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author the
motion). Author each with `voxel-anim define-animation` then `add-keyframe`, choosing the
period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so the motion carries weight rather than sliding linearly.
Both are self-playing idles — they loop continuously on their own, with no caller — and
the base itself stays fixed throughout.

- **`rail_arm_slide`** — the rail-arm rides smoothly up its shaft and back down each loop,
  settling into the top and bottom of the stroke like a heavy carriage. The arm moves;
  the base holds.
- **`focus_ring_spin`** — the focus-ring turns one full, continuous revolution about the
  vertical axis each loop, sweeping steadily with no cell tearing away from the crown. The
  ring turns; the base holds.

You may add extra parts, joints, and animations of your own; you must produce these two
animations, by these names, both self-playing, and must not contradict them (the base
stays fixed — never carried along by the arm or the ring).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the
`scene/*.png` previews between calls to confirm the parts fit, the rail-arm sets into the
mid-shaft, the focus-ring seats on the crown, and the animations read with weight. The
recorded per-part logs and `rig.json` are your submission.
