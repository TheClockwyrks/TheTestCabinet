# Sunfront Sentinel Foundry — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Sentinel Foundry**, a tall assembly
tower with a hammering stamping press and a turning drive gear, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: it must read unmistakably as this working foundry building and satisfy the
animation contract below.

This brief fixes **what the Foundry is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pivots — **working out the
pieces a hammering, spinning foundry needs, where they attach, and how they
articulate is the test.** Invent the rig.

## How the tool works (paint cells, one op at a time)

`voxel-anim` places **discrete opaque cells**. You build each part by painting cells
into it:

- **Set and clear** single voxels, **fill** and **stroke** boxes, draw **3D lines**
  and **spheres**, and use a **mirror** plane — each op takes an opaque `#rrggbb`
  color. There is no transparency.
- Global **`--part <name>`** selects the part an op paints; **each part is its own
  volume**, previewed on its own. Create a part with `define-part` before you paint
  into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is the
contract.

## The volume and coordinate system

- The volume is **56 wide (x) x 72 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the tower, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `71` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the gear-bearing flank and press throat face toward
  `z = 55` (the front). Up is +y.
- Build the tower **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** where the form allows, with the press centered in its
  throat.
- The foundry is deliberately **tall and blocky** — a heavy masonry assembly
  tower rooted to the ground, filling most of the width and depth at its base.
- Each part is sculpted in these shared coordinates, positioned where it sits on the
  assembled tower.

## What the Foundry is (and what is yours to invent)

Fixed — the foundry must read unmistakably as **all** of these:

- A **tall, blocky masonry tower** — a heavy assembly stronghold rooted to the
  ground, filling most of the width and depth at its foundation and rising most of
  the height, **not a plain box**.
- A **throat** opened up the tower's center for the **stamping press** to hammer in.
- A heavy **stamping press head** riding in that throat, sized to hammer straight
  down and back up without touching the throat walls.
- A **toothed drive gear** (a disc with teeth around its rim) mounted **on the
  flank**, standing proud so its teeth read, turning cleanly about its hub.
- A clear **solar-amber energy accent** — a glowing forge-mouth or vent at the press
  throat — set so it reads from many angles.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
tower is massed and tiered, how the throat is cut, how the press and gear are shaped,
and how you break the foundry into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is unmistakably
the Foundry and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Press, gear, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the foundry a clear amber
**energy accent** — a glowing forge-mouth or vent at the press throat — so the
accent reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are **self-playing** and **looping**, so the foundry runs
continuously on its own with no caller. Author each with `voxel-anim
define-animation` then `add-keyframe`, choosing the period and setting each key's
`--interp` (`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with
optional `--in-handle`/`--out-handle`) so motion **carries weight** — the press is
heavy iron, so ease it rather than sliding linearly, and give the bottom of the stamp
a sharp `ease-in` for a satisfying thump.

- **`piston_stamp`** — the STAMPING PRESS (a self-playing idle). Hammers the press
  head straight **down** to the bottom of its stroke and eases back **up** to rest,
  once per loop, riding in the tower's throat without touching its walls. Give it a
  weighty hammer — `ease-in` into the bottom of the stamp so it lands with a thump,
  then `ease-out` back up — rather than a constant-speed glide.
- **`gear_spin`** — the DRIVE GEAR (a self-playing idle). Turns the drive gear a
  **full revolution** continuously and loops seamlessly, at a steady rate, so the
  gear reads as a driven flywheel.

You **may add** extra parts, joints, and self-playing animations of your own (for
example a second gear, a puff vent, or extra pipework); you must produce these two
animations, by these names, and must not contradict them — the tower itself never
moves; only the press and the gear do.

## Working the tool

Define your parts with `define-part`, paint each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls to
confirm the parts fit, the press rides centered in the throat, the gear seats on the
flank, and the animations read with weight. The recorded per-part logs and `rig.json`
are your scored submission. Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines, spheres,
and a mirror plane), the rig subcommands, and the animation subcommands, and
`voxel-anim <operation> --help` for each one's exact flags.
