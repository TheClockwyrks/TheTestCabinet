# Sunfront Monolith — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Monolith**, a towering super-heavy
bipedal war-mech carrying a giant cannon on its right arm, as a **3D voxel model**
with a **rig** a game poses and animates at runtime. There is no target model to
copy: build something that reads unmistakably as this hulking walking mech and
poses and walks correctly from the description below.

This brief fixes **what the Monolith is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working out
the pieces a walking, firing mech needs, where they attach, and how they articulate
is the test.** Invent the rig.

## How the tool works

`voxel-anim` places **discrete opaque voxels** (cells), one recorded operation at a
time. You paint each part's geometry with the tool's voxel operations — setting and
clearing single cells, filling and stroking boxes, 3D lines, and spheres, with a
mirror plane — each in an opaque `#rrggbb` color (there is no transparency). Global
**`--part <name>`** selects the part an op sculpts; **each part is its own model**,
previewed on its own. Create a part with `define-part` before you sculpt into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **64 wide (x) × 80 tall (y) × 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`–`63`. **y** runs up, `0` (bottom, the ground) to
  `79` (top of the head). **z** runs front-to-back, `0`–`55`.
- **Forward is +z:** the mech faces toward `z = 55` (the front), and the cannon
  points that way when it is level. Up is +y.
- Build the mech **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** — the two legs mirror each other, and the torso and head
  are centered on it (the right-arm cannon deliberately breaks that symmetry).
- The Monolith is deliberately **huge and imposing** — an expensive capstone
  bruiser, broad and heavily armored, filling most of the height and width. It
  stands planted on the ground, with the massive torso and head stacked above the
  hips.
- Each part is sculpted in this same volume's coordinates, positioned where the part
  sits on the assembled mech.

## What the Monolith is (and what is yours to invent)

Fixed — the mech must read unmistakably as **all** of these:

- A **massive armored torso** with a **head** on top — a broad-shouldered upper
  body, **not a plain box** — the fixed core the whole machine hangs from.
- **Two thick legs** that carry it and **walk** (see the animations), planted
  beneath the hips.
- A **giant cannon** carried on the **right arm**, projecting **forward (+z)** when
  level, that can **aim up and down** and **recoil**.
- A clear **solar-amber core** set into the chest and **amber shoulder lights**, so
  the accent reads from many angles.

**Everything else is yours to invent** — the exact silhouette, proportions, how the
torso is massed and the head shaped, how the cannon is built, and how you break the
mech into rig parts and place its joints. Nothing here prescribes a shape; the test
rewards a bold, characterful design that is unmistakably the Monolith and animates
convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Plating — primary armor (brass) | `#c69a4b` |
| Dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels (sandstone) | `#d9c48c` |
| Cannon, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Core and shoulder-light accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the mech a clear amber
**core set into the chest**, plus **amber shoulder lights**, so the accent reads
from multiple angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the
legs read as a **heavy machine pushing itself forward**, not flailing. To get there
you will almost certainly need each leg to be an **articulated chain** — more than
one segment and more than one joint — because a single rigid leg swung from one pivot
cannot both lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip directly
  above its **own** foot. Do **not** hang both feet on one shared pivot — rotating
  that bank drives one foot down through the ground while the other lifts.
- **A planted stance.** Each leg must have a phase where its foot is **flat and still
  on the ground** while the body travels forward over it, then lifts, swings forward,
  and plants again. A foot that is in a continuous arc the whole time — never still on
  the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel.
  This is the subtle part: a joint angle is applied **relative to its parent
  segment**, so holding the foot flat in the *world* means the ankle must
  **counter-rotate against the combined rotation of the hip and knee above it** — not
  just sit at a fixed local angle. Design the ankle with enough range to cancel that
  accumulated rotation across the whole cycle.
- **Bend the knee the right way.** Rest the leg as a **clearly bent** chain (not a
  straight column — a straight leg has no room to fold and extend), and bend the knee
  the way a heavy walker's does (a reverse/digitigrade knee, folding the shin
  rearward). If it bends inside-out, fix the sign of the motion.
- **Phase the legs** in **opposite phase** — one foot planted while the other swings,
  a half cycle apart — so the machine is always supported, never lifting both feet at
  once.

Design guidance on believable walker legs and gaits lives in the docs
([Rigging and animating walkers](../../../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md));
note that the example angles there are given in **world space** and are illustrative
— you must translate them into your own rig's joints, accounting for how each segment
is attached.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so motion **carries weight** — legs and the cannon are
heavy, so ease the motion rather than sliding linearly, and give a foot-plant or a
gun recoil a sharp `ease-in` for a satisfying thump.

- **`walk`** — the WALK (a game-triggered playable). Strides the mech forward on its
  two legs with the planted-stance gait described above: feet plant flat and still,
  then lift, swing, and plant, the two legs in **opposite phase** (one planted while
  the other swings). As a slow, super-heavy bruiser the Monolith rolls smoothly with
  a firm, sharp foot-plant. Author it **in place** — the body stays centered in the
  volume and the clip must **not** translate the whole model across the scene; the
  leg cycle alone carries the stride (played on its own, the planted foot slides
  straight back under the body, treadmill-style, then swings forward), and a
  consuming game supplies the real forward travel. The legs move; the cannon holds.
- **`fire`** — the WEAPON showcase (a game-triggered playable). Works the giant
  arm-cannon — snap it into a quick recoil nod, overshoot back, and settle — while
  the mech stands its ground and the legs stay planted, so a reviewer can watch the
  cannon recoil without dragging a slider by hand.

You **may add** extra parts, joints, and animations of your own (for example a live
weapon-aim control, a subtle head turn, or a left-arm detail); you must produce these
two animations, by these names, and must not contradict them (e.g. don't move the
legs under `fire` or the cannon under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the legs seat under the body and reach the ground, and the
animations read with weight. Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines, spheres,
and a mirror plane) and the rig **and animation** subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. The recorded per-part logs and
`rig.json` are your scored submission.
