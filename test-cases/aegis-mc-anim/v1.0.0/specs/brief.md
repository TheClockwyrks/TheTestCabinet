# Aegis — Marching Cubes compositing-and-rigging brief

You are compositing and rigging the **Aegis**, a **colossal multi-gun
war-fortress** that strides on **six heavy legs** — a heavily armored stronghold
that **dwarfs every ordinary battlefield unit**, carrying a **dominant main
cannon**, **secondary guns**, and a **sensor vane**. Build it with **`mc-anim`**
(each part meshed with **Marching Cubes**) as a **rigged 3D mesh** a game poses
at runtime. There is no target model to copy: it must read unmistakably as the
Aegis and satisfy the rig contract below.

## How the tool works (this is not a cube tool)

`mc-anim` does not place cubes. Each part's geometry is a **continuous
signed-distance field** you shape by **compositing primitives**:

- **Add** with `add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder` (each a
  center, an extent, an opaque `#rrggbb` color); **carve** with `subtract-*`.
- **`--blend <radius>`** selects a **smooth** join (default `0` = hard crease);
  `mirror`/`translate`/`copy`/`replace-color`/`clear` edit the whole field.
- Global **`--part <name>`** selects the part an op sculpts; **each part is its
  own field**, meshed and previewed on its own.

Build **one operation at a time**. `mc-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `mc-anim --help` is
the contract.

## Marching Cubes character — bold, faceted, low-poly

Marching Cubes samples on a **coarse** grid, so the surface is **chunky and
faceted** — a bold **low-poly** look, *what this binary is for*. **Lean into
it:** compose confident, readable masses whose blocky facets are the aesthetic,
using this fidelity to make the Aegis far more than plain cubes.

## The volume and coordinate system

- Each field is framed by an **88 (x) × 80 (y) × 104 (z)** volume, starting
  **empty**; centers/extents are **real-valued**, not grid-snapped.
- **x** across `0`–`87`; **y** up, `0` (ground) to `79`; **z** front-to-back
  `0`–`103`. **Forward is +z:** the cannon points to `z=103` at rest.
- Build it **symmetric about the vertical centerplane between `x = 43` and
  `x = 44`**; **massive, tall, and broad**, riding raised on its legs, filling
  much of the volume.
- Each part is composited in these shared coordinates, where it sits on the
  assembled fortress.

## What is yours to invent

The rig below fixes what the Aegis **is**: its parts, pivots, and how they
move. **The forms, proportions, surface detailing, and how each element is
realized are yours to invent.** This test measures creativity, so nothing here
prescribes a silhouette — shape the hull, legs, turrets, and vane however reads
best, provided the result is unmistakably the Aegis (colossal, six-legged,
multi-gun, symmetric, forward-firing), owns the bold faceted look, and honors
every part, joint, and animation in the contract.

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

## The required parts

The fortress is a **rig of twenty-four required parts** in a parent/child
hierarchy. **Each leg is three parts** (upper `thigh_*`, lower `shin_*`, short
flat `foot_*`) forming an articulated chain; each leg row below lists its three
parts and their three pivots in order (`thigh` ← `chassis`, `shin` ← `thigh`,
`foot` ← `shin`):

| Part(s) | Pivot(s) | What it is |
| --- | --- | --- |
| `chassis` | `[0, 0, 0]` | The armored fortress hull, raised on legs (root) |
| `thigh_lf` / `shin_lf` / `foot_lf` | `[14,30,78]` / `[10,14,78]` / `[8,4,78]` | Left-front leg |
| `thigh_lm` / `shin_lm` / `foot_lm` | `[14,30,52]` / `[10,14,52]` / `[8,4,52]` | Left-middle leg |
| `thigh_lr` / `shin_lr` / `foot_lr` | `[14,30,26]` / `[10,14,26]` / `[8,4,26]` | Left-rear leg |
| `thigh_rf` / `shin_rf` / `foot_rf` | `[73,30,78]` / `[77,14,78]` / `[79,4,78]` | Right-front leg |
| `thigh_rm` / `shin_rm` / `foot_rm` | `[73,30,52]` / `[77,14,52]` / `[79,4,52]` | Right-middle leg |
| `thigh_rr` / `shin_rr` / `foot_rr` | `[73,30,26]` / `[77,14,26]` / `[79,4,26]` | Right-rear leg |
| `main_turret` ← `chassis` | `[44, 60, 56]` | The large rotating main turret |
| `main_gun` ← `main_turret` | `[44, 66, 74]` | The main cannon, on the turret front |
| `left_turret` ← `chassis` | `[12, 44, 52]` | The left-side turret, on its sponson |
| `right_turret` ← `chassis` | `[75, 44, 52]` | The right-side turret, on its sponson |
| `radar` ← `chassis` | `[44, 72, 40]` | The decorative sweeping radar vane |

**`chassis`** is the fixed root hull; it carries the main turret on top, a side
turret out on a sponson on each flank, the radar up top, and the six leg hips
under its belly. **`main_gun`** is the dominant cannon, projecting **forward
(+z)** along the centerplane. **`left_turret`** / **`right_turret`** are plainly
**side-mounted**, each covering **only its own flank**. **`radar`** turns on its
own — not a weapon. Every part meets its parent at that part's pivot **with no
gap**; that is what the pivots fix — the shapes are yours.

### The legs — build them to walk

Shapes are yours, but each of the **six legs (three per side)** must **rig and
walk**:

- Each leg is its **own chain on its own hip directly above its own foot** (left
  feet near `x = 8`, right near `x = 79`, spread wide). Do **not** merge a side
  into one slab or hang several feet on one pivot — a shared bank would drive
  rear feet through the ground when it rotates.
- **Rest is a clearly BENT knee** (about `-0.7` rad), never a straight column: a
  straight leg cannot fold to lift its foot or extend to hold it planted.
- Build the segments so thigh-to-hull, shin-to-thigh, foot-to-shin joins hold
  **with no gap across the full range of motion**, and the flat foot never drags
  below ground.

## The required joints

All joints are **rotations** (radians). A game drives **caller** joints by name;
**auto** joints move only under the animations you author.

**Eighteen `auto` leg joints**, per leg `X` in `lf, lm, lr, rf, rm, rr`:

- **`hip_X`** — axis **x**, hip pivot, `-0.5..0.5`, rest `0` (fore/aft sweep).
- **`knee_X`** — axis **x**, knee pivot, `-1.4..0.2`, rest **`-0.7`** (bent).
  Bends the **reverse/digitigrade** way; if yours bends inside-out, flip the
  animated sign, not the range.
- **`foot_X`** — axis **x**, ankle pivot, `-0.3..0.3`, rest `0` (foot flat).

**Four `caller` gun joints:**

- **`main_turret_yaw`** — axis **y**, `[44,60,56]`, `-0.35..0.35`, rest `0`: a
  **narrow forward cone** (fine aim; the hull turns to bring targets in). No
  tearing or clipping the hull.
- **`main_gun_pitch`** — axis **x**, `[44,66,74]`, `-0.2..0.8`, rest `0.1`:
  cannon elevation, without detaching.
- **`left_turret_yaw`** — axis **y**, `[12,44,52]`, `-1.6..0.0`, rest `-0.8`:
  ahead round to out-left; never crosses right.
- **`right_turret_yaw`** — mirror, `[75,44,52]`, `0.0..1.6`, rest `0.8`: ahead
  round to out-right.

**One `auto` radar joint:**

- **`radar_spin`** — axis **y**, `[44,72,40]`, `-3.14159..3.14159`, rest `0`:
  sweeps forever via the self-playing `radar_spin` animation; keep its geometry
  on the citadel.

You **may add** extra parts/joints/animations, but never drop or contradict the
required set.

## The required animations — author each as F-curves

`rig.json` is pre-seeded with **three animation declarations** (`name`,
`period_ms`, `loop`/`auto_play`, driven `joints`) **but no keyframes**. Author
each with `mc-anim define-animation` then `add-keyframe`, setting each key's
`--interp` (`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`,
with optional `--in-handle`/`--out-handle`) so motion **carries weight**.

- **`march`** — the WALK. `1600 ms`, `loop`, not auto. Drives all eighteen leg
  joints. Each leg holds a **planted STANCE** (foot flat and still, translating
  straight back while the body passes over it), then a **SWING** (knee folds
  toward `-1.2` to lift, hip carries forward, foot plants), sharp **`ease-in`**
  on the plant for a heavy thump. Not a continuous arc: keep a still, flat,
  planted segment.
- **Gait phasing:** two alternating tripods — A = `lf, rm, lr`, B = `rf, lm, rr`
  a **half period (800 ms)** out of phase — so three feet are planted at all
  times.
- **`bombardment`** — the WEAPON showcase. `4000 ms`, `loop`, not auto. Drives
  only the four gun joints: the main cannon lobs in its cone while the side
  turrets each sweep their own flank arc independently and out of phase. No leg
  joint moves. Ease the sweeps.
- **`radar_spin`** — `3000 ms`, `loop`, **auto**. Drives only `radar_spin`, a
  full sweep each loop, under both animations and at idle.

## Working the tool

Composite each part with `--part <name>` — hull, each leg's thigh/shin/foot, the
main turret and cannon, the two side turrets, the radar — reading
`parts/<part>.png` and the `scene/*.png` previews between calls to confirm the
parts fit and the legs seat and spread to the ground. Confirm the pre-seeded
parts, pivots, joints, and animation declarations, adjust pivots to your build,
and author each animation's keyframes. The emitted per-part `mesh.json` and
`rig.json` are your scored submission.
