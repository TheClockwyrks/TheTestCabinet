# Sunfront Lancer Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lancer Foundry**, a tall, slender
industrial spire with a **sliding rail-arm** and a **spinning focus-ring**, as a
**3D voxel model** with a **rig** a game plays at runtime. There is no target
model to copy: it must read unmistakably as this foundry tower and satisfy the
animation contract below.

This brief fixes **what the foundry is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pivots — **working out the
pieces a spire with a sliding arm and a spinning ring needs, where they attach, and
how they articulate is the test.** Invent the rig.

## The volume and coordinate system

- The volume is **44 wide (x) x 84 tall (y) x 44 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the spire, `0`-`43`. **y** runs up, `0` (bottom, the ground)
  to `83` (top). **z** runs front-to-back, `0`-`43`.
- **Forward is +z**, up is +y.
- Build the spire **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** — the shaft, rail-arm, and focus-ring are centered on
  it.
- The foundry is deliberately **tall and slender** — a narrow tower that fills
  most of the height but only the middle of the footprint, rising off the ground.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  spire (the rail-arm already set into the mid-shaft, the focus-ring already at
  the crown).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Mechanisms, rail, ring (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the spire a clear amber
energy accent — a charge-band up the shaft or a lit focus-ring core, with
solar-hot highlights — so the accent reads from multiple angles.

## What the foundry is (and what is yours to invent)

Fixed — the spire must read unmistakably as **all** of these:

- A **solid masonry base tower** in the brass and bronze colors — a footing on the
  ground (from `y = 0`) rising into a **narrow, tapering shaft** in brass and
  sandstone that runs most of the height. This base is the **fixed foundation** and
  never moves. Work an **amber charge-band or seam** up the shaft for the accent.
- A **heavy rail-arm** — an iron bracket or carriage — **set into the mid-shaft**,
  clasping the shaft and meeting it along its rail with no gap, shaped so it can ride
  **straight up and back down** along the shaft (see the animations).
- A **machined focus-ring** circling the **crown** at the top of the shaft, with a
  **solar-hot core** so it reads as an energy focus, shaped so it can **spin freely
  about the vertical axis** without detaching (see the animations).
- A clear **solar-amber accent** and the palette above.

**Everything else is yours to invent** — the exact silhouette and proportions, how
the tower is tiered and tapered, how the rail-arm and focus-ring are shaped and detail
themselves, and — the point of the test — how you break the spire into rig parts, where
you place their pivots, and how you set up the joints that make the arm slide and the
ring spin. Nothing here prescribes a shape or a rig; the test rewards a bold,
characterful design that is unmistakably the foundry and animates convincingly.

Keep the mid-shaft and crown fleshed out where the rail-arm and focus-ring mount so the
moving pieces have something to seat against, and keep the base **fixed** — only the
rail-arm and the focus-ring move.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are looping, **self-playing** idles, so the foundry cycles on
its own with no caller. Author each with `voxel-anim define-animation` then
`add-keyframe`, shaping it as an **F-curve** — set each keyframe's interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` bezier tangents) so the motion carries **weight** rather
than sliding linearly. Run `voxel-anim --help`, `voxel-anim define-animation --help`,
and `voxel-anim add-keyframe --help` for the exact flags.

- **`rail_arm_slide`** — a looping, self-playing slide. Ride the rail-arm smoothly up
  its shaft and back down, easing into the top and bottom of the stroke (ease-in-out)
  so it settles rather than snapping — a heavy carriage riding the shaft. The arm
  moves; the base holds.
- **`focus_ring_spin`** — a looping, self-playing spin. Turn the focus-ring one full,
  continuous revolution about the vertical axis at a steady pace (linear, so the spin
  never stutters). The ring turns; the base holds.

You **may add** extra parts, joints, and self-playing animations of your own (for
example a subtle idle glow or extra detail vents); you must produce these two
animations, by these names, and must not contradict them (don't move the base, and
keep each moving element to its own motion).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations' keyframes
— finishing the base tower and its footing, then the rail-arm, then the focus-ring, and
checking each part's preview and the `scene/*.png` previews as you go to confirm the
parts fit and the arm and ring seat against the shaft. Run `voxel-anim --help` for the
available operations (setting and clearing single voxels, filling and stroking boxes,
3D lines, spheres, and a mirror plane) and the rig and animation subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against this
brief. The recorded per-part logs and `rig.json` are your scored submission.
