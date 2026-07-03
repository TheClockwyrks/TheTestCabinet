# Sunfront Scarab — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Scarab**, a low, wide four-legged
war-beetle with snapping front mandibles, as a **3D voxel model** with a small
**rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as this scuttling beetle machine, walks
believably on its four legs, and poses correctly from the description below.

## The volume and coordinate system

- The volume is **48 wide (x) x 28 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the beetle, `0`-`47`. **y** runs up, `0` (bottom, the ground)
  to `27` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the head and mandibles point toward `z = 55` (the front)
  when the jaws are at rest. Up is +y.
- Build the beetle **symmetric about the lengthwise vertical centerplane between
  `x = 23` and `x = 24`** — the four legs mirror left/right, and the body and
  mandibles are centered on it.
- The beetle is deliberately **low and wide** — a fast, ground-hugging swarm bug,
  not a tall one. It fills most of the length and width, riding a little way up
  off the ground on its legs.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  beetle (a leg already under its corner, the mandibles already out at the head).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Shell — primary plating (brass) | `#c69a4b` |
| Shell — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, mandibles, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Eye-cluster accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the beetle a clear amber
**eye-cluster on the head**, above and between the mandibles, so the accent reads
from multiple angles.

## The parts

The beetle is a **rig** of parts in a parent/child hierarchy. The `body` carapace
is the fixed root; each of the four legs is its **own** three-part chain (a thigh,
a shin, and a short flat foot); and the mandibles hang at the head. Sculpt each
in
its own local coordinates within the shared volume, positioned where it sits on
the
finished beetle:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The domed carapace body and head |
| `thigh_lf` | `body` | `[10, 12, 40]` | Left-front upper leg (thigh) |
| `shin_lf` | `thigh_lf` | `[10, 7, 40]` | Left-front lower leg (shin) |
| `foot_lf` | `shin_lf` | `[10, 1, 40]` | Left-front short flat foot |
| `thigh_lr` | `body` | `[10, 12, 16]` | Left-rear thigh |
| `shin_lr` | `thigh_lr` | `[10, 7, 16]` | Left-rear shin |
| `foot_lr` | `shin_lr` | `[10, 1, 16]` | Left-rear foot |
| `thigh_rf` | `body` | `[38, 12, 40]` | Right-front thigh |
| `shin_rf` | `thigh_rf` | `[38, 7, 40]` | Right-front shin |
| `foot_rf` | `shin_rf` | `[38, 1, 40]` | Right-front foot |
| `thigh_rr` | `body` | `[38, 12, 16]` | Right-rear thigh |
| `shin_rr` | `thigh_rr` | `[38, 7, 16]` | Right-rear shin |
| `foot_rr` | `shin_rr` | `[38, 1, 16]` | Right-rear foot |
| `mandibles` | `body` | `[24, 8, 50]` | The snapping front jaws |

- **`body`** is the **root** — the fixed core of the beetle. Sculpt a low, wide
  domed carapace in the brass shell color (bronze on its underside and in the
  shadowed seams) sitting raised off the ground, running most of the depth and
  width. At the front (`z` toward `55`) shape a head, and set the **solar-amber
  eye-cluster** into it above the jaw line. Keep the underside fleshed out over
  each hip and the head fleshed out where the mandibles mount so the children have
  something to seat against.
- **The four legs** are **independent chains, one per corner** — left-front (`lf`),
  left-rear (`lr`), right-front (`rf`), right-rear (`rr`). Each is three parts in
  the iron color stacked straight down its own corner (x and z held constant, only
  y descending): a **thigh** from the hip under the body, a **shin** from the knee,
  and a **short, FLAT foot** from the ankle. Do NOT sculpt a shared left/right bank
  of legs on one pivot — that would drag the rear feet through the ground. Each
  foot
  sits directly below its own hip. **Sculpt the rest pose with a clearly BENT
  knee** (the shin folded back under the body), never a straight column — a
  near-straight leg cannot keep its foot planted while the body passes over it.
- **`mandibles`** attaches to the head at **`[24, 8, 50]`**. Sculpt a pair of
  curved, pointed jaws in the iron color projecting **forward (+z)** from the head,
  centered on the centerplane and meeting the head at the mount with no gap. Shape
  them so they can swing open and shut about a horizontal hinge across the head.

## The required joints

A consuming game drives the rig by joint name. Each leg carries **three `auto`
joints** — driven by the `walk` animation you author (below), not by the caller
—
and the front jaws carry **one `caller` joint**.

**Per leg** (`<id>` is one of `lf`, `lr`, `rf`, `rr`):

- **`hip_<id>`** — a **rotation** about **x** through the hip pivot, the big
  fore/aft sweep. `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`knee_<id>`** — a **rotation** about **x** through the knee pivot, the fold
  that lifts and plants the foot. `min = -1.4`, `max = 0.2`, **rest `-0.5`** (a
  clearly bent knee — softened for the scarab's short legs so the short foot still
  reaches the ground), **`drive = "auto"`**. The knee folds
  **reverse/digitigrade** (the shin folds rearward); if your sculpt makes it bend
  "inside-out", **flip the sign** of the knee's animated values, not just the
  range.
- **`foot_<id>`** — a **rotation** about **x** through the ankle pivot, a small
  ankle tilt that counter-rotates against the shin to keep the foot **flat** on
  the
  ground (only about ±15° across the whole cycle). `min = -0.3`, `max = 0.3`, rest
  `0`, **`drive = "auto"`**.

**The jaws:**

- **`mandibles_snap`** — a **rotation** about the **x** (across) axis, through the
  jaw hinge at pivot **`[24, 8, 50]`**, driven by the **caller** (the game). Its
  range is **`min = 0` (fully closed, at rest) to `max = 0.9` (widest gape)**,
  resting at `0`. Driving it must **swing the mandibles open and shut about that
  hinge** — the whole jaw assembly as one solid piece — so the beetle can bite.
  Only the mandibles move on this joint; no voxel of them should tear away from
  the head or clip into the body as they open.

## The required animations — you author the motion

You must **author two animations** as **F-curves** using the `voxel-anim`
animation subcommands — `define-animation` to declare each one, then `add-keyframe`
to set its keyed values over time. The case declares each animation's identity and
intent; **you produce the actual keyframes and curves**. Do NOT slide linearly
between poses — set per-keyframe interpolation (`--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` bezier handles) so the motion carries weight. Run
`voxel-anim define-animation --help` and `voxel-anim add-keyframe --help` for the
exact flags.

- **`walk`** (`period_ms = 600`, `loop = true`, plays on demand) — the walk cycle.
  It drives all **twelve leg joints** (`hip_*`, `knee_*`, `foot_*` for every leg).
  Author it by designing the **foot path first**, then solving the joint angles
  to
  it:
  - **Gait:** a **diagonal-pair** trot — legs **`lf` and `rr` step together**, and
    **`rf` and `lr` step together** a half period (300 ms) out of phase — so three
    feet are planted while one steps.
  - **Planted stance phase (the most important rule):** for the part of the
    cycle a
    leg is down, its foot is **flat and STILL on the ground**, translating straight
    **backward relative to the body** while the beetle passes over it. The hip and
    knee extend/fold together to hold the foot at that fixed ground point; the ankle
    counter-rotates to keep the foot flat. There must be a segment where the foot
    sits still on the ground — a leg in a continuous arc reads as flailing.
  - **Swing phase:** the knee folds to **lift the foot clear**, carry it forward,
    and set it back down at the front of the stride.
  - **Weight:** ease most of the motion, and reserve a snappy **`ease-in` into each
    foot-plant** for the skittering beetle's little "thump" as it lands.
- **`bite`** (`period_ms = 500`, `loop = true`, plays on demand) — the jaw
  showcase. It drives only **`mandibles_snap`**: snap the jaws wide open, then shut,
  and hold shut before looping, with eased curves (a fast snap open, a firm close).
  It touches no leg joint.

You **may add** your own extra parts, joints, or animations on top of this (for
example a subtle antenna twitch), but you must **not drop or contradict** the
required parts, the twelve `auto` leg joints, the caller `mandibles_snap` joint,
or
the required `walk` and `bite` animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the carapace body and head, then each leg's thigh/shin/foot chain, then the
mandibles, checking each part's preview as you go. Define the parts, pivots, the
twelve `auto` leg joints, and the caller `mandibles_snap` joint through the tool's
rig subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt), then author
the
`walk` and `bite` animations with `define-animation`/`add-keyframe`. Run `voxel-anim
--help` for the available operations (setting and clearing single voxels, filling
and stroking boxes, 3D lines, spheres, and a mirror plane), the rig subcommands,
and
the animation subcommands, and `voxel-anim <operation> --help` for each one's exact
flags. Call `voxel-anim` once per operation and read `parts/<part>.png` (and the
assembled `scene/` previews) between calls to judge each part against this brief.
