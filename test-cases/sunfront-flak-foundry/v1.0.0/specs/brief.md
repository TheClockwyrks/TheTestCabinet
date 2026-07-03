# Sunfront Flak Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Flak Foundry**, a tall works crowned
with a sweeping radar dish and carrying a bobbing piston, as a **3D voxel model**
with a small **rig** a game can pose at runtime. There is no target model to copy:
build something that reads unmistakably as this working foundry building and runs
correctly from the description below.

This brief fixes **what the Foundry is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pivots — **working out the
pieces a self-running works needs, where they attach, and how they articulate is the
test.** Invent the rig.

## The volume and coordinate system

- The volume is **56 wide (x) x 76 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the works, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `75` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the piston-bearing flank faces toward `z = 55` (the front).
  Up is +y.
- Build the works **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** where the form allows, with the radar dish crowning the
  center of the top.
- The foundry is deliberately **tall and blocky** — a heavy masonry works rooted
  to the ground, filling most of the width and depth at its base.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled works.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Dish, piston, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the works a clear amber
**energy accent** — a glowing lamp at the dish hub or a piston-mount vent — so
the accent reads from multiple angles.

## What the Foundry is (and what is yours to invent)

Fixed — the model must read unmistakably as **all** of these:

- A **tall, blocky masonry works** — a heavy Duneforged foundry rooted to the
  ground, filling most of the width and depth at its foundation and rising most of
  the height. It is the **fixed base** of the machine.
- A **broad radar dish** crowning the works near the top — a shallow bowl on a hub,
  sized to **sweep clear around its vertical axis** without striking the works
  below.
- A **charging piston** on the works' flank — a heavy iron cylinder or ram head on a
  shaft, standing proud so it reads, sized to **bob straight down and back up**
  without touching the works.
- A clear **solar-amber energy accent** and the palette above.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
works is tiered and paneled, how the dish and piston are shaped, and how you break
the foundry into rig parts and place its joints. Nothing here prescribes a shape or a
skeleton; the test rewards a bold, characterful design that is unmistakably the
Sunfront Flak Foundry and animates convincingly.

## The required animations — the fixed contract

Both animated elements **run on their own** — each is a decorative **self-playing**
idle you author, so the foundry cycles continuously with no caller. `rig.json` is
pre-seeded with **two required animation declarations** by name (you author the
motion). Author each with `voxel-anim define-animation` then `add-keyframe`, choosing
the period and setting each key's interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` Bézier tangents) so motion **carries weight** — the dish
and piston are heavy iron, so ease the motion rather than sliding linearly, and give
the piston's drop and its recovery a satisfying, weighted cadence.

- **`dish_sweep`** — the radar sweep (a self-playing idle). Turns the crowning radar
  dish one full, smooth revolution about its vertical axis across the loop, so it
  scans the sky steadily and continuously on its own. The dish moves; the works body
  holds.
- **`piston_bob`** — the piston pump (a self-playing idle). Drives the flank piston
  straight down and back up on its own each loop, with weight into the drop and the
  recovery — the piston pumps rather than sliding on a flat linear ramp. The piston
  moves; the works body holds.

Define your parts with `define-part`, set pivots with `set-pivot`, and place the
joints these two animations drive with `define-joint` — a rotation about the vertical
axis for the dish and a vertical translation for the piston — then author both
animations' keyframes. You **may add** extra parts, joints, and self-playing
animations of your own (for example a second vent, a spinning fan, or extra
pipework); you must produce these two animations, by these names, and must not
contradict them (e.g. don't drag the works body under either one).

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the works body and its dish mast, then the dish, then the piston, checking each
part's preview and the assembled `scene/*.png` previews as you go to confirm the
parts fit, the dish sits centered on its mast, and the piston seats on its flank.
Define the parts, pivots, joints, and the two animations through the tool's rig and
animation subcommands, then **author each required animation's F-curves** with
`define-animation` and `add-keyframe`. Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D lines,
spheres, and a mirror plane), the rig subcommands, and the animation subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` between calls to judge each part against
this brief.
