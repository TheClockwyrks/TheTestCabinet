# Sunfront Flakhound — sculpting-and-rigging brief

You are sculpting and rigging the **Sunfront Flakhound**, a **four-legged anti-air
walker** that strides on **legs** — a squat armored platform carrying a
**traversing back turret** and **twin elevating flak barrels** it aims at the sky.
Build it with **`voxel-anim`** (each part painted as **discrete opaque cells**) as a
**rigged 3D model** a game poses at runtime. There is no target model to copy: it
must read unmistakably as the Flakhound and satisfy the animation contract below.

This brief fixes **what the Flakhound is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working out
the pieces a walking, target-tracking anti-air platform needs, where they attach, and
how they articulate is the test.** Invent the rig.

## How the tool works (this is a cube tool)

`voxel-anim` paints **discrete opaque voxel cells** — it is not a mesh or SDF tool.
Each part's geometry is a solid of painted cells you build up op by op:

- **Set/clear** single voxels, **fill/stroke** boxes, draw **3D lines** and
  **spheres**, and **mirror** across a plane — each voxel an opaque `#rrggbb` color
  (there is no transparency).
- Global **`--part <name>`** selects the part an op sculpts; **each part is its own
  volume**, previewed on its own. Create a part with `define-part` before you sculpt
  into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is the
contract.

## The volume and coordinate system

- The volume is **52 wide (x) × 48 tall (y) × 56 deep (z)**, in opaque voxels,
  starting **empty**.
- **x** runs across the walker, `0`–`51`. **y** runs up, `0` (bottom, the ground) to
  `47` (top). **z** runs front-to-back, `0`–`55`. **Forward is +z:** the walker faces
  toward `z = 55`, and the barrels point that way when the turret is at rest.
- Build it roughly **symmetric left-to-right** — a squat, sturdy striding platform: a
  compact armored body carried on its legs, with the turret raised on its back so the
  barrels clear the body.
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  walker.

## What the Flakhound is (and what is yours to invent)

Fixed — the walker must read unmistakably as **all** of these:

- A **squat, compact armored body** — the fixed core of the machine — riding
  **raised off the ground on legs**.
- **Four legs** (one at each corner) that carry it and **walk** (see the animations).
- A **turret up on its back** that **traverses** to swing onto a bearing.
- **Twin flak barrels** on that turret, raked **upward** toward the sky, that
  **elevate** to track a target.
- A clear **solar-amber targeting eye** on the turret, facing forward between the
  barrels, and the palette below.

**Everything else is yours to invent** — the exact silhouette, proportions, number of
segments in each leg and how it folds, how the body is massed, how the turret and
barrels are shaped, and how you break the walker into rig parts and place its joints.
Nothing here prescribes a shape; the test rewards a bold, characterful design that is
unmistakably the Flakhound and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Body — primary plating (brass) | `#c69a4b` |
| Body — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, turret, flak barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Targeting-eye accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** targeting eye on the turret, facing forward between the
barrels, so the accent reads from many angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the legs
read as a **machine pushing itself forward**, not flailing. To get there you will
almost certainly need each leg to be an **articulated chain** — more than one segment
and more than one joint — because a single rigid leg swung from one pivot cannot both
lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip directly
  above its **own** foot. Do **not** hang a fore-and-aft row of feet on one shared
  pivot — rotating that bank drives the rear feet down through the ground while the
  front feet lift.
- **A planted stance.** Every leg must have a phase where its foot is **flat and still
  on the ground** while the body travels forward over it, then lifts, swings forward,
  and plants again. A foot that is in a continuous arc the whole time — never still on
  the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel. This
  is the subtle part: a joint angle is applied **relative to its parent segment**, so
  holding the foot flat in the *world* means the ankle must **counter-rotate against
  the combined rotation of the hip and knee above it** — not just sit at a fixed local
  angle. Design the ankle with enough range to cancel that accumulated rotation across
  the whole cycle.
- **Bend the knee the right way.** Rest the leg as a **clearly bent** chain (not a
  straight column — a straight leg has no room to fold and extend), and bend the knee
  the way a beast-like walker's does (a reverse/digitigrade knee, folding the shin
  rearward). If it bends inside-out when the walk plays, fix the sign of the motion.
- **Phase the legs** so the machine is always supported — for four legs, step them as
  **diagonal pairs** — never all feet lifting at once.

Design guidance on believable walker legs and gaits lives in the docs
([Rigging and animating walkers](../../../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md));
note that the example angles there are given in **world space** and are illustrative —
you must translate them into your own rig's joints, accounting for how each segment is
attached.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Author each with `voxel-anim define-animation` then `add-keyframe`,
choosing the period and setting each key's `--interp` (`constant`/`linear`/`bezier` or
`ease-in`/`ease-out`/`ease-in-out`, with optional `--in-handle`/`--out-handle`) so
motion **carries weight** — legs and barrels are heavy, so ease the motion rather than
sliding linearly, and give a foot-plant a sharp `ease-in` for a satisfying thump.

- **`walk`** — the WALK (a game-triggered playable). Strides the walker forward on its
  legs with the planted-stance gait described above: feet plant flat and still, then
  lift, swing, and plant. Step the four legs as diagonal pairs. Author it **in
  place** — the body stays centered in the volume and the clip must **not**
  translate the whole model across the scene; the leg cycle alone carries the stride
  (played on its own, the planted foot slides straight back under the body,
  treadmill-style, then swings forward), and a consuming game supplies the real
  forward travel. The legs move; the turret and barrels hold at rest.
- **`flak_track`** — the WEAPON showcase (a game-triggered playable). Traverses the
  turret onto a bearing and elevates and depresses the twin barrels to track a target
  across the sky, while the walker stands its ground — the legs stay planted. Use eased
  curves so the traverse slows and reverses smoothly at the extremes rather than
  snapping.

You **may add** extra parts, joints, and animations of your own; you must produce these
two animations, by these names, and must not contradict them (e.g. don't move the legs
under `flak_track` or the weapon under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations' keyframes
— reading `parts/<part>.png` and the `scene/*.png` previews between calls to confirm
the parts fit, the legs seat under the body and reach the ground, the turret sits on
the back and the barrels meet its front, and the animations read with weight. Run
`voxel-anim --help` for the available operations (setting and clearing single voxels,
filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the rig and
animation subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
The recorded per-part logs and `rig.json` are your scored submission.
