# Sunfront Flakhound — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Flakhound**, a four-legged anti-air
**walker** with a traversing back turret and twin elevating flak barrels, as a
**3D voxel model** with a small **rig** a game can pose at runtime — and you must
**author its animations** as motion curves. There is no target model to copy:
build something that reads unmistakably as this striding flak platform and both
poses and *moves* correctly from the description below.

## The volume and coordinate system

- The volume is **52 wide (x) x 48 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the walker, `0`-`51`. **y** runs up, `0` (bottom, the ground)
  to `47` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the walker faces toward `z = 55` (the front), and the barrels
  point that way when the turret is at rest. Up is +y.
- Build the walker **symmetric about the lengthwise vertical centerplane between
  `x = 25` and `x = 26`** — the four legs mirror left/right, and the body,
  turret, and barrels are centered on it.
- The walker is a squat, sturdy striding platform: a compact armored body carried
  on four legs, with the turret raised on its back so the barrels clear the body.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  walker (a leg already under its corner, the turret already up on the back, the
  barrels already out front of the turret).

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

The **solar-amber** accent is the team-tint region: give the walker a clear amber
**targeting eye on the turret**, facing forward between the barrels, so the accent
reads from multiple angles.

## The parts

The walker is a **rig of sixteen required parts** in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished walker. **Each of the four legs is three parts** —
an upper `thigh_*`, a lower `shin_*`, and a short flat `foot_*` — so the leg bends
at the knee and keeps a flat foot.

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored body and hull |
| `thigh_lf` | `body` | `[12, 14, 38]` | Left-front thigh (upper leg) |
| `shin_lf` | `thigh_lf` | `[12, 8, 38]` | Left-front shin (lower leg) |
| `foot_lf` | `shin_lf` | `[12, 2, 38]` | Left-front foot (short, flat) |
| `thigh_lr` | `body` | `[12, 14, 18]` | Left-rear thigh |
| `shin_lr` | `thigh_lr` | `[12, 8, 18]` | Left-rear shin |
| `foot_lr` | `shin_lr` | `[12, 2, 18]` | Left-rear foot |
| `thigh_rf` | `body` | `[40, 14, 38]` | Right-front thigh |
| `shin_rf` | `thigh_rf` | `[40, 8, 38]` | Right-front shin |
| `foot_rf` | `shin_rf` | `[40, 2, 38]` | Right-front foot |
| `thigh_rr` | `body` | `[40, 14, 18]` | Right-rear thigh |
| `shin_rr` | `thigh_rr` | `[40, 8, 18]` | Right-rear shin |
| `foot_rr` | `shin_rr` | `[40, 2, 18]` | Right-rear foot |
| `turret` | `body` | `[26, 30, 28]` | The traversing flak turret |
| `barrel` | `turret` | `[26, 36, 34]` | The twin elevating flak barrels |

- **`body`** is the **root** — the fixed core of the walker. Sculpt a squat,
  armored body in the brass plating color (bronze on its underside and in the
  shadowed seams) sitting up off the ground on the legs, running most of the depth
  and width. Keep its back (around `y = 30`) fleshed out and roughly flat so the
  turret has a mount to sit on, and keep the belly solid around `y = 14` where the
  four leg hips mount.

### The legs (four legs, each a `thigh_*` + `shin_*` + `foot_*` chain)

The walker stands on **four independent legs** — one at each corner (front `f`,
rear `r`, on the left `l` and right `r` sides). Sculpt each leg as a
**three-segment articulated chain** — a thigh, a shin, and a short flat foot on
**two moving joints** (a hip and a knee) plus an ankle — so it walks like a real
beast, not a stick swung from a hip:

- The **`thigh_*`** hangs from its **hip** on the body's belly (pivot around
  `y = 14`, tucked under its corner) down to the knee. Sculpt it in the iron color
  as a thick upper leg.
- The **`shin_*`** hangs from the **knee** (pivot around `y = 8`) down to the
  ankle. Sculpt it in iron as the lower leg.
- The **`foot_*`** is a short, **flat foot** on the **ankle** (pivot around
  `y = 2`) planted on the ground near `y = 0`. Sculpt it in iron as a broad, level
  foot — the part that carries the walker's weight on the ground. Keep it flat and
  wide, not a toe.
- **Rest pose is a clearly BENT knee, never a straight column.** Sculpt the thigh
  and shin so that at rest (knee folded to about `-0.5` rad) the leg reads as
  visibly bent — a squat, crouched stance. A near-straight leg has no room to
  extend and fold, so its foot cannot stay planted while the body passes over it.
- Each leg is its **own chain of three parts**, mounted on its **own hip directly
  above its own foot** — the left legs around `x = 12`, the right legs around
  `x = 40`, with `x` and `z` **held constant down each chain** so only `y`
  descends. Do **NOT** sculpt the legs as one shared slab per side, and do **not**
  put a fore-and-aft spread of feet on one shared pivot: they must move
  independently, or rotating a bank drives the rear feet through the ground while
  the front feet lift.
- Each segment meets the next at the hip, knee, and ankle with **no gap**, across
  the whole range of motion.

**Reverse (digitigrade) knee.** The knee folds the shin **rearward** — a
backward-bending, beast-like leg. Sculpt the shin so that folding it (the negative
knee direction) tucks the foot back and up, *behind* the knee, not forward. If your
sculpt makes the knee bend "inside-out" when the walk plays, **flip the sign of
the
knee's animated values** — fix the direction, not just the range.

## The required joints

A consuming game drives the rig by joint name. The joints are of two kinds.

**The turret and barrels — two caller joints** (the procedural aim interface a
game drives per frame):

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  turret's vertical mount at pivot **`[26, 30, 28]`**, driven by the **caller**.
  Its range is a **full half-turn each way**, `min = -π`, `max = +π`, resting at
  `0` (facing straight forward). Driving it must **swing the whole turret — and
  the barrels with it — about that mount**, so the walker can traverse onto any
  bearing.
- **`barrel_pitch`** — a **rotation** about the **x** (across) axis, through the
  barrel hinge at pivot **`[26, 36, 34]`**, driven by the **caller**. Its range
  is
  **`min = 0` (level, forward) to `max = 1.3` (steeply skyward)**, resting at
  `0.5` (a raised idle elevation). Driving it must **elevate and depress the twin
  barrels as one solid piece** about that hinge, so the walker can aim at the air.

**The four legs — twelve auto joints (a hip, a knee, and a foot per leg).** These
are **`drive = "auto"`**: they hold the standing pose at rest and are driven by
the
`walk` animation you author (below). For each leg `X` (one of `lf, lr, rf, rr`),
using that leg's pivots from the parts table:

- **`hip_X`** — a **rotation** about **x** through the hip pivot, `min = -0.5`,
  `max = 0.5`, rest `0`. It swings the whole leg fore-and-aft.
- **`knee_X`** — a **rotation** about **x** through the knee pivot, `min = -1.4`,
  `max = 0.2`, rest **`-0.5`** (the folded, bent-knee stance). It folds the shin
  rearward to lift the foot on the swing and extends to plant it.
- **`foot_X`** — a **rotation** about **x** through the ankle pivot, `min = -0.3`,
  `max = 0.3`, rest `0`. A small ±~15° ankle tilt that **counter-rotates against
  the shin to keep the foot flat** through the whole cycle (never walking on toes
  or heels).

## The required animations — author these as motion curves

You must **author two animations** with the `voxel-anim` animation subcommands
(run `voxel-anim --help`): use `define-animation` to create each, then `add-keyframe`
to place its keyframes. Each keyframe carries an **F-curve** interpolation via
`--interp` (`constant` | `linear` | `bezier` | `ease-in` | `ease-out` |
`ease-in-out`), with optional `--out-handle`/`--in-handle` Bézier tangents. The
motion must **carry weight** — eased, curved motion, never a flat linear slide.

Both animations are already declared in the seeded `rig.json` as required
contracts (name, period, loop, `auto_play`, and the joints they must drive); your
job is to author their keyframes so they read correctly.

### `walk` (period 650 ms, loops) — the walk cycle

Drives **all twelve leg joints**. Design a real quadruped step for each leg, then
phase them in a **diagonal-pair gait**: legs **`lf` and `rr` step together**, and
legs **`rf` and `lr` step together a half period (325 ms) out of phase**, so the
walker always has a stable diagonal of feet down.

Author each leg's step as a **planted stance** followed by a **swing**:

- **Stance** — the foot stays **flat and still on the ground** and translates
  straight **backward relative to the body** (the machine passes over the planted
  foot). Sweep the hip from forward to back across the stance while the knee
  extends/folds subtly to hold the foot at a fixed ground point, and the ankle
  (`foot_X`) counter-rotates to keep the foot flat. This still, flat, planted
  segment is essential — no continuous-arc flailing.
- **Swing** — **lift** the foot clear (fold the knee toward its `min`), carry it
  **forward**, then **plant** it. Land the plant with an **`ease-in`** into the
  foot-contact keyframe so the step lands with weight — a light, skittering "thump"
  suits this low, quick scuttler.

Design the **foot's ground path first**, then solve the hip/knee/ankle angles to
it, then set the eased keys. The rest pose (`hip` 0, `knee` -0.5, `foot` 0) is the
mid-stance standing crouch.

### `flak_track` (period 4000 ms, loops) — the anti-air track

Drives only the two caller weapon joints. Sweep **`turret_yaw`** smoothly
left→right→left across a wide bearing while **`barrel_pitch`** raises and lowers
the barrels, so a reviewer can watch the walker track a target across the sky. Use
eased curves (`ease-in-out` at the sweep extremes) so the traverse slows and
reverses smoothly rather than snapping. It touches no leg joint, so the legs hold
their standing pose while it plays.

You **may add** your own extra parts, joints, or animations on top of this (an ammo
feed, spent-casing chutes, extra decorative detail), but you must **not drop or
contradict** the required parts, the caller `turret_yaw` and `barrel_pitch`
joints, the twelve auto leg joints, or the two required animations.

## Working the tool

The only way to place a voxel and edit the rig is the `voxel-anim` binary already
on your `PATH`. Sculpt each part up in sensible layers, selecting it with
`--part <name>` — finish the armored body, then each leg's thigh, shin, and foot,
then the turret, then the barrels, checking each part's preview as you go. Define
the parts, pivots, and joints through the tool's rig subcommands, then author the
`walk` and `flak_track` animations with `define-animation`/`add-keyframe` (the
required parts, joints, and animation declarations are already pre-seeded in
`rig.json`, but confirm they match this brief and adjust pivots to your sculpt).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig and animation subcommands, and `voxel-anim <operation> --help` for each one's
exact flags. Call `voxel-anim` once per operation, read `parts/<part>.png` after
your calls to judge each part, and read the assembled-scene previews under `scene/`
(`scene/iso.png`, `scene/front.png`, `scene/side.png`, `scene/top.png`) — the whole
walker composed from all your parts — to confirm the parts fit: the four legs
seated under the body and bent to the ground, the turret on the back, and the
barrels meeting the turret's front.
