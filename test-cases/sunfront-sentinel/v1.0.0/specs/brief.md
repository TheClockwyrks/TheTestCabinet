# Sunfront Sentinel — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Sentinel**, an upright **bipedal
war-mech** that strides on **two legs** and carries a **rifle on its right arm** —
built with **`voxel-anim`** by painting **discrete opaque cells** into a **rigged
3D model** a game poses at runtime. There is no target model to copy: it must read
unmistakably as the Sentinel and satisfy the animation contract below.

This brief fixes **what the Sentinel is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working
out the pieces a walking, firing mech needs, where they attach, and how they
articulate is the test.** Invent the rig.

## How the tool works

`voxel-anim` places **discrete opaque cubes** — there is no transparency and no
smoothing. Each part's geometry is a solid block of cells you build up:

- **Paint** cells with `set-voxel`/`fill-box`/`stroke-box`/`line`/`sphere` (and a
  `mirror` plane), each taking an opaque `#rrggbb` color; **clear** cells to carve.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its
  own body**, sculpted and previewed on its own. Create a part with `define-part`
  before you sculpt into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **44 wide (x) × 64 tall (y) × 40 deep (z)**, in opaque voxels. It
  starts **empty**; cell coordinates are grid positions in this volume.
- **x** runs across the mech, `0`–`43`. **y** runs up, `0` (bottom, the ground)
  to `63` (top of the head). **z** runs front-to-back, `0`–`39`.
- **Forward is +z:** the mech faces toward `z = 39` (the front), and the rifle
  points that way when it is level. Up is +y.
- Build the mech **roughly symmetric left-to-right**, **tall and upright** — a
  backbone ranged trooper standing on two legs, filling most of the height, with
  the body and head stacked above the hips (the right-arm rifle deliberately breaks
  that symmetry).
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  mech.

## What the Sentinel is (and what is yours to invent)

Fixed — the mech must read unmistakably as **all** of these:

- An **upright bipedal body** with a **head** on top — the fixed core of the
  machine, not carried along by anything else.
- **Two legs** that carry it and **walk** (see the animations).
- A **rifle carried on the right arm** that projects **forward** and **aims up and
  down** about its shoulder mount.
- A clear **solar-amber visor** across the head, and the palette below.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
body is shaped, the design of the legs, how the rifle and arm are built, and how you
break the mech into rig parts and place its joints. Nothing here prescribes a shape;
the test rewards a bold, characterful design that is unmistakably the Sentinel and
animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Body — primary plating (brass) | `#c69a4b` |
| Dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels (sandstone) | `#d9c48c` |
| Rifle, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Visor accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** accent — a **visor across the head** — so it reads from
multiple angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the
legs read as a **machine pushing itself forward**, not flailing. To get there you
will almost certainly need each leg to be an **articulated chain** — more than one
segment and more than one joint — because a single rigid leg swung from one pivot
cannot both lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip
  directly above its **own** foot. Do **not** hang both feet on one shared pivot —
  rotating that pivot drives one foot down through the ground while the other lifts.
- **A planted stance.** Each leg must have a phase where its foot is **flat and
  still on the ground** while the body travels forward over it, then lifts, swings
  forward, and plants again. A foot that is in a continuous arc the whole time —
  never still on the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel.
  This is the subtle part: a joint angle is applied **relative to its parent
  segment**, so holding the foot flat in the *world* means the ankle must
  **counter-rotate against the combined rotation of the hip and knee above it** —
  not just sit at a fixed local angle. Design the ankle with enough range to cancel
  that accumulated rotation across the whole cycle.
- **Bend the knee the right way.** Rest the leg as a **clearly bent** chain (not a
  straight column — a straight leg has no room to fold and extend), and bend the
  knee the way a heavy walker's does (a reverse/digitigrade knee). If it bends
  inside-out, fix the sign of the motion.
- **Phase the legs** in **opposite** phase (a half period apart) so the mech is
  always supported — never both feet lifting at once.

Design guidance on believable walker legs and gaits lives in the docs
([Rigging and animating walkers](../../../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md));
note that the example angles there are given in **world space** and are
illustrative — you must translate them into your own rig's joints, accounting for
how each segment is attached.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so motion **carries weight** — legs and the rifle are
heavy, so ease the motion rather than sliding linearly, and give a foot-plant or a
gun recoil a sharp `ease-in` for a satisfying thump.

- **`walk`** — the WALK (a game-triggered playable). Strides the mech forward on
  its two legs with the planted-stance gait described above: feet plant flat and
  still, then lift, swing, and plant, the legs in opposite phase. Author it **in
  place** — the body stays centered in the volume and the clip must **not** translate
  the whole model across the scene; the leg cycle alone carries the stride (played on
  its own, the planted foot slides straight back under the body, treadmill-style,
  then swings forward), and a consuming game supplies the real forward travel. The
  legs move; the rifle holds.
- **`fire`** — the WEAPON showcase (a game-triggered playable). Snaps the right-arm
  rifle into a quick recoil nod — aiming up and down about its shoulder mount — and
  settles, while the mech stands its ground and the legs stay planted.

You **may add** extra parts, joints, and animations of your own; you must produce
these two animations, by these names, and must not contradict them (e.g. don't move
the legs under `fire` or the rifle under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the legs seat under the body and reach the ground, the
rifle meets the right shoulder, and the animations read with weight. The recorded
per-part logs and `rig.json` are your scored submission.
