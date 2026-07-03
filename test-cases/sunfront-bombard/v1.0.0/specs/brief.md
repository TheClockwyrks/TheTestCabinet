# Sunfront Bombard — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bombard**, a four-legged siege mortar
walker with a swiveling turret and a long, high-lobbing barrel, as a **3D voxel
model** with a **rig** a game can pose at runtime and a **`walk` gait you author
yourself**. There is no target model to copy: build something that reads
unmistakably as this striding artillery walker and poses and walks correctly from
the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 52 tall (y) x 80 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the walker, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `51` (top). **z** runs front-to-back, `0`-`79`.
- **Forward is +z:** the walker faces toward `z = 79` (the front), and the barrel
  points that way when the turret is at rest. Up is +y.
- Build the walker **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`** — the left and right legs mirror each other, and the body,
  turret, and barrel are centered on it.
- The Bombard is a **four-legged walker** — it strides on four legs, so it stands
  raised off the ground with clearance under the hull. Keep the hull low and long
  and the legs reaching down to the ground at the four corners.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  walker (each leg segment already in its place under a corner, the turret already
  up on the hull, the barrel already out front of the turret).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrel, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Muzzle-glow accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the Bombard a clear amber
**muzzle glow at the mouth of the barrel**, so the accent reads from multiple
angles.

## The parts

The walker is a **rig** of fifteen required parts in a parent/child hierarchy: the
hull, the turret and barrel on top, and **four independent legs**, each a chain
of
**three segments** — a thigh, a shin, and a short flat foot. Sculpt each in its
own
local coordinates within the shared volume, positioned where it sits on the finished
walker:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored hull |
| `thigh_lf` | `body` | `[13, 16, 56]` | Left-front thigh (upper leg) |
| `shin_lf` | `thigh_lf` | `[13, 9, 56]` | Left-front shin (lower leg) |
| `foot_lf` | `shin_lf` | `[13, 2, 56]` | Left-front flat foot |
| `thigh_lr` | `body` | `[13, 16, 24]` | Left-rear thigh |
| `shin_lr` | `thigh_lr` | `[13, 9, 24]` | Left-rear shin |
| `foot_lr` | `shin_lr` | `[13, 2, 24]` | Left-rear flat foot |
| `thigh_rf` | `body` | `[43, 16, 56]` | Right-front thigh |
| `shin_rf` | `thigh_rf` | `[43, 9, 56]` | Right-front shin |
| `foot_rf` | `shin_rf` | `[43, 2, 56]` | Right-front flat foot |
| `thigh_rr` | `body` | `[43, 16, 24]` | Right-rear thigh |
| `shin_rr` | `thigh_rr` | `[43, 9, 24]` | Right-rear shin |
| `foot_rr` | `shin_rr` | `[43, 2, 24]` | Right-rear flat foot |
| `turret` | `body` | `[28, 30, 44]` | The rotating turret on top |
| `barrel` | `turret` | `[28, 38, 56]` | The long mortar barrel, on the turret front |

- **`body`** is the **root** — the fixed core of the walker. Sculpt a low, boxy
  hull in the brass hull color (bronze on its underside and in the shadowed seams)
  sitting up off the ground on the legs, running most of the depth and width. Keep
  its top flat around `y = 30` so the turret has a mount to rest on, and keep the
  four corners solid where the leg hips mount.
- **The four legs are independent chains.** There is one leg at each corner —
  left-front (`lf`), left-rear (`lr`), right-front (`rf`), right-rear (`rr`) — and
  **each is its own thigh → shin → foot chain on its own hip, directly above its
  own
  foot**. Do NOT build a shared left/right leg-bank on one pivot: a bank of feet
  on
  one shared pivot drags the rear feet down through the ground while the front feet
  lift. Sculpt all leg segments in the iron color:
  - **`thigh_<id>`** hangs from its hip on the body (pivot `y = 16`) down to the
    knee. It carries the big fore/aft sweep of the stride.
  - **`shin_<id>`** hangs from the knee (pivot `y = 9`) down to the ankle.
    Sculpt it
    so the **knee folds rearward** (a reverse / digitigrade knee, like a bird's
    or a
    dog's back leg), never inside-out.
  - **`foot_<id>`** is a **short, flat foot** (pivot `y = 2`) under the shin that
    meets the ground. Keep it flat and level — it tilts only about ±15°.
  - Hold the leg's `x` and `z` **constant down the whole chain** (only `y`
    descends), so each foot sits straight under its own hip.
  - **Rest pose is a clearly BENT knee, not a straight column.** With the knee
    resting folded, the assembled rest scene shows the Bombard standing on visibly
    bent legs — a near-straight leg has no room to extend and fold to keep its foot
    planted as the body passes over it.
- **`turret`** attaches to the top-center of the body at **`[28, 30, 44]`**.
  Sculpt a compact turret box centered over that mount, sitting from about
  `y = 30` up. It must sit **on** the body, meeting it at the mount with no gap
  and no voxel poking down into the hull.
- **`barrel`** attaches to the front of the turret at **`[28, 38, 56]`**. Sculpt
  a long, thick mortar barrel in the iron color projecting **forward (+z)** from
  the turret's front face, centered on the centerplane, with the **solar-amber
  muzzle glow** set into its mouth. It must meet the turret with no gap. Shape it
  so it elevates up about a horizontal hinge across the turret.

## The required joints

A consuming game drives the rig by joint name. There are two kinds:

**The two caller-driven gun controls** (a game supplies the value each frame):

- **`turret_yaw`** — a **rotation** about the **y** (up) axis, through the turret's
  vertical mount at pivot **`[28, 30, 44]`**, `drive = "caller"`. Its range is a
  **full half-turn each way**, `min = -π`, `max = +π`, resting at `0` (facing
  straight forward). Driving it must **swing the whole turret — and the barrel with
  it — left and right about that mount**, so the walker can aim in any direction.
- **`barrel_pitch`** — a **rotation** about the **x** (across) axis, through the
  barrel's mount at pivot **`[28, 38, 56]`**, `drive = "caller"`. Its range is
  **`min = -0.2` (a shallow, near-level aim) to `max = 1.0` (a steep high lob)**,
  resting at **`0.4`** (a raised siege elevation). Driving it must **elevate and
  depress the barrel about that horizontal mount** so the mortar can lob high —
  the
  whole barrel as one solid piece, without any voxel tearing away from the
  turret or
  clipping into it.

**The twelve auto leg joints** (driven by the `walk` animation you author,
`drive =
"auto"`) — three per leg, for each of `lf, lr, rf, rr`:

- **`hip_<id>`** on `thigh_<id>` — rotation about **x** through the hip pivot,
  `min = -0.5`, `max = 0.5`, rest `0`. The big fore/aft sweep.
- **`knee_<id>`** on `shin_<id>` — rotation about **x** through the knee pivot,
  `min = -1.4`, `max = 0.2`, **rest `-0.7`** (a clearly folded, bent knee). This
  is
  a **reverse / digitigrade** knee: it folds the shin rearward. If your sculpt makes
  the knee bend inside-out, **flip the sign** of the knee's animated values (fix
  the
  direction, not just the range).
- **`foot_<id>`** on `foot_<id>` — rotation about **x** through the ankle pivot,
  `min = -0.3`, `max = 0.3`, rest `0`. A small ankle tilt (±~15°) that
  counter-rotates against the shin to **keep the foot flat** on the ground.

At rest the legs hold their standing pose (hips `0`, knees folded at `-0.7`, feet
level); a game strides the walker by playing the `walk` animation.

Sculpt the turret and barrel so both caller motions read correctly — the barrel
is
a child of the turret, so it swings with it on `turret_yaw` and pitches on its own
`barrel_pitch`, always staying attached — and sculpt each leg chain so it folds
and
extends plausibly about its hip, knee, and ankle without detaching.

## The required animations — you author the motion

The rig declares **two animations you must author** as F-curves. The case declares
each animation's **identity and intent**; **you produce the actual motion** with
the
`voxel-anim` animation subcommands — `define-animation` to declare the animation
on
the rig, then `add-keyframe` to set each joint's keyframes as an **F-curve** (choose
per-keyframe `--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, and
optional `--out-handle`/`--in-handle` for bezier). Run `voxel-anim --help` for the
exact animation subcommands and flags. **The motion must carry weight — real curves,
never a constant-speed linear slide between poses.**

### `walk` — the gait (`period_ms = 650`, loops)

Drives all **twelve leg joints**. Author a believable four-legged walk cycle:

- **A planted STANCE phase per leg.** For part of the cycle each foot is **flat
  and
  still on the ground**, translating straight **backward relative to the body**
  — the
  foot does not move in the world; the *machine* passes forward over it. The hip
  and
  knee **extend and fold together** to hold the foot at that fixed ground point.
- **A SWING phase.** The foot then **lifts clear** of the ground (fold the knee
  toward `-1.2`ish to raise it), **travels forward**, and **plants** again at the
  front of the stride.
- **`ease-in` into the foot-plant.** Ease most of the motion smoothly, but land
  each
  foot with a sharp `ease-in` on the final descent for the "thump" of a heavy foot.
  Do NOT leave the foot in a continuous arc the whole cycle — there must be a
  segment where it is flat and still on the ground.
- **Keep each foot flat** through the whole cycle with its `foot_<id>` ankle tilt
  (only ±~15°).
- **Diagonal-pair gait.** Step the diagonal pairs together and a half period
  (325 ms) apart: `{lf, rr}` swing while `{rf, lr}` are planted, then swap. This
  keeps the machine supported and reads as a natural quadruped walk.
- Design the **foot path first** (planted-flat backward, then a lift arc forward),
  then solve the hip/knee/ankle angles that place the foot on that path, then set
  those as eased keyframes.

### `bombard_fire` — the weapon showcase (`period_ms = 1000`, loops)

Drives only **`barrel_pitch`**. Kick the barrel up in a quick recoil-lob then
let it
settle back and hold, so a reviewer can watch the mortar fire without dragging the
slider. Snap up fast (a sharp curve off the rest pose) then ease back down.
Touch no
leg joint — the legs hold planted while the barrel fires.

You **may add** your own extra parts, joints, or animations on top of this (for
example an ammo feed, spent-casing chutes, or a decorative detail), but you must
**not drop or contradict** the required parts, the required caller `turret_yaw`
and
`barrel_pitch` joints, the twelve auto leg joints, or the required `walk` and
`bombard_fire` animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hull, then each leg chain (thigh, shin, foot), then the turret, then the barrel,
checking each part's preview as you go. Define the parts, pivots, the caller
`turret_yaw` and `barrel_pitch` joints, and the twelve auto leg joints through the
tool's rig subcommands (the required parts and joints are already pre-seeded in
`rig.json`, but confirm they match this brief and adjust pivots to your sculpt).
Then author the `walk` and `bombard_fire` animations with `define-animation` and
`add-keyframe`. Run `voxel-anim --help` for the available operations (setting and
clearing single voxels, filling and stroking boxes, 3D lines, spheres, and a mirror
plane), the rig subcommands, and the animation subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per operation
and read `parts/<part>.png` between calls to judge each part against this brief.
