# Sunfront Lancer — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Lancer**, a tall bipedal
marksman-mech carrying a long center rail-lance, as a **3D voxel model** with a
small **rig** a game can pose at runtime. Build it with **`voxel-anim`** (painting
discrete opaque cells). There is no target model to copy: it must read
unmistakably as this long-range walker and satisfy the animation contract below.

This brief fixes **what the Lancer is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working
out the pieces a walking, aiming marksman-mech needs, where they attach, and how
they articulate is the test.** Invent the rig.

## How the tool works (this is a cube tool)

`voxel-anim` paints **discrete opaque voxel cells** — not a mesh, not a
signed-distance field. You shape each part by setting and clearing cells:

- **Paint** with `set-voxel`/`fill-box`/`stroke-box`/`line`/`sphere` (each an
  opaque `#rrggbb` color); a **mirror** plane can reflect your work across the
  centerplane.
- Global **`--part <name>`** selects the part an op paints; **each part is its own
  volume**, sculpted and previewed on its own. Create a part with `define-part`
  before you paint into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **44 wide (x) × 64 tall (y) × 64 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`–`43`. **y** runs up, `0` (bottom, the ground)
  to `63` (top). **z** runs front-to-back, `0`–`63`.
- **Forward is +z:** the rail-lance points toward `z = 63` (the front) when the
  weapon is at rest. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 21` and `x = 22`** — the two legs mirror each other, and the body and
  rail-lance are centered on it.
- The volume is deliberately **deep** — most of that depth is there so the
  rail-lance can reach a long way forward from the chest.
- Each part is sculpted in these shared coordinates, where it sits on the
  assembled mech.

## What the Sunfront Lancer is (and what is yours to invent)

Fixed — the mech must read unmistakably as **all** of these:

- An **upright body** with a **head** on top — the fixed core of the machine, in
  the brass frame color with sandstone secondary panels.
- **Two legs** that carry it and **walk** (see the animations), each foot planting
  flat and lifting clear of the ground.
- A **long, slender center rail-lance** carried **forward (+z)** from the chest on
  the centerline, that **aims up and down** about a horizontal axis through its
  chest mount.
- A clear **solar-amber charge-coil** wrapped around the lance's shaft, so the
  team-tint accent reads from many angles.
- The palette below.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
body and head are massed, how many segments each leg has and how they fold, how the
lance is shaped, and how you break the mech into rig parts and place its joints.
Nothing here prescribes a shape; the test rewards a bold, characterful design that
is unmistakably the Lancer and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Frame — primary plating (brass) | `#c69a4b` |
| Frame — secondary panels (sandstone) | `#d9c48c` |
| Shadowed structure (dark sandstone) | `#9c8455` |
| Rail-lance, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Charge-coil accent (solar amber) | `#ff9d2e` |

Give the lance a clear amber **charge-coil** wrapped around its shaft, so the
accent reads from multiple angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the
legs read as a **heavy machine pushing itself forward**, not flailing. To get
there you will almost certainly need each leg to be an **articulated chain** —
more than one segment and more than one joint — because a single rigid leg swung
from one pivot cannot both lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip directly
  above its **own** foot (x and z held constant down each chain, only y descending).
  Do **not** hang the two feet on one shared pivot that would drag a foot through
  the ground as the mech strides.
- **A planted stance.** Each leg must have a phase where its foot is **flat and
  still on the ground** while the body travels forward over it, then lifts, swings
  forward, and plants again. A foot that is in a continuous arc the whole time —
  never still on the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel.
  This is the subtle part: a joint angle is applied **relative to its parent
  segment**, so holding the foot flat in the *world* means the ankle must
  **counter-rotate against the combined rotation of the hip and knee above it** —
  not just sit at a fixed local angle. Design the ankle with enough range to
  cancel that accumulated rotation across the whole cycle.
- **Bend the knee the right way.** Rest each leg as a **clearly bent** chain (not
  a straight column — a straight leg has no room to fold and extend), and bend the
  knee the way a heavy walker's does (a reverse/digitigrade knee). If it bends
  inside-out, fix the sign of the motion.
- **Phase the two legs in opposite phase** (a half cycle apart) so one foot is
  always planted and the mech is always supported — never both feet lifting at
  once.

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
`--in-handle`/`--out-handle`) so motion **carries weight** — legs and the lance are
heavy, so ease the motion rather than sliding linearly, and give a foot-plant or a
weapon recoil a sharp `ease-in` for a satisfying thump.

- **`walk`** — the WALK (a game-triggered playable). Strides the mech forward on
  its two legs with the planted-stance gait described above: each foot plants flat
  and still, then lifts, swings, and plants, the two legs in **opposite phase** so
  one foot is always down. Author it **in place** — the body stays centered in the
  volume and the clip must **not** translate the whole model across the scene; the
  leg cycle alone carries the stride (played on its own, the planted foot slides
  straight back under the body, treadmill-style, then swings forward), and a
  consuming game supplies the real forward travel. The legs move; the rail-lance
  holds level.
- **`fire`** — the WEAPON showcase (a game-triggered playable, a viewer play button
  so a reviewer can watch the lance work without dragging a slider). Recoils the
  rail-lance about its chest mount: a quick recoil nod off level, an overshoot back,
  and a settle. Only the lance moves; the legs hold their stance.

You **may add** extra parts, joints, and animations of your own (for example a
subtle head scan); you must produce these two animations, by these names, and must
not contradict them (e.g. don't move the legs under `fire` or the lance under
`walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the legs seat under the body and reach the ground, the
lance meets the chest, and the animations read with weight. The recorded per-part
logs and `rig.json` are your scored submission.
