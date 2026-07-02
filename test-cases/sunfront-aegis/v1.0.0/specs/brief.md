# Sunfront Aegis — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Aegis**, a tall, broad two-legged
guardian mech that carries a huge tower-shield on its left arm, as a **3D voxel
model** with a small **rig** a game can pose at runtime. There is no target model
to copy: build something that reads unmistakably as this shield-bearing guardian
and poses correctly from the description below.

## The volume and coordinate system

- The volume is **64 wide (x) x 76 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the guardian, `0`-`63`. **y** runs up, `0` (bottom, the
  ground) to `75` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the head and the face of the tower-shield look toward
  `z = 55` (the front) at rest. Up is +y.
- Build the guardian **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** — the two legs mirror each other and the torso and head
  are centered on it (the left tower-shield is the one deliberate asymmetry).
- The guardian is deliberately **tall and broad** — a heavy walking bulwark that
  stands most of the height, with a wide armored torso up top and two thick legs
  planted below.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  guardian (a leg already under the hip, the shield already up on the shoulder).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Armor — secondary panels, lighter structure (sandstone) | `#d9c48c` |
| Armor — shadowed structure (dark sandstone) | `#9c8455` |
| Trim — primary plating (brass) | `#c69a4b` |
| Trim — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, joints, shield rim, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Ward-glyph accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: set clear amber **ward-glyphs
into the face of the tower-shield** so the accent reads from multiple angles.

## The parts

The guardian is a **rig** of four required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished guardian:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The armored torso and head |
| `leg_left` | `torso` | `[20, 32, 28]` | The left leg |
| `leg_right` | `torso` | `[44, 32, 28]` | The right leg |
| `weapon` | `torso` | `[18, 46, 30]` | The left tower-shield arm |

- **`torso`** is the **root** — the fixed core of the guardian. Sculpt a tall,
  broad armored torso in the sandstone armor color (dark sandstone in the shadowed
  seams, brass and bronze trim on the plating) standing up high on the two legs,
  with a head set on top toward the front. Keep the underside and the shoulders
  fleshed out where the legs and the shield arm mount so the children have
  something to seat against.
- **`leg_left`** attaches under the torso at **`[20, 32, 28]`**. Sculpt a thick,
  jointed leg in the iron color reaching down to a planted foot on the ground,
  positioned under the left side of the torso. It sits **below and against** the
  torso with no gap at the hip.
- **`leg_right`** attaches under the torso at **`[44, 32, 28]`**, a mirror of the
  left leg in the same iron color.
- **`weapon`** attaches to the left shoulder at **`[18, 46, 30]`**. Sculpt a huge
  **tower-shield** carried on a short iron arm — a tall, broad slab facing forward
  (+z), taller than it is wide, with an iron rim and clear solar-amber ward-glyphs
  set into its face. Seat the arm against the left shoulder at the mount with no
  gap. Shape it so the whole shield-and-arm assembly tilts up and down about a
  horizontal axis through the shoulder.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`weapon_pitch`** — a **rotation** about the **x** (across) axis, through the
  shoulder mount at pivot **`[18, 46, 30]`**, driven by the **caller** (the game).
  Its range is **`min = -0.4` (shield dropped low) to `max = 0.8` (shield raised
  high)**, resting at **`0`** (holding the shield forward at guard). Driving it
  must **raise and lower the whole tower-shield about that shoulder axis** — the
  shield and its arm as one solid piece — so the guardian can bring the shield up
  to block. Only the shield arm moves on this joint; no voxel of it should tear
  away from the torso or clip into it as it swings.

The two legs **animate on their own** — each carries an **auto**-driven stride
joint the case drives with a looping clip, so the legs walk without the caller:

- **`leg_left_stride`** — a **rotation** about **x** through **`[20, 32, 28]`**,
  `min = -0.5`, `max = 0.5`, rest `0`, **`drive = "auto"`**.
- **`leg_right_stride`** — the same about **`[44, 32, 28]`**, driven in the
  opposite phase so the guardian walks in a natural gait.

Sculpt each leg so it rotates plausibly forward and back about its hip without
detaching from the torso.

You **may add** your own extra parts, joints, or auto-play clips on top of this
(for example a right-arm detail or a subtle head tilt), but you must **not drop
or contradict** the required parts, the required caller `weapon_pitch` joint, or
the two auto stride joints.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the torso and head, then each leg, then the tower-shield arm, checking each part's
preview as you go. Define the parts, pivots, the caller `weapon_pitch` joint, and
the two auto stride joints through the tool's rig subcommands (the required parts
and joints are already pre-seeded in `rig.json`, but confirm they match this brief
and adjust pivots to your sculpt). Run `voxel-anim --help` for the available
operations (setting and clearing single voxels, filling and stroking boxes, 3D
lines, spheres, and a mirror plane) and the rig subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Call `voxel-anim` once per
operation and read `parts/<part>.png` between calls to judge each part against
this brief.
