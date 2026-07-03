# Sunfront Bastion — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Bastion**, a huge fortified keep
with a rotating solar collector crown, a raising gate, and a slowly turning
beacon, as a **3D voxel model** with a small **rig** a game can pose at runtime.
There is no target model to copy: build something that reads unmistakably as this
imposing fortress and runs correctly from the description below. This is the
biggest, most detailed building of its set — spend the volume on it.

## The volume and coordinate system

- The volume is **72 wide (x) x 88 tall (y) x 72 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the keep, `0`-`71`. **y** runs up, `0` (bottom, the ground)
  to `87` (top). **z** runs front-to-back, `0`-`71`.
- **Forward is +z:** the gated front wall faces toward `z = 71` (the front). Up
  is +y.
- Build the keep **symmetric about the lengthwise vertical centerplane between
  `x = 35` and `x = 36`** where the form allows, with the gate centered in the
  front wall and the crown and beacon centered on the summit.
- The bastion is deliberately **massive and blocky** — a heavy masonry fortress
  rooted to the ground, filling most of the width and depth at its base and
  rising to a walled summit with a central spire.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled keep
  (the crown already ringing the summit, the gate already in the front wall, the
  beacon already atop the spire).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Crown, gate, beacon, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the bastion a clear
amber **energy accent** — a glowing collector ring, a lit beacon lens, and a
charged gate seam — so the accent reads from multiple angles.

## The parts

The bastion is a **rig** of four required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished keep:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The fortress keep and its ramparts |
| `solar_crown` | `base` | `[36, 76, 36]` | The solar collector crown |
| `gate` | `base` | `[36, 22, 70]` | The gate in the front wall |
| `beacon` | `base` | `[36, 84, 36]` | The signal beacon atop the spire |

- **`base`** is the **root** — the fixed fortress. Sculpt a massive, blocky
  masonry keep in the brass and bronze plating (bronze on its underside and in
  the shadowed seams, sandstone panels for lighter structure) sitting on the
  ground from `y = 0`, filling most of the width and depth at the foundation and
  rising through thick ramparts and corner towers to a walled summit with a
  central spire. Leave an **opening in the front wall** for the gate, a ring at
  the summit for the crown, and a spire top for the beacon so the children have
  something to seat against.
- **`solar_crown`** attaches at the summit at **`[36, 76, 36]`**. Sculpt an iron
  collector ring encircling the summit, standing proud of the walls, with
  solar-amber panels around its rim so it glows. It meets the summit at its ring
  with no gap, and is shaped so it turns cleanly about the vertical axis through
  its center.
- **`gate`** attaches in the front-wall opening at **`[36, 22, 70]`**. Sculpt a
  heavy iron portcullis-style gate filling the opening, sized to lift straight
  up and back down within the wall without touching its jambs, with a solar-amber
  charged seam. It meets the wall opening at its mount with no gap.
- **`beacon`** attaches atop the spire at **`[36, 84, 36]`**. Sculpt an iron
  beacon housing a bright solar-hot lens, standing on the spire top, shaped so it
  turns cleanly about the vertical axis through its center. It meets the spire top
  at its base with no gap.

## The required joints

All three animated elements **run on their own** — each carries an **auto**-driven
joint, driven by a decorative auto-play animation you author, so the bastion cycles
without any caller. There are **no** caller joints.

- **`crown_spin`** — a **rotation** about the **y** (up) axis, through the crown
  center at pivot **`[36, 76, 36]`**, **`drive = "auto"`**. Its range is a full
  turn, `min = -π`, `max = +π`, resting at `0`. Sculpt the crown so it rotates
  plausibly about its center without any voxel tearing away from the summit.
- **`gate_raise`** — a **translation** along the **y** (up) axis, through the gate
  mount at pivot **`[36, 22, 70]`**, **`drive = "auto"`**. Its range is
  **`min = 0` (fully lowered, shut, at rest) to `max = 16` (fully raised)**,
  resting at `0`. Sculpt the gate so it slides plausibly up and down about its
  mount without any voxel tearing away or clipping the wall.
- **`beacon_spin`** — a **rotation** about the **y** (up) axis, through the beacon
  center at pivot **`[36, 84, 36]`**, **`drive = "auto"`**. Its range is a full
  turn, `min = -π`, `max = +π`, resting at `0`. Sculpt the beacon so it rotates
  plausibly about its center without any voxel tearing away from the spire.

## The required animations

You must **author the motion** of each required animation yourself, as **F-curves**,
with the `voxel-anim` animation subcommands — `define-animation` to declare it,
then
`add-keyframe` to lay in each keyframe (see `voxel-anim --help`). The case does
**not** ship the keyframes: it declares each animation's identity and intent, and
**you** produce the curves. Each is a decorative **auto-play** idle
(`auto_play =
true`, `loop = true`) — it plays continuously on its own with no caller — and drives
its single joint. Give the motion weight with per-keyframe interpolation
(`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` Bézier tangents); the elements should move with an
eased, deliberate cadence, never a mechanical linear slide.

- **`crown_spin`** — `period_ms = 4000`. Drive the `crown_spin` joint one full,
  smooth revolution (about `-π → +π`) across the loop, so the collector crown turns
  steadily and continuously on its own.
- **`gate_raise`** — `period_ms = 3600`. Drive the `gate_raise` joint up from `0`
  (shut) to `16` (fully raised), **hold it open**, then lower it back to `0`, with
  weight into the lift and the settle — the gate rises, dwells open, and closes
  on
  its own each loop.
- **`beacon_spin`** — `period_ms = 5000`. Drive the `beacon_spin` joint one slow
  full revolution (about `-π → +π`) across the loop, so the beacon sweeps steadily
  and continuously on its own.

You **may add** your own extra parts, joints, or auto-play animations on top of
this
(for example flanking pennants, extra pipework, or a rotating dish), but you must
**not drop or contradict** the required parts, the three auto `crown_spin`,
`gate_raise`, and `beacon_spin` joints, or their three required animations.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the keep base with its walls, towers, and spire, then the crown, the gate, and the
beacon, checking each part's preview as you go. Define the parts, pivots, and the
three auto `crown_spin`, `gate_raise`, and `beacon_spin` joints through the tool's
rig subcommands (the required parts, joints, and animation declarations are already
pre-seeded in `rig.json`, but confirm they match this brief and adjust pivots to
your sculpt), then **author each required animation's F-curves** with
`define-animation` and `add-keyframe`. Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane), the rig subcommands, and the animation
subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
