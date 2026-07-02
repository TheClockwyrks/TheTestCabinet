# Sunfront Aegis — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Aegis**, a colossal multi-gun **walking
fortress** that strides on six heavy legs, as a **3D voxel model** with a small
**rig** a game can pose at runtime. There is no target model to copy: build
something that reads unmistakably as a great six-legged war-fortress bristling with
guns — plainly far bigger than any ordinary battlefield unit — and poses correctly
from the description below.

## The volume and coordinate system

- The volume is **88 wide (x) x 80 tall (y) x 104 deep (z)**, in opaque voxels.
  It starts **empty**.
- **x** runs across the fortress, `0`-`87`. **y** runs up, `0` (bottom, the
  ground) to `79` (top). **z** runs front-to-back, `0`-`103`.
- **Forward is +z:** the main cannon points toward `z = 103` (the front) when the
  turret is at rest. Up is +y.
- Build the fortress **symmetric about the lengthwise vertical centerplane between
  `x = 43` and `x = 44`** — the two leg banks mirror each other, the main turret
  and cannon are centered on it, and the two side turrets mirror each other.
- The Aegis is deliberately **massive, tall, and broad** — a walking fortress that
  **dwarfs the buildable units**. It rides raised up on its legs. Fill much of this
  large volume: it should read as a war machine several times the bulk of an
  ordinary walker, wide and heavy, not a nimble one.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  fortress (a leg bank already under the hull's flank, the turret already up on
  the hull, the side turrets already out on the flanks).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: set a clear amber **command
eye or lamp on the front of the main turret** (a muzzle glow at each gun mouth
reads well too), so the accent shows from multiple angles.

## The parts

The fortress is a **rig** of seven required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished fortress:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored hull, raised on legs |
| `legs_left` | `chassis` | `[18, 16, 52]` | The three left legs, as one part |
| `legs_right` | `chassis` | `[70, 16, 52]` | The three right legs, as one part |
| `main_turret` | `chassis` | `[44, 60, 56]` | The big central turret |
| `main_gun` | `main_turret` | `[44, 66, 74]` | The main cannon on the turret front |
| `left_turret` | `chassis` | `[16, 56, 52]` | The rotating left-flank side turret |
| `right_turret` | `chassis` | `[71, 56, 52]` | The rotating right-flank side turret |

- **`chassis`** is the **root** — the fixed hull of the fortress. Sculpt a huge,
  broad, heavily armored hull in the brass armor color (bronze on its underside
  and shadowed seams) held **up off the ground on the legs**, running most of the
  depth and filling most of the width — a huge footprint. Keep the hull top flat
  around `y = 60` so the main turret has a mount to rest on, and build a raised
  **sponson shelf** out on each flank around `y = 56` for the side turrets. Keep
  the flanks solid low down (around `y = 16`) where the leg banks mount.
- **`legs_left`** attaches to the left flank at **`[18, 16, 52]`**. Sculpt a bank
  of **three heavy legs** in the iron color — thick, jointed legs reaching down
  and out to the ground from a shared low mount, positioned under the left side
  of the hull, holding the fortress up. They sit **below and against** the hull
  with no gap at the mount.
- **`legs_right`** attaches to the right flank at **`[70, 16, 52]`**, a mirror of
  the left bank — three more heavy legs in the same iron color.
- **`main_turret`** attaches to the top-center of the hull at **`[44, 60, 56]`**.
  Sculpt a big, blocky turret centered over that mount, sitting from about
  `y = 60` up. It must sit **on** the hull, meeting it at the mount with no gap
  and no voxel poking down into it. An amber command-eye on its front face reads
  well.
- **`main_gun`** attaches to the front of the main turret at **`[44, 66, 74]`**.
  Sculpt a long, heavy cannon in the iron color projecting **forward (+z)** from
  the turret's front, centered on the centerplane. It must meet the turret
  with no gap.
- **`left_turret`** attaches to the left sponson at **`[16, 56, 52]`**.
  Sculpt a smaller secondary gun **turret** — a stubby rotating turret with a
  short barrel projecting forward — out on the left flank, seated on the sponson
  shelf with no gap. Build it so it plainly reads as a turret that can **spin about
  a vertical axis** on its mount.
- **`right_turret`** attaches to the right sponson at **`[71, 56, 52]`**, a mirror
  of the left turret.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joints (the
game addresses each by name) are the four turret/gun controls, and each side
turret aims **independently** of the main turret:

- **`main_turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  turret's mount at pivot **`[44, 60, 56]`**, driven by the **caller**, range
  `min = -0.35`, `max = +0.35`, rest `0` (facing forward). It is a **narrow forward
  cone**, not a full swing: it makes only **fine corrections that keep the main
  cannon pointed forward** — the whole fortress turns its hull to bring a target
  into that cone, so the main gun points more or less straight ahead at all times.
  Across its range no voxel may tear away or clip into the hull.
- **`main_gun_pitch`** — a **rotation** about the **x** (across) axis, through the
  cannon's mount at pivot **`[44, 66, 74]`**, driven by the **caller**, range
  `min = -0.2` (barrel depressed) to `max = 0.8` (barrel lobbing high), rest `0.1`.
  It must **raise and lower the main cannon** about its mount without detaching
  from the turret.
- **`left_turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  left sponson mount at pivot **`[16, 56, 52]`**, driven by the **caller**, range
  `min = -1.6`, `max = 0.0`, rest `-0.8`. It **traverses the left side turret**
  through an arc that covers the fortress's **left flank** — from roughly straight
  ahead (`0`) round to straight out to the left (negative yaw turns it toward `-x`,
  the left side). It never swings across to cover the right side.
- **`right_turret_yaw`** — the mirror about the right sponson mount at pivot
  **`[71, 56, 52]`**, range `min = 0.0`, `max = 1.6`, rest `0.8`: an arc covering
  the **right flank**, from straight ahead round to straight out to the right
  (positive yaw turns it toward `+x`).

The two leg banks **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the fortress strides without the
caller:

- **`legs_left_stride`** — a **rotation** about **x** through **`[18, 16, 52]`**,
  `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`legs_right_stride`** — the same about **`[70, 16, 52]`**, driven in the
  opposite phase so the fortress walks in a slow, heavy stride.

Sculpt each side turret so it rotates plausibly about its own vertical sponson
mount, sweeping its flank arc without any voxel detaching from the hull, and sculpt
each leg bank so it swings plausibly forward and back about its mount without
detaching from the hull.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example antennae, a commander's cupola, or extra detail legs), but you
must **not drop or contradict** the required parts, the four required caller
joints, or the two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hull, then each leg bank, then the main turret, then the main cannon, then each
side turret, checking each part's preview as you go. Define the parts, pivots, the
four caller joints, and the two auto stride joints through the tool's rig
subcommands (the required parts and joints are already pre-seeded in `rig.json`,
but confirm they match this brief and adjust pivots to your sculpt). Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane) and the
rig subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
Call `voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
