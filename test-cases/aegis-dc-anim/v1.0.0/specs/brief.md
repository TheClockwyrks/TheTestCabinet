# Aegis — Dual Contouring compositing-and-rigging brief

You are compositing and rigging the **Aegis**, a **colossal multi-gun
war-fortress** that strides on **legs** — a heavily armored stronghold that
**dwarfs every ordinary battlefield unit**, carrying a **dominant main cannon**,
**secondary side guns**, and a **sensor vane**. Build it with **`dc-anim`** (each
part meshed with **Dual Contouring**) as a **rigged 3D mesh** a game poses at
runtime. There is no target model to copy: it must read unmistakably as the Aegis
and satisfy the animation contract below.

This brief fixes **what the Aegis is** and **how it must move**. It deliberately
does **not** give you a parts list, joint placements, or pose angles — **working
out the pieces a walking, firing fortress needs, where they attach, and how they
articulate is the test.** Invent the rig.

## How the tool works (this is not a cube tool)

`dc-anim` does not place cubes. Each part's geometry is a **continuous
signed-distance field** you shape by **compositing primitives**:

- **Add** with `add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder` (each a
  center, an extent, an opaque `#rrggbb` color); **carve** with `subtract-*`.
- **`--blend <radius>`** selects a **smooth** join (default `0` = hard crease);
  the DC-only **`--sharp`**/**`--smooth`** tag preserves or rounds a primitive's
  edges; `mirror`/`translate`/`copy`/`replace-color`/`clear` edit the whole field.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its
  own field**, meshed and previewed on its own. Create a part with `define-part`
  before you sculpt into it.

Build **one operation at a time**. `dc-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `dc-anim --help` is
the contract.

## Dual Contouring character — crisp, high-fidelity, sharp

Dual Contouring samples on a **fine** grid and, unlike a rounding extractor,
**preserves sharp edges and corners crisply** — a **high-fidelity, hard-surface**
look, *what this binary is for*. **Lean into it:** compose confident, crisp armor
whose clean planes, sharp corners, and defined panel seams are the aesthetic. A
hard union (`--blend 0`) makes a sharp crease for free, and the DC-only
**`--sharp`** tag (vs **`--smooth`**) holds a primitive's edges knife-clean — use
it on armor and plating, keeping intentionally rounded forms (a turret dome, a
barrel) smooth by choice.

## The volume and coordinate system

- Each field is framed by an **88 (x) × 80 (y) × 104 (z)** volume, starting
  **empty**; centers/extents are **real-valued**, not grid-snapped.
- **x** across `0`–`87`; **y** up, `0` (ground) to `79`; **z** front-to-back
  `0`–`103`. **Forward is +z:** the main cannon points toward higher `z` at rest.
- Build it roughly **symmetric left-to-right**, **massive, tall, and broad**,
  riding raised on its legs and filling much of the volume.
- Each part is composited in these shared coordinates, where it sits on the
  assembled fortress.

## What the Aegis is (and what is yours to invent)

Fixed — the fortress must read unmistakably as **all** of these:

- A **colossal armored citadel** hull — a tiered, prowed stronghold, **not a
  plain box** — far bigger than any buildable unit, riding **raised on legs**.
- **Multiple legs** (at least four; more reads as heavier) that carry it and
  **walk** (see the animations).
- A **big main turret** on top with a **dominant cannon** projecting **forward**.
- A **secondary turret out on each side** (one per flank, plainly side-mounted,
  not on the roof).
- A **radar/sensor vane** up top that **sweeps on its own**.
- A clear **solar-amber accent** and the palette below.

**Everything else is yours to invent** — the exact silhouette, proportions,
number and design of the legs, how the hull is tiered and prowed, how the turrets
and vane are shaped, and how you break the fortress into rig parts and place its
joints. Nothing here prescribes a shape; the test rewards a bold, characterful
design that is unmistakably the Aegis and animates convincingly.

## Palette

Use only these opaque colors (off-palette colors and stray primitives count
against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle / running-light accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** accent (a command eye or lamp on the main turret, a
muzzle glow, a running-light stripe) so it shows from many angles.

## Making the legs walk (the hard part — design them to work)

The single thing most models get wrong is the walk. You are judged on whether the
legs read as a **heavy machine pushing itself forward**, not flailing. To get
there you will almost certainly need each leg to be an **articulated chain** —
more than one segment and more than one joint — because a single rigid leg swung
from one pivot cannot both lift its foot clear and hold it planted. Concretely:

- **Independent legs.** Give each leg its **own** chain on its **own** hip
  directly above its **own** foot. Do **not** hang a fore-and-aft row of feet on
  one shared pivot — rotating that bank drives the rear feet down through the
  ground while the front feet lift.
- **A planted stance.** Every leg must have a phase where its foot is **flat and
  still on the ground** while the body travels forward over it, then lifts,
  swings forward, and plants again. A foot that is in a continuous arc the whole
  time — never still on the ground — reads as flailing, not walking.
- **Keep the foot flat *in the world*.** As the leg folds and extends through the
  stride, the foot must stay **level with the ground**, not tip onto toe or heel.
  This is the subtle part: a joint angle is applied **relative to its parent
  segment**, so holding the foot flat in the *world* means the ankle must
  **counter-rotate against the combined rotation of the hip and knee above it** —
  not just sit at a fixed local angle. Design the ankle with enough range to
  cancel that accumulated rotation across the whole cycle.
- **Bend the knee the right way.** Rest the leg as a **clearly bent** chain (not
  a straight column — a straight leg has no room to fold and extend), and bend
  the knee the way a heavy walker's does (a reverse/digitigrade knee). If it
  bends inside-out, fix the sign of the motion.
- **Phase the legs** so the machine is always supported (e.g. alternating
  tripods for six legs, diagonal pairs for four) — never all feet lifting at
  once.

Design guidance on believable walker legs and gaits lives in the docs
([Rigging and animating walkers](../../../../../apps/docs/src/content/docs/testing/asset-generation/rigging-walkers.md));
note that the example angles there are given in **world space** and are
illustrative — you must translate them into your own rig's joints, accounting for
how each segment is attached.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name
(you author the motion). Author each with `dc-anim define-animation` then
`add-keyframe`, choosing the period and setting each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with
optional `--in-handle`/`--out-handle`) so motion **carries weight** — legs and
guns are heavy, so ease the motion rather than sliding linearly, and give a
foot-plant or a gun recoil a sharp `ease-in` for a satisfying thump.

- **`march`** — the WALK (a game-triggered playable). Strides the fortress
  forward on its legs with the planted-stance gait described above: feet plant
  flat and still, then lift, swing, and plant. Author it **in place** — the
  body stays centered in the volume and the clip must **not** translate the
  whole model across the scene; the leg cycle alone carries the stride (played
  on its own, the planted foot slides straight back under the body,
  treadmill-style, then swings forward), and a consuming game supplies the
  real forward travel. The legs move; the guns hold.
- **`bombardment`** — the WEAPON showcase (a game-triggered playable). Works the
  main cannon (aiming forward and elevating) and the two side turrets (each
  traversing its own flank, independently), while the fortress stands its ground
  — the legs stay planted.
- **`radar_spin`** — the sensor sweep (a self-playing idle). Turns the radar vane
  continuously on its own, under both playables and at rest.

You **may add** extra parts, joints, and animations of your own; you must produce
these three animations, by these names, and must not contradict them (e.g. don't
move the legs under `bombardment` or the guns under `march`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the three
animations' keyframes — reading `parts/<part>.png` and the `scene/*.png` previews
between calls to confirm the parts fit, the legs seat and spread to the ground,
and the animations read with weight. The emitted per-part `mesh.json` and
`rig.json` are your scored submission.
