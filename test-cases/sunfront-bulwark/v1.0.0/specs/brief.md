# Sunfront Bulwark — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark**, a heavy bipedal war-mech
that braces a broad **tower shield** on its **left arm** and swings a heavy
**siege maul** in its **right arm** — a slow, plodding armored frontline tank — as
a **3D voxel model** with a **rig** a game can pose at runtime. There is no target
model to copy: it must read unmistakably as this armored shield-and-maul mech and
satisfy the animation contract below.

This brief fixes **what the Bulwark is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working
out the pieces a walking, smashing mech needs, where they attach, and how they
articulate is the test.** Invent the rig.

## How the tool works

`voxel-anim` **paints discrete opaque cells**. You build the model by placing and
filling voxels one operation at a time:

- Place and clear single voxels, fill and stroke boxes, draw 3D lines and spheres,
  and use a mirror plane — each a position/extent and an opaque `#rrggbb` color.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its own
  volume**, previewed on its own. Create a part with `define-part` before you
  sculpt into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **56 wide (x) × 68 tall (y) × 48 deep (z)**, in opaque voxels. It
  starts **empty**; each part is sculpted in these shared coordinates.
- **x** runs across the mech, `0`–`55`. **y** runs up, `0` (bottom, the ground) to
  `67` (top of the head). **z** runs front-to-back, `0`–`47`.
- **Forward is +z:** the head faces and the shield braces toward `z = 47` (the
  front) at rest. Up is +y.
- Build the **body, head, and the two legs symmetric** left-to-right about the
  lengthwise vertical centerplane (between `x = 27` and `x = 28`). The **two arms
  are the deliberate exceptions**: the **left** arm (out toward `x = 0`) carries
  the tower shield, and the **right** arm (out toward `x = 55`) wields the maul.
- Build it **broad and heavily armored** — wide across the shoulders and thick in
  the leg — filling much of the volume, standing on its legs.

## What the Bulwark is (and what is yours to invent)

Fixed — the mech must read unmistakably as **all** of these:

- A **broad, heavily armored body** with a **head** on top — a bulky bipedal
  fighting machine, **not an abstract stack of boxes** — with **two clear, blocky
  shoulders**.
- **Two thick legs** that carry it and **walk** (see the animations), standing on
  **visibly bent knees** — not straight columns.
- On the **left**: a **visible bent arm** bracing a **broad tower shield** across
  the front of the body — a wide, tall slab of brass and bronze plating with an
  iron rim, facing **forward (+z)**. The arm must be plainly present holding the
  shield, not a shield stuck flat to the chest.
- On the **right**: a **visible arm** ending in a fist that grips the **haft of a
  heavy siege maul** (a long iron-headed war maul on a brass haft), held up and
  ready, shaped so the whole arm-and-maul can swing up over the head and down in a
  smash.
- A clear **solar-amber core** set into the **center of the chest** so it reads
  from many angles, plus the palette below.

**Everything else is yours to invent** — the exact silhouette and proportions, how
the body is massed and the head shaped, the number of segments and design of the
legs, how the arms and shield are built, and how you break the mech into rig parts
and place its joints. Nothing here prescribes a shape; the test rewards a bold,
characterful design that is unmistakably the Bulwark and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Joints, shield frame, maul head, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Chest-core accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** core into the center of the chest so the accent reads
from multiple angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the
legs read as a **heavy machine pushing itself forward**, not flailing. To get
there you will almost certainly need each leg to be an **articulated chain** — more
than one segment and more than one joint — because a single rigid leg swung from
one pivot cannot both lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip directly
  above its **own** foot. Do **not** hang both feet on one shared pivot — rotating
  that bank drives one foot down through the ground while the other lifts.
- **A planted stance.** Each leg must have a phase where its foot is **flat and
  still on the ground** while the body travels forward over it, then lifts, swings
  forward, and plants again. A foot in a continuous arc the whole time — never
  still on the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel.
  This is the subtle part: a joint angle is applied **relative to its parent
  segment**, so holding the foot flat in the *world* means the ankle must
  **counter-rotate against the combined rotation of the hip and knee above it** —
  not just sit at a fixed local angle. Design the ankle with enough range to cancel
  that accumulated rotation across the whole cycle.
- **Bend the knee the right way.** Rest each leg as a **clearly bent** chain (not a
  straight column — a straight leg has no room to fold and extend), and bend the
  knee the way a heavy walker's does (a reverse/digitigrade knee). The common
  failure is the shin bending the wrong way — "inside-out" — which reads as broken;
  if your sculpt bends inside-out, **flip the sign** of the motion.
- **Phase the two legs in opposite phase** — one a half period behind the other —
  so one foot is always planted and the mech is always supported. Never lift both
  feet at once.

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
`--in-handle`/`--out-handle`) so motion **carries weight** — legs and the maul are
heavy, so ease the motion rather than sliding linearly, and give a foot-plant or
the maul strike a sharp `ease-in` for a satisfying thump.

- **`walk`** — the WALK (a game-triggered playable). Strides the mech forward on
  its legs with the planted-stance gait described above: feet plant flat and still,
  then lift, swing, and plant, the two legs in opposite phase so one foot is always
  down. Author it **in place** — the body stays centered in the volume and the clip
  must **not** translate the whole model across the scene; the leg cycle alone
  carries the stride (played on its own, the planted foot slides straight back under
  the body, treadmill-style, then swings forward), and a consuming game supplies the
  real forward travel. The legs move; the arms hold.
- **`smash`** — the WEAPON showcase (a game-triggered playable). Winds the heavy
  siege maul up over the head, slams the whole right arm-and-maul down and forward
  in a smash, then recovers to the ready pose — while the mech stands its ground
  and the legs stay planted.

You **may add** extra parts, joints, and animations of your own; you must produce
these two animations, by these names, and must not contradict them (e.g. don't move
the legs under `smash` or the arms under `walk`), and the finished mech must clearly
have **two arms**, a shield on the left and the maul on the right.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — the
armored body, head, shoulders, and the left shield arm, then the legs, then the
right maul arm — reading `parts/<part>.png` and the `scene/*.png` previews between
calls to confirm the parts fit, the legs seat and reach the ground, and the
animations read with weight. Define your parts with `define-part`, sculpt each with
`--part <name>`, set pivots with `set-pivot`, place joints with `define-joint`, and
author the two animations' keyframes with `define-animation` and `add-keyframe`. Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags. The
recorded per-part logs and `rig.json` are your scored submission.
