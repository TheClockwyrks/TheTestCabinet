# Sunfront Aegis — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Aegis**, a colossal multi-gun
**walking fortress** that strides on **six heavy legs**, as a **3D voxel model**
with a **rig** a game can pose at runtime. There is no target model to copy:
build something that reads unmistakably as a great six-legged war-fortress
bristling with guns — plainly far bigger than any ordinary battlefield unit —
and poses correctly from the description below.

## The volume and coordinate system

- The volume is **88 wide (x) x 80 tall (y) x 104 deep (z)**, in opaque voxels.
  It starts **empty**.
- **x** runs across the fortress, `0`-`87`. **y** runs up, `0` (bottom, the
  ground) to `79` (top). **z** runs front-to-back, `0`-`103`.
- **Forward is +z:** the main cannon points toward `z = 103` (the front) when
  the turret is at rest. Up is +y.
- Build the fortress **symmetric about the lengthwise vertical centerplane
  between `x = 43` and `x = 44`** — the two banks of legs mirror each other, the
  main turret and cannon are centered on it, and the two side turrets mirror
  each other.
- The Aegis is deliberately **massive, tall, and broad** — a walking fortress
  that **dwarfs the buildable units**. It rides raised up on its legs. Fill much
  of this large volume: it should read as a war machine several times the bulk
  of an ordinary walker, wide and heavy, not a nimble one.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  fortress (a leg already under the hull's corner, the turret already up on the
  hull, a side turret already out on its sponson).

## Make it a fortress, not a box on legs

This must read as an **actual war machine**, not a cube raised on sticks. Give
the hull real shape and detail: a **sloped, beveled prow** at the front where
the armor angles back; **stepped, tiered decks** rather than one flat slab; a
raised **command citadel** at the center where the main turret sits;
**sponsons** — shelves that clearly jut out from the left and right faces —
carrying the side turrets; and small read-at-a-glance details (vents, hatches,
plating seams, a banner or amber running lights). The six legs are **thick,
jointed, and clearly articulated** (an upper thigh and a lower shin with a
visible knee), not straight posts. Aim for a silhouette a viewer would call "a
striding fortress," instantly distinct from a plain armored box.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle / running-light accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: set a clear amber **command
eye or lamp on the front of the main turret** (a muzzle glow at each gun mouth,
or a running-light stripe, reads well too), so the accent shows from multiple
angles.

## The parts

The fortress is a **rig of nineteen required parts** in a parent/child
hierarchy. Sculpt each in its own place within the shared volume, positioned
where it sits on the finished fortress. **Each of the six legs is two parts** —
an upper `leg_*` thigh and a lower `shin_*` — so the leg can bend at the knee.

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored fortress hull, raised on legs |
| `leg_lf` | `chassis` | `[14, 30, 78]` | Left-front thigh (upper leg) |
| `shin_lf` | `leg_lf` | `[10, 14, 78]` | Left-front shin (lower leg + foot) |
| `leg_lm` | `chassis` | `[14, 30, 52]` | Left-middle thigh |
| `shin_lm` | `leg_lm` | `[10, 14, 52]` | Left-middle shin |
| `leg_lr` | `chassis` | `[14, 30, 26]` | Left-rear thigh |
| `shin_lr` | `leg_lr` | `[10, 14, 26]` | Left-rear shin |
| `leg_rf` | `chassis` | `[73, 30, 78]` | Right-front thigh |
| `shin_rf` | `leg_rf` | `[77, 14, 78]` | Right-front shin |
| `leg_rm` | `chassis` | `[73, 30, 52]` | Right-middle thigh |
| `shin_rm` | `leg_rm` | `[77, 14, 52]` | Right-middle shin |
| `leg_rr` | `chassis` | `[73, 30, 26]` | Right-rear thigh |
| `shin_rr` | `leg_rr` | `[77, 14, 26]` | Right-rear shin |
| `main_turret` | `chassis` | `[44, 60, 56]` | The big central turret |
| `main_gun` | `main_turret` | `[44, 66, 74]` | The main cannon on the turret front |
| `left_turret` | `chassis` | `[12, 44, 52]` | The rotating LEFT-side turret, on its sponson |
| `right_turret` | `chassis` | `[75, 44, 52]` | The rotating RIGHT-side turret, on its sponson |
| `radar` | `chassis` | `[44, 72, 40]` | The decorative sweeping radar/sensor vane |

- **`chassis`** is the **root** — the fixed hull of the fortress. Sculpt a
  huge, broad, heavily armored citadel in the brass armor color (bronze on its
  underside and shadowed seams), held **up off the ground on the legs**, running
  most of the depth and filling most of the width — a huge footprint, with the
  shape and detail described above. Keep the hull top around `y = 60` under the
  main turret so it has a mount to rest on, build a **sponson shelf** jutting
  out of each side face around `y = 44` for the side turrets, and keep the belly
  solid around `y = 30` where the six leg hips mount.

### The legs (six legs, each an upper `leg_*` + a lower `shin_*`)

The fortress stands on **six independent legs — three down each side** (front
`f`, middle `m`, rear `r`). Sculpt each leg as **two segments** so it bends like
a real walking leg:

- The **`leg_*` thigh** hangs from its **hip** on the hull's belly (pivot
  around `y = 30`, tucked under its corner of the hull) down and slightly
  outward to the knee. Sculpt it in the iron color as a thick, armored upper
  leg.
- The **`shin_*`** hangs from the **knee** (pivot around `y = 14`) straight
  down to a broad **foot** planted on the ground at `y = 0`. Sculpt it in iron
  as the lower leg and foot.
- Each leg is its **own pair of parts**, mounted on its **own hip directly
  above its own foot** — the left legs' feet around `x = 10`, the right legs'
  around `x = 77`, spread wide for a stable, heavy stance. Do **not** sculpt the
  legs as one shared slab per side: they must move independently.
- The leg meets the hull at the hip with no gap, and the shin meets the thigh
  at the knee with no gap, across the whole range of motion.

The pivots above are the **hips** (`leg_*` mount to the hull) and the **knees**
(`shin_*` mount to the thigh). Sculpt each segment so the hip can swing it
fore-and-aft and the knee can bend the shin to **lift the foot clear of the
ground** without any voxel tearing off, and without the foot ever being driven
down through the ground.

### The turrets, cannon, and radar

- **`main_turret`** attaches to the top-center of the hull at **`[44, 60,
  56]`**. Sculpt a big, blocky turret centered over that mount, sitting from
  about `y = 60` up. It must sit **on** the hull, meeting it at the mount with
  no gap and no voxel poking down into it. An amber command-eye on its front
  face reads well.
- **`main_gun`** attaches to the front of the main turret at **`[44, 66,
  74]`**. Sculpt a long, heavy cannon in the iron color projecting **forward
  (+z)** from the turret's front, centered on the centerplane. It must meet the
  turret with no gap.
- **`left_turret`** attaches to the **left sponson** at **`[12, 44, 52]`** —
  out on the shelf that juts from the **left face** of the hull, plainly a
  **side-mounted** gun, low on the flank rather than up on the roof. Sculpt a
  stubby rotating turret with a short barrel projecting forward, seated on the
  sponson with no gap. Build it so it clearly reads as a turret that **spins
  about a vertical axis** on its mount to sweep the **left side** of the
  fortress.
- **`right_turret`** attaches to the **right sponson** at **`[75, 44, 52]`**, a
  mirror of the left turret, sweeping the **right side**. Each side turret is
  built to cover **only its own flank** — mounting them out on the sides, one
  per face, is what makes that read.
- **`radar`** attaches atop the command citadel at **`[44, 72, 40]`**. Sculpt a
  small **radar dish or sensor vane** in iron with an amber lamp — a decorative
  detail that **turns on its own forever**. It is not a weapon.

## The required joints

A consuming game drives the rig by joint name, and the review viewer offers two
play-back **animations** — a **`march`** (the walk) and a **`bombardment`** (the
guns) — so a reviewer can watch the fortress move without dragging sliders. The
drive of each joint is deliberate:

**The six legs — twelve caller joints (a hip and a knee per leg).** Each leg has
a hip that swings the whole leg fore-and-aft and a knee that bends the shin to
lift the foot. They are **caller-driven**, so at rest the legs **hold still,
planted and standing** (the fortress does not walk on its own); the `march`
animation strides them. For each leg `X` (one of `lf, lm, lr, rf, rm, rr`):

- **`hip_X`** — a **rotation** about the **x** (across) axis, through that
  leg's hip pivot, range `min = -0.4`, `max = 0.4`, rest `0`. It swings the
  whole leg forward and back.
- **`knee_X`** — a **rotation** about the **x** axis, through that leg's knee
  pivot, range `min = -0.2`, `max = 1.0`, rest `0.1`. It bends the shin to
  **lift the foot off the ground** on the leg's forward swing and straightens to
  plant it.

Sculpt each leg so that, as its hip swings and its knee bends across these
ranges, the foot **lifts clear of the ground and plants again** — a real step —
with the shin staying attached to the thigh and the thigh to the hull, and no
foot dragged below the ground.

**The main turret and cannon — two caller joints.** Both **caller-driven** (they
hold still unless the game or the `bombardment` animation drives them):

- **`main_turret_yaw`** — a **rotation** about the **y** (up) axis, through the
  turret's mount at **`[44, 60, 56]`**, range `min = -0.35`, `max = 0.35`, rest
  `0` (facing forward). It is a **narrow forward cone**, not a full swing: it
  makes only **fine corrections that keep the main cannon pointed forward** —
  the whole fortress turns its hull to bring a target into that cone. Across its
  range no voxel may tear away or clip into the hull.
- **`main_gun_pitch`** — a **rotation** about the **x** (across) axis, through
  the cannon's mount at **`[44, 66, 74]`**, range `min = -0.2` (barrel
  depressed) to `max = 0.8` (barrel lobbing high), rest `0.1`. It **raises and
  lowers the main cannon** about its mount without detaching from the turret.

**The two side turrets — two caller joints.** Each aims **independently** of the
main turret and of each other, and only within an arc covering **its own
flank**:

- **`left_turret_yaw`** — a **rotation** about the **y** axis, through the left
  sponson mount at **`[12, 44, 52]`**, range `min = -1.6`, `max = 0.0`, rest
  `-0.8`. It traverses the left turret across the fortress's **left flank** —
  from roughly straight ahead (`0`) round to straight out to the left (negative
  yaw turns it toward `-x`). It never swings across to cover the right side.
- **`right_turret_yaw`** — the mirror about the right sponson mount at **`[75,
  44, 52]`**, range `min = 0.0`, `max = 1.6`, rest `0.8`: an arc covering the
  **right flank**, from straight ahead round to straight out to the right
  (positive yaw turns it toward `+x`).

**The radar — one auto joint.** This one is **not** caller-driven:

- **`radar_spin`** — a **rotation** about the **y** axis through **`[44, 72,
  40]`**, `min = -3.14159`, `max = 3.14159`, rest `0`, **`drive = "auto"`**. It
  sweeps on its own forever via a looping clip — a decorative, always-moving
  detail that keeps turning under both animations and at idle. Sculpt the vane
  so it rotates plausibly about its vertical mast without any voxel leaving the
  citadel.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example antennae, a commander's cupola, exhaust vents, or extra decorative
always-moving detail), but you must **not drop or contradict** the required
parts, the sixteen required caller joints (twelve leg + four gun), or the one
auto radar joint.

## Working the tool

The only way to place a voxel and edit the rig is the `voxel-anim` binary
already on your `PATH`. Sculpt each part up in sensible layers, selecting it
with `--part <name>` — finish the hull, then each leg's thigh and shin, then the
main turret, then the main cannon, then each side turret, then the radar,
checking each part's preview as you go. Define the parts, pivots, and joints
through the tool's rig subcommands (the required parts and joints are already
pre-seeded in `rig.json`, but confirm they match this brief and adjust pivots to
your sculpt). Run `voxel-anim --help` for the available operations (setting and
clearing single voxels, filling and stroking boxes, 3D lines, spheres, and a
mirror plane) and the rig subcommands, and `voxel-anim <operation> --help` for
each one's exact flags. Call `voxel-anim` once per operation, read
`parts/<part>.png` after your calls to judge each part, and read the
assembled-scene previews under `scene/` (`scene/iso.png`, `scene/front.png`,
`scene/side.png`, `scene/top.png`) — the whole fortress composed from all your
parts — to confirm the parts fit together: the legs seated under the hull and
spread to the ground, the main turret centered on the citadel, the cannon
meeting the turret front, each side turret out on its sponson, and the radar up
top.
