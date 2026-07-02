# Sunfront Aegis — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Aegis**, a giant multi-gun **siege
fortress on treads**, as a **3D voxel model** with a small **rig** a game can pose
at runtime. There is no target model to copy: build something that reads
unmistakably as a great tracked war-fortress bristling with guns, and poses
correctly from the description below.

## The volume and coordinate system

- The volume is **72 wide (x) x 52 tall (y) x 88 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the fortress, `0`-`71`. **y** runs up, `0` (bottom, the
  ground) to `51` (top). **z** runs front-to-back, `0`-`87`.
- **Forward is +z:** the main cannon points toward `z = 87` (the front) when the
  turret is at rest. Up is +y.
- Build the fortress **symmetric about the lengthwise vertical centerplane between
  `x = 35` and `x = 36`** — the two tracks mirror each other, the main turret and
  cannon are centered on it, and the two side batteries mirror each other.
- The Aegis is deliberately **massive, low, and broad** — a rolling fortress, wide
  and heavy, not a nimble tank.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  fortress (the turret already up on the hull, the batteries already out on the
  flanks).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Treads, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: set a clear amber **command
eye or lamp on the front of the main turret** (a muzzle glow at each gun mouth
reads well too), so the accent shows from multiple angles.

## The parts

The fortress is a **rig** of five required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished fortress:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The tracked hull and its two treads |
| `main_turret` | `chassis` | `[36, 32, 44]` | The big central turret |
| `main_gun` | `main_turret` | `[36, 38, 58]` | The main cannon on the turret front |
| `left_battery` | `chassis` | `[12, 30, 40]` | The left-flank secondary gun |
| `right_battery` | `chassis` | `[60, 30, 40]` | The right-flank secondary gun |

- **`chassis`** is the **root** — the fixed base of the fortress. Sculpt a low,
  broad, heavily armored hull in the brass armor color (bronze on its underside
  and shadowed seams) sitting on the ground (from `y = 0`), running most of the
  depth.
  Down **each side**, along the full length, sculpt a **track** in the iron color,
  standing a little taller than the hull floor. Keep the hull top flat around
  `y = 32` so the main turret has a mount to rest on, and build a raised **sponson
  shelf** out on each flank around `y = 30` for the side batteries.
- **`main_turret`** attaches to the top-center of the hull at **`[36, 32, 44]`**.
  Sculpt a big, blocky turret centered over that mount, sitting from about
  `y = 32` up. It must sit **on** the hull, meeting it at the mount with no gap
  and no voxel poking down into it. An amber command-eye on its front face reads
  well.
- **`main_gun`** attaches to the front of the main turret at **`[36, 38, 58]`**.
  Sculpt a long, heavy cannon in the iron color projecting **forward (+z)** from
  the turret's front, centered on the centerplane. It must meet the turret
  with no gap.
- **`left_battery`** attaches to the left sponson at **`[12, 30, 40]`**.
  Sculpt a smaller secondary gun — a stubby turret or gun mantlet with a short
  barrel — out on the left flank, seated on the sponson shelf with no gap.
- **`right_battery`** attaches to the right sponson at **`[60, 30, 40]`**, a mirror
  of the left battery.

## The required joints

A consuming game drives the rig by joint name. The **required caller** joints are:

- **`main_turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  turret's mount at pivot **`[36, 32, 44]`**, driven by the **caller** (the game),
  range `min = -π`, `max = +π`, rest `0` (facing forward). It must **swing the
  whole main turret — and the main gun with it — left and right** about that mount,
  with no voxel tearing away or clipping into the hull.
- **`main_gun_pitch`** — a **rotation** about the **x** (across) axis, through the
  cannon's mount at pivot **`[36, 38, 58]`**, driven by the **caller**, range
  `min = -0.2` (barrel depressed) to `max = 0.8` (barrel lobbing high), rest `0.1`.
  It must **raise and lower the main cannon** about its mount without detaching
  from the turret.

The two side batteries **animate on their own** — each carries an **auto**-driven
sweep joint the case drives with a looping clip, so they rove without the caller:

- **`left_battery_pitch`** — a **rotation** about **x** through **`[12, 30, 40]`**,
  `min = 0.0`, `max = 0.9`, rest `0.3`, **`drive = "auto"`**.
- **`right_battery_pitch`** — the same about **`[60, 30, 40]`**, driven in the
  opposite phase.

Sculpt each side battery so it rotates plausibly up and down about its sponson
mount without detaching from the hull.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example antennae, a commander's cupola, or scrolling tread detail), but you
must **not drop or contradict** the required parts, the two required caller joints,
or the two auto battery joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the hull and its tracks, then the main turret, then the main cannon, then each side
battery, checking each part's preview as you go. Define the parts, pivots, the two
caller joints, and the two auto battery joints through the tool's rig subcommands
(the required parts and joints are already pre-seeded in `rig.json`, but confirm
they match this brief and adjust pivots to your sculpt). Run `voxel-anim --help`
for the available operations (setting and clearing single voxels, filling and
stroking boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands,
and `voxel-anim <operation> --help` for each one's exact flags. Call
`voxel-anim` once per operation and read `parts/<part>.png` between calls to
judge each part against this brief.
