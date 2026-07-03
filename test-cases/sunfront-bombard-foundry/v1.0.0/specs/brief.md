# Sunfront Bombard Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bombard Foundry**, a heavy
mortar-works with a **swinging overhead crane arm** and a **bobbing loading
piston**, as a **3D voxel model** with a small **rig** a game runs at runtime.
There is no target model to copy: it must read unmistakably as this working
foundry building and satisfy the animation contract below.

This brief fixes **what the Foundry is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working
out the pieces a swinging, bobbing mortar-works needs, where they attach, and how
they articulate is the test.** Invent the rig.

## How the tool works

`voxel-anim` paints **discrete opaque cells** — you build each part's geometry by
setting and clearing voxels:

- Place cells with `set-voxel`/`fill-box`/`stroke-box`/lines/spheres and clear them
  with the corresponding clear op (each cell an opaque `#rrggbb` color); a mirror
  plane helps you keep the works symmetric.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its own
  model**, previewed on its own. Create a part with `define-part` before you sculpt
  into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **60 wide (x) × 68 tall (y) × 60 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the works, `0`–`59`. **y** runs up, `0` (bottom, the ground)
  to `67` (top). **z** runs front-to-back, `0`–`59`.
- **Forward is +z:** the crane arm reaches out and the piston flank face toward
  `z = 59` (the front). Up is +y.
- Build the works **symmetric about the lengthwise vertical centerplane** where the
  form allows.
- The foundry is deliberately **heavy and blocky** — a squat masonry mortar-works
  rooted to the ground, filling most of the width and depth at its base.
- Each part is sculpted in these shared coordinates, positioned where it sits on the
  assembled works.

## What the Foundry is (and what is yours to invent)

Fixed — the works must read unmistakably as **all** of these:

- A **heavy, blocky masonry mortar-works** — a squat, rooted foundry building
  (not an abstract stack of boxes), filling most of the width and depth at its base
  and rising most of the height.
- An **overhead crane arm** cantilevered off the **top** of the works, standing
  proud over it and reaching **forward**, that **swings** fore and aft (see the
  animations).
- A **loading piston** riding in the works' **flank** that **bobs** straight down
  and back up on its own (see the animations).
- A clear **solar-amber energy accent** — a glowing forge-mouth or loading vent at
  the piston flank — and the palette below.

**Everything else is yours to invent** — the exact silhouette and proportions, how
the works is massed and tiered, how the crane arm and piston are shaped and mounted,
and how you break the foundry into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is
unmistakably the Foundry and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Crane, piston, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** accent — a glowing forge-mouth or loading vent at the
piston flank — so it reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are **self-playing idles** (`auto_play` — they play
continuously on their own, with no caller). Author each with `voxel-anim
define-animation` then `add-keyframe`, choosing the period and setting each key's
`--interp` (`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`,
with optional `--in-handle`/`--out-handle`) so motion **carries weight** — the
crane arm and piston are heavy, so ease the motion rather than sliding linearly,
and give the piston's landing a sharp `ease-in` for a satisfying stamp.

- **`crane_swing`** — the crane arm's SWEEP (a self-playing idle). The heavy
  overhead crane arm **eases** aft, swings **fore**, and eases back, settling into
  each turn rather than snapping — a weighty pendulum swing, not a constant-speed
  slide. The crane arm swings about its shoulder mount without any voxel tearing
  away or clipping the works; the works body holds still.
- **`piston_bob`** — the loading piston's STAMP (a self-playing idle). The piston
  **drops** from rest to the bottom of its stroke and **rises** back up, with an
  `ease-in` into the bottom so it lands with a stamp, then eases back up and loops
  with no jerk at the seam. The piston slides straight down and up in its bay
  without tearing away or clipping the bay walls; the works body holds still.

You **may add** extra parts, joints, and auto-play animations of your own (for
example a second piston, a puff vent, or extra pipework); you must produce these
two animations, by these names, and must not contradict them (the works body itself
must not ride along with the crane arm or the piston).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the crane arm cantilevers off the top and the piston
seats in its flank, and the animations read with weight. Run `voxel-anim --help`
for the available operations (setting and clearing single voxels, filling and
stroking boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. The recorded per-part
logs and `rig.json` are your scored submission.
