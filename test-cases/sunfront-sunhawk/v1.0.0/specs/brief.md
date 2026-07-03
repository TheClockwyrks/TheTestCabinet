# Sunfront Sunhawk — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Sunhawk**, a wide, flat gunship
aircraft with two spinning rotors and an underslung forward cannon, as a **3D
voxel model** with a small **rig** a game can pose at runtime. There is no target
model to copy: build something that reads unmistakably as this gunship and poses
correctly from the description below.

## The volume and coordinate system

- The volume is **64 wide (x) x 36 tall (y) x 64 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the aircraft, `0`-`63`. **y** runs up, `0` (bottom) to `35`
  (top). **z** runs front-to-back, `0`-`63`.
- **Forward is +z:** the nose and cannon point toward `z = 63` (the front) when
  the cannon is at rest. Up is +y.
- Build the aircraft **symmetric about the lengthwise vertical centerplane between
  `x = 31` and `x = 32`** — the two rotors mirror each other, and the fuselage and
  cannon are centered on it.
- The Sunhawk is deliberately **wide and flat** — a low, broad gunship, not a tall
  one. It fills most of the width and length while staying shallow in height.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  aircraft (a rotor already out on its wing stub, the cannon already underslung
  at the nose).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — secondary panels (sandstone) | `#d9c48c` |
| Underside, shadowed seams (bronze) | `#7a5527` |
| Rotors, cannon, mechanisms (iron) | `#565c64` |
| Intake accent (solar amber) | `#ff9d2e` |

The **solar-amber** accent is the team-tint region: give the Sunhawk clear amber
**intakes** on the fuselage (a glow at the cannon's muzzle reads well too), so
the accent shows from multiple angles.

## The parts

The Sunhawk is a **rig** of four required parts in a parent/child hierarchy.
Sculpt each in its own local coordinates within the shared volume, positioned
where it sits on the finished aircraft:

| Part | Parent | Attaches at (pivot) | What it is |
| --- | --- | --- | --- |
| `hull` | *(root)* | `[0, 0, 0]` | The wide, flat fuselage |
| `rotor_left` | `hull` | `[14, 28, 32]` | The left rotor |
| `rotor_right` | `hull` | `[50, 28, 32]` | The right rotor |
| `cannon` | `hull` | `[32, 10, 44]` | The underslung forward cannon |

- **`hull`** is the **root** — the fixed body of the aircraft. Sculpt a wide, flat
  fuselage in the brass hull color (sandstone secondary panels, bronze on the
  underside and in the shadowed seams), running most of the depth and width and
  staying shallow in height. Shape a nose at the front (`z` toward `63`) and set
  the **solar-amber intakes** into the hull so they read from multiple angles. Out
  to each side, near `y = 28`, leave a stub or nacelle where a rotor mounts, and
  keep the underside of the nose fleshed out where the cannon hangs.
- **`rotor_left`** attaches out on the left wing stub at **`[14, 28, 32]`**. Sculpt
  a rotor in the iron color — a hub with a few blades reaching out sideways —
  centered over that mount, sitting up near `y = 28`. It must meet the stub at the
  mount with no gap.
- **`rotor_right`** attaches out on the right wing stub at **`[50, 28, 32]`**, a
  mirror of the left rotor in the same iron color.
- **`cannon`** attaches under the nose at **`[32, 10, 44]`**. Sculpt an underslung
  gun in the iron color projecting **forward (+z)** from beneath the fuselage,
  centered on the centerplane and meeting the hull at the mount with no gap. Shape
  it so it can tilt up and down about a horizontal hinge across its mount.

## The required joints

A consuming game drives the rig by joint name. The **required** caller joint is:

- **`cannon_pitch`** — a **rotation** about the **x** (across) axis, through the
  cannon's mount at pivot **`[32, 10, 44]`**, driven by the **caller** (the game).
  Its range is **`min = -0.9` (aimed down at the ground) to `max = 0.3` (tipped
  up)**, resting at **`-0.3`** (aimed a little down). Driving it must **tilt the
  whole cannon — as one solid piece — up and down about that hinge**, so the
  gunship can rake targets below. Only the cannon moves on this joint; no voxel
  of it should tear away from the hull or clip into the fuselage as it aims.

The rotors and the hover are driven by **`auto`** joints — no caller supplies their
value; the **animations you author** (below) move them:

- **`rotor_left_spin`** — a **rotation** about **y** (up) through **`[14, 28, 32]`**,
  a full turn (`min = -π`, `max = +π`), rest `0`, **`drive = "auto"`**.
- **`rotor_right_spin`** — the same about **`[50, 28, 32]`**, so the right rotor
  blurs alongside the left.
- **`hover_bob`** — a **translation** along **y** (up) through **`[32, 18, 32]`**,
  range **`min = -2.0` to `max = 2.0`**, rest `0`, **`drive = "auto"`**. Driving
  it
  lifts and lowers the **whole craft** slightly so it reads as hovering in place.

Sculpt each rotor so it rotates plausibly about its vertical mount without
detaching from the hull.

## The required animations — you author the motion

Beyond sculpting and rigging, you must **author each required animation's motion**
with the `voxel-anim` animation subcommands — `define-animation` to create the
animation, then `add-keyframe` for each pose along its timeline (run
`voxel-anim --help` for the exact subcommands and flags). The case ships **no**
keyframes; it declares each animation's identity and intent, and **you** produce
the curves. Author them as **F-curves** — set each keyframe's interpolation with
`--interp constant|linear|bezier|ease-in|ease-out|ease-in-out` (and, where it
helps, `--out-handle`/`--in-handle`) so the motion carries **weight and ease**,
not
a mechanical linear slide.

The three required animations are:

- **`rotor_spin`** (`period_ms = 240`, loops, **plays on its own**) — spins both
  rotors. Drive `rotor_left_spin` and `rotor_right_spin` a full turn (`-π → +π`)
  across the short period so the blades read as a continuous blur. This is a
  decorative idle that auto-plays; a smooth, near-constant-rate spin is right here.
- **`hover`** (`period_ms = 2400`, loops, playable) — the gunship's **hover /
  cruise movement**. Bob `hover_bob` gently up and down (rise, hold near the top,
  settle, hold near the bottom) so the craft breathes as it holds station. Ease
  the
  turns (`ease-in-out`) with a soft float at the top — it should feel buoyant, not
  like a sawtooth.
- **`strafe`** (`period_ms = 2000`, loops, playable) — the **cannon gun-run**. Sweep
  `cannon_pitch` down to rake the ground and back up, then loop. Ease into the
  bottom of the dive (`ease-in`) so the gun settles onto the target with weight
  before it tips back up; keep it within the joint's `-0.9 … 0.3` range.

You **may add** your own extra parts, joints, or auto-play animations on top of
this
(for example a tail fin, landing skids, or a subtle banking idle), but you must
**not drop or contradict** the required parts, the required caller `cannon_pitch`
joint, the three auto joints, or the three required animations above.

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish
the fuselage hull and nose, then each rotor, then the cannon, checking each part's
preview as you go. Define the parts, pivots, the caller `cannon_pitch` joint, the
three auto joints (`rotor_left_spin`, `rotor_right_spin`, `hover_bob`), and the
three required animations (`rotor_spin`, `hover`, `strafe`) through the tool's rig
and animation subcommands (the required parts, joints, and animation declarations
are already pre-seeded in `rig.json`, but confirm they match this brief, adjust
pivots to your sculpt, and author each animation's keyframes). Run `voxel-anim
--help` for the
available operations (setting and clearing single voxels, filling and stroking
boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Call `voxel-anim`
once per operation and read `parts/<part>.png` between calls to judge each part
against this brief.
