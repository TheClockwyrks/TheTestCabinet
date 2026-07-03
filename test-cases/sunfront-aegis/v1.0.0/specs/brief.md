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

The fortress is a **rig of twenty-four required parts** in a parent/child
hierarchy. Sculpt each in its own place within the shared volume, positioned
where it sits on the finished fortress. **Each of the six legs is three parts**
— an upper `thigh_*`, a lower `shin_*`, and a short flat `foot_*` — so the leg
is an articulated chain that bends at the knee and keeps its foot flat.

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored fortress hull, raised on legs |
| `thigh_lf` | `chassis` | `[14, 30, 78]` | Left-front thigh (upper leg) |
| `shin_lf` | `thigh_lf` | `[10, 14, 78]` | Left-front shin (lower leg) |
| `foot_lf` | `shin_lf` | `[8, 4, 78]` | Left-front foot (short, flat) |
| `thigh_lm` | `chassis` | `[14, 30, 52]` | Left-middle thigh |
| `shin_lm` | `thigh_lm` | `[10, 14, 52]` | Left-middle shin |
| `foot_lm` | `shin_lm` | `[8, 4, 52]` | Left-middle foot |
| `thigh_lr` | `chassis` | `[14, 30, 26]` | Left-rear thigh |
| `shin_lr` | `thigh_lr` | `[10, 14, 26]` | Left-rear shin |
| `foot_lr` | `shin_lr` | `[8, 4, 26]` | Left-rear foot |
| `thigh_rf` | `chassis` | `[73, 30, 78]` | Right-front thigh |
| `shin_rf` | `thigh_rf` | `[77, 14, 78]` | Right-front shin |
| `foot_rf` | `shin_rf` | `[79, 4, 78]` | Right-front foot |
| `thigh_rm` | `chassis` | `[73, 30, 52]` | Right-middle thigh |
| `shin_rm` | `thigh_rm` | `[77, 14, 52]` | Right-middle shin |
| `foot_rm` | `shin_rm` | `[79, 4, 52]` | Right-middle foot |
| `thigh_rr` | `chassis` | `[73, 30, 26]` | Right-rear thigh |
| `shin_rr` | `thigh_rr` | `[77, 14, 26]` | Right-rear shin |
| `foot_rr` | `shin_rr` | `[79, 4, 26]` | Right-rear foot |
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

### The legs (six legs, each a `thigh_*` + `shin_*` + `foot_*` chain)

The fortress stands on **six independent legs — three down each side** (front
`f`, middle `m`, rear `r`). Sculpt each leg as a **three-segment articulated
chain** — a thigh, a shin, and a short flat foot on **two moving joints** (a hip
and a knee) plus an ankle — so it walks like a real heavy machine, not a stick
swung from a hip:

- The **`thigh_*`** hangs from its **hip** on the hull's belly (pivot around
  `y = 30`, tucked under its corner of the hull) down and slightly outward to
  the knee. Sculpt it in the iron color as a thick, armored upper leg.
- The **`shin_*`** hangs from the **knee** (pivot around `y = 14`) down to the
  ankle. Sculpt it in iron as the lower leg.
- The **`foot_*`** is a short, **flat foot** on the **ankle** (pivot around
  `y = 4`) planted on the ground near `y = 0`. Sculpt it in iron as a broad,
  level foot — the part that carries the fortress's weight on the ground.
- **Rest pose is a clearly BENT knee, never a straight column.** Sculpt the
  thigh and shin so that at rest (knee folded to about `-0.7` rad) the leg reads
  as visibly bent — a straight leg has no room to extend and fold, so its foot
  cannot stay planted while the body passes over it.
- Each leg is its **own chain of parts**, mounted on its **own hip directly
  above its own foot** — the left legs' feet around `x = 8`, the right legs'
  around `x = 79`, spread wide for a stable, heavy stance. Do **not** sculpt the
  legs as one shared slab per side, and do **not** put a fore-and-aft spread of
  feet on one shared pivot: they must move independently, or rotating the bank
  drives the rear feet down through the ground while the front feet lift.
- The thigh meets the hull at the hip with no gap, the shin meets the thigh at
  the knee with no gap, and the foot meets the shin at the ankle with no gap,
  across the whole range of motion.

The three pivots per leg are the **hip** (`thigh_*` mounts to the hull), the
**knee** (`shin_*` mounts to the thigh), and the **ankle** (`foot_*` mounts to
the shin). Sculpt each segment so the hip can sweep the leg fore-and-aft, the
knee can fold to **lift the foot clear of the ground** on the swing, and the
ankle can counter-rotate to keep the **foot flat** — all without any voxel
tearing off and without the foot ever being driven down through the ground.

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

A consuming game drives the rig's **caller** joints by name, and the model
authors three **animations** — a **`march`** (the walk), a **`bombardment`**
(the guns), and a self-playing **`radar_spin`** — that the review viewer plays
back so a reviewer can watch the fortress move. The drive of each joint is
deliberate:

**The six legs — eighteen `auto` joints (a hip, a knee, and a foot per leg).**
Each leg has a hip that sweeps the whole leg fore-and-aft, a knee that folds the
shin to lift the foot, and an ankle that keeps the foot flat. They are all
**`auto`** — driven by the `march` walk you author; a game does not drive them
per frame. For each leg `X` (one of `lf, lm, lr, rf, rm, rr`):

- **`hip_X`** — a **rotation** about the **x** (across) axis, through that
  leg's hip pivot, range `min = -0.5`, `max = 0.5`, rest `0`. The big fore/aft
  sweep.
- **`knee_X`** — a **rotation** about the **x** axis, through that leg's knee
  pivot, range `min = -1.4`, `max = 0.2`, rest **`-0.7`** (a clearly BENT knee
  at rest). It folds the shin to **lift the foot off the ground** on the swing
  and extends to keep the foot planted through stance. The knee must bend the
  **reverse / digitigrade** way (folding the shin rearward); if your sculpt
  makes it bend "inside-out", **flip the sign** of the knee's animated values,
  not just the range.
- **`foot_X`** — a **rotation** about the **x** axis, through that leg's ankle
  pivot, range `min = -0.3`, `max = 0.3`, rest `0`. A small ±~15° ankle tilt
  that **counter-rotates against the shin to keep the foot flat** (never walking
  on toes or heels).

Sculpt each leg (bent-knee rest) so that, as its hip sweeps, its knee folds, and
its ankle counters across these ranges, the foot **plants flat, holds still on
the ground while the fortress passes over it, then lifts clear and plants
again** — a real step — with the shin staying attached to the thigh, the foot to
the shin, and the thigh to the hull, and no foot dragged below the ground.

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
  sweeps on its own forever, driven by the self-playing `radar_spin` animation —
  a decorative, always-moving detail that keeps turning under both playable
  animations and at idle. Sculpt the vane so it rotates plausibly about its
  vertical mast without any voxel leaving the citadel.

You **may add** your own extra parts, joints, or animations on top of this (for
example antennae, a commander's cupola, exhaust vents, or extra decorative
always-moving detail), but you must **not drop or contradict** the required
parts, the four required gun caller joints, the eighteen auto leg joints, the one
auto radar joint, or the three required animations below.

## The required animations — author each as F-curves

`rig.json` is pre-seeded with **three required animation declarations** — a
`name`, a `period_ms`, a `loop`/`auto_play` intent, and the `joints` each must
drive — **but no keyframes**. You must **author each animation's motion
yourself** with the `voxel-anim` animation subcommands: `define-animation` (to
confirm/redefine its period and flags) then `add-keyframe` for each keyframe on
each joint's track. Author them as **F-curves** — set each keyframe's `--interp`
(`constant`, `linear`, `bezier`, or the easing presets `ease-in`, `ease-out`,
`ease-in-out`), with optional `--out-handle <dt,dv>` / `--in-handle <dt,dv>`
Bézier tangents — so the motion **carries weight**, never sliding linearly
between poses. Run `voxel-anim --help` and `voxel-anim add-keyframe --help` for
the exact flags.

- **`march`** — the WALK. `period_ms = 1600`, `loop = true`, `auto_play = false`
  (a playable a game triggers). It drives all **eighteen** leg joints
  (`hip_*`, `knee_*`, `foot_*`). Author a real walk cycle: each leg has a
  **planted STANCE phase** — the foot flat and **still on the ground**,
  translating straight backward relative to the body while the fortress passes
  over it (hip and knee working together to hold the foot at a fixed ground
  point, the ankle counter-rotating to keep it flat) — then a **SWING** — the
  knee folds toward `-1.2` to lift the foot clear, the hip carries it forward,
  and the foot **plants** again. Give the plant a sharp **`ease-in`** on the
  final descent for the weight/"thump" of a heavy foot landing; ease the rest of
  the roll smoothly (`ease-in-out`/`bezier`). Do **not** author a continuous
  arc with no still, flat, planted segment — that reads as flailing, not walking.
  Design the foot path first (flat ground segment, then lift arc), then solve the
  hip/knee/ankle angles to it, then set the eased keys.
- **Gait phasing:** the six legs walk as **two alternating tripods** — tripod A
  = `lf, rm, lr` step together, tripod B = `rf, lm, rr` a **half period
  (800 ms)** out of phase — so **three feet are planted at all times** and the
  fortress is always supported.
- **`bombardment`** — the WEAPON showcase. `period_ms = 4000`, `loop = true`,
  `auto_play = false`. It drives only the **four gun caller joints**: the main
  cannon lobs forward (`main_gun_pitch` up and down) within its narrow cone
  (`main_turret_yaw` correcting), while the two side turrets each sweep their own
  flank arc (`left_turret_yaw`, `right_turret_yaw`) independently and out of
  phase. It touches **no leg joint**, so the legs hold planted. Ease the sweeps
  and lobs (`ease-in-out`) so they feel like heavy machinery, not linear slides.
- **`radar_spin`** — the decorative radar sweep. `period_ms = 3000`,
  `loop = true`, `auto_play = true` (a self-playing idle). It drives only the
  `radar_spin` joint, turning the vane a full sweep each loop; it plays
  continuously under both playable animations and at idle.

## Working the tool

The only way to place a voxel and edit the rig is the `voxel-anim` binary
already on your `PATH`. Sculpt each part up in sensible layers, selecting it
with `--part <name>` — finish the hull, then each leg's thigh, shin, and foot,
then the main turret, then the main cannon, then each side turret, then the
radar, checking each part's preview as you go. Define the parts, pivots, joints,
and animations through the tool's rig subcommands (the required parts, joints,
and animation declarations are already pre-seeded in `rig.json`, but confirm they
match this brief, adjust pivots to your sculpt, and author each animation's
keyframes). Run `voxel-anim --help` for the available operations (setting and
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
