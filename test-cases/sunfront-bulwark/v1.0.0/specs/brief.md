# Sunfront Bulwark — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bulwark**, a heavy bipedal war-mech
that braces a broad **tower shield** on its **left arm** and swings a heavy
**siege maul** in its **right arm**, as a **3D voxel model** with a small **rig**
a game can pose at runtime. There is no target model to copy: build something that
reads unmistakably as this armored shield-and-maul mech and poses correctly from
the description below.

## The volume and coordinate system

- The volume is **56 wide (x) x 68 tall (y) x 48 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mech, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `67` (top of the head). **z** runs front-to-back, `0`-`47`.
- **Forward is +z:** the head faces and the shield braces toward `z = 47` (the
  front) when the arms are at rest. Up is +y.
- Build the **torso, head, and the two legs symmetric** about the lengthwise
  vertical centerplane between `x = 27` and `x = 28`. The **two arms are the
  deliberate exceptions**: the **left** arm (out toward `x = 0`) carries the tower
  shield, and the **right** arm (out toward `x = 55`) wields the maul.
- Each leg is an **articulated chain of three segments** (a thigh, a shin, and a
  short flat foot) so it can plant a foot and stride, not a single rigid stump —
  see **The parts** and **The legs** below. Sculpt the assembled rest pose with
  a
  **clearly bent knee**, not a straight column.
- The Bulwark is deliberately **broad and heavily armored** — a slow, plodding
  frontline tank, wide across the shoulders and thick in the leg, not a lithe
  runner.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled mech
  (a leg already under its hip, the maul arm already up at the right shoulder).

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

The **solar-amber** accent is the team-tint region: set a clear amber **core into
the center of the chest**, so the accent reads from multiple angles.

## The parts

The mech is a **rig** of eight required parts in a parent/child hierarchy. Sculpt
each in its own local coordinates within the shared volume, positioned where it
sits on the finished mech:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | Body, head, both shoulders, and the left shield arm |
| `thigh_l` | `torso` | `[18, 28, 24]` | The left leg's upper thigh (hangs from the left hip) |
| `shin_l` | `thigh_l` | `[18, 15, 24]` | The left leg's lower shin (hangs from the left knee) |
| `foot_l` | `shin_l` | `[18, 3, 24]` | The left leg's short, flat foot (hangs from the left ankle) |
| `thigh_r` | `torso` | `[38, 28, 24]` | The right leg's upper thigh (mirror of the left) |
| `shin_r` | `thigh_r` | `[38, 15, 24]` | The right leg's lower shin |
| `foot_r` | `shin_r` | `[38, 3, 24]` | The right leg's short, flat foot |
| `weapon` | `torso` | `[40, 44, 26]` | The right arm gripping the siege maul |

- **`torso`** is the **root** — the fixed core of the mech. Sculpt a broad,
  heavily armored upper body in the brass armor color (bronze on its
  underside and in the shadowed seams) with a head set on top around
  `y = 60`, standing above the hips (from about `y = 28` up). Set the
  **solar-amber core** into the middle of
  the chest. It must have **two clear, blocky shoulders**. On the **left**
  shoulder, sculpt a **full bent arm** (upper arm, forearm) that braces a **broad
  tower shield** across the front of the body: a wide, tall slab of brass and
  bronze plating with an iron rim, facing **forward (+z)**. The **left arm and its
  shield are part of the torso** and do not move — but the arm must be **visibly
  present** holding the shield, not a shield stuck flat to the chest. Keep the
  right shoulder and the two hips fleshed out where the maul arm and the legs mount
  so the children have something to seat against.

### The legs

Each leg is an **independent three-segment chain** on its **own** hip, positioned
directly above its **own** foot — the same `x` and `z` all the way down, only `y`
descending. Do **not** model a single leg-bank part on one shared pivot:
rotating a
spread of feet about one point drives feet through the ground. Sculpt both legs
in a
**standing, clearly bent-knee** stance (the knee folded, not a straight column)
so
the assembled rest scene shows folded legs.

- **`thigh_l`** hangs from the **left hip** at **`[18, 28, 24]`** down to the knee
  around `y = 15`. A thick, armored upper leg in brass and bronze with an iron hip
  joint. It meets the torso at the hip with no gap.
- **`shin_l`** hangs from the **left knee** at **`[18, 15, 24]`** down to the ankle
  around `y = 3`. A thick lower leg with an iron knee joint at the top. It meets
  the
  thigh at the knee with no gap.
- **`foot_l`** hangs from the **left ankle** at **`[18, 3, 24]`** — a **short, flat
  foot** (a low, wide iron-and-bronze pad, only a few voxels tall) that sits
  flat on
  the ground. It meets the shin at the ankle with no gap.
- **`thigh_r`**, **`shin_r`**, **`foot_r`** are the **mirror** of the left leg,
  on
  the right hip at **`[38, 28, 24]`** (knee `[38, 15, 24]`, ankle `[38, 3, 24]`).
- **`weapon`** attaches at the **right shoulder** at **`[40, 44, 26]`**.
  Sculpt a **full right arm** — a blocky upper arm and forearm with an iron
  elbow, ending in a **fist that grips the haft of a heavy siege maul**: a long
  iron-headed war maul (a great hammer) on a brass haft, held up and ready. The
  whole **arm-and-maul** is one part. It meets the right shoulder at the mount
  with no gap, and is shaped
  so the entire arm-and-maul assembly can swing up over the head and down in a
  smash about a horizontal shoulder hinge.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  **right** shoulder hinge at pivot **`[40, 44, 26]`**, driven by the **caller**
  (the game). Its range is **`min = -0.5` (maul swung down and forward to
  strike) to `max = 1.1` (maul raised high overhead)**, resting at **`0.2`**
  (maul held up and ready). Driving it must **swing the whole right arm-and-maul
  as one solid piece up over the head and down**, so the mech can wind up and
  smash. Only the weapon moves on this joint; no voxel of it should tear away
  from the shoulder or clip into the torso as it swings.

Each leg carries **three `auto` joints** (driven by the `walk` animation you author,
below — **not** by the caller). Per leg, using its own pivots:

| Joint | Part | Kind / axis | Pivot (l / r) | Range | Rest | Role |
| --- | --- | --- | --- | --- | --- | --- |
| `hip_l` / `hip_r` | `thigh_l` / `thigh_r` | rotation, x | `[18,28,24]` / `[38,28,24]` | `-0.5 .. 0.5` | `0.0` | the big fore/aft stride sweep |
| `knee_l` / `knee_r` | `shin_l` / `shin_r` | rotation, x | `[18,15,24]` / `[38,15,24]` | `-1.4 .. 0.2` | **`-0.7`** | the reverse/digitigrade fold |
| `foot_l` / `foot_r` | `foot_l` / `foot_r` | rotation, x | `[18,3,24]` / `[38,3,24]` | `-0.3 .. 0.3` | `0.0` | the ±~15° ankle tilt |

- The **knee rests at `-0.7`** — a **clearly bent** knee. A near-straight leg
  has no
  room to extend and fold, so it cannot keep its foot planted while the body passes
  over it. Sculpt the shin so this rest reads as a **folded** leg.
- The knee must fold the shin **rearward** (a **reverse / digitigrade** knee,
  like a
  bird's or a real walker's). The common failure is the shin bending the wrong
  way —
  "inside-out" — which reads as broken. If your sculpt bends inside-out, **flip
  the
  sign** of the knee's animated values, not just the range.
- The **foot stays flat.** The `foot_*` ankle counter-rotates against the shin
  so the
  foot tilts only about **±15°** across the whole cycle — never walking on toes
  or
  heels.

## The required animations

You must **author** the motion for each required animation below with the
`voxel-anim` animation subcommands — `define-animation` to set (or confirm) its
name/period/loop/auto-play, then `add-keyframe` per keyframe (see
`voxel-anim --help`). The case pre-seeds each animation's **declaration** (its name,
period, loop, auto-play, and the joints it must drive) into `rig.json` with **no
keyframes** — you supply the **F-curves**. Author real curves, not linear slides:
each `add-keyframe` takes an **`--interp`** of
`constant | linear | bezier | ease-in | ease-out | ease-in-out` (with optional
`--out-handle`/`--in-handle` Bézier handles). Legs carry weight, so linear keys
read
as a weightless, mechanical flail however correct the poses.

- **`walk`** (period **900 ms**, loops, `auto_play = false` — a named playable a
  game
  triggers) drives **all six leg joints**: `hip_l`, `knee_l`, `foot_l`, `hip_r`,
  `knee_r`, `foot_r`. Author a real walk cycle with a **planted stance phase**:
  for
  each leg, a segment where the **foot is flat and still on the ground and translates
  straight backward relative to the body** (the mech passes over the planted foot,
  the hip and knee extending/folding together to hold the foot at a fixed ground
  point), then a **swing** — the knee folds to **lift the foot clear**, the leg
  carries forward, and the foot **plants** again. Land each plant with an **`ease-in`**
  into the foot-plant for the heavy "thump" of this ponderous mech; keep the
  rest of
  the roll smooth (`ease-in-out`). Phase the two legs in **opposite phase** —
  leg `r`
  a half period (450 ms) behind leg `l` — so one foot is always planted. There must
  be a still, flat, planted segment: a continuous-arc "flailing" leg that never
  sits
  still on the ground is wrong. Design the **foot path** first (flat during
  stance, a
  lift arc during swing), then solve the hip/knee/ankle angles to it, then set the
  eased keys.
- **`smash`** (period **700 ms**, loops, `auto_play = false`) drives only
  `weapon_pitch`: wind the maul up overhead (toward `max = 1.1`), slam it down and
  forward (toward `min = -0.5`) with an **`ease-in`** into the strike, then recover
  to the ready pose (`0.2`). It touches no leg joint, so the legs hold still
  while it
  plays.

You **may add** your own extra parts, joints, or animations on top of this (for
example a subtle head turn, or making the left shield arm its own part), but you
must
**not drop or contradict** the required parts, the required caller `weapon_pitch`
joint, the six `auto` leg joints, or the two required animations — and the finished
mech must clearly have **two arms**, a shield on the left and the maul on the right.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the armored torso, head, shoulders, and the left shield arm, then each leg segment
(thigh, shin, foot), then the right maul arm, checking each part's preview as you
go. Define the parts, pivots, the caller `weapon_pitch` joint, and the six `auto`
leg joints through the tool's rig subcommands, and **author the `walk` and `smash`
F-curves** with `define-animation` and `add-keyframe` (the required parts, joints,
and empty animation declarations are already pre-seeded in `rig.json`, but confirm
they match this brief, adjust pivots to your sculpt, and fill in the animation
keyframes).
Run `voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands (including `define-animation`/`add-keyframe`), and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim` once
per operation and read `parts/<part>.png` (and the assembled `scene/` previews)
between calls to judge each part against this brief.
