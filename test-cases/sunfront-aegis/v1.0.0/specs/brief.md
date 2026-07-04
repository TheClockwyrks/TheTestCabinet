# Sunfront Aegis — sculpting-and-rigging brief

You are sculpting and rigging the Sunfront Aegis, a colossal multi-gun war-fortress
that strides on legs — a heavily armored stronghold that dwarfs every ordinary
battlefield unit, carrying a dominant main cannon, secondary side guns, and a sensor
vane. Build it with `voxel-anim` (each part painted from opaque voxel cells) as a
rigged 3D voxel model a game poses at runtime. There is no target model to copy: it
must read unmistakably as the Aegis and satisfy the animation contract below.

This brief fixes what the Aegis is and how it must move. It deliberately does not
give you a parts list, joint placements, or pose angles — working out the pieces a
walking, firing fortress needs, where they attach, and how they articulate is the
test. Invent the rig.

## How the tool works

`voxel-anim` places discrete opaque cubes. Each part's geometry is a grid of voxel
cells you paint:

- Place and clear single cells, fill and stroke boxes, draw 3D lines and spheres, and
  set a mirror plane — each op naming an opaque `#rrggbb` color (there is no
  transparency).
- Global `--part <name>` selects the part an op sculpts; each part is its own voxel
  grid, previewed on its own. Create a part with `define-part` before you sculpt into
  it.

Build one operation at a time. A sculpting op only records — run `voxel-anim render` to
(re)draw `parts/<part>.png` and the assembled `scene/*.png` and read them between
calls, and run it before you finish so the per-part `.glb` geometry is emitted (an
unrendered part scores as empty). `voxel-anim --help` is the
contract.

## The volume and coordinate system

- Each part is sculpted into a **120 (x) × 110 (y) × 150 (z)** volume, starting
  empty; positions are whole-voxel grid cells.
- **x** across `0`–`119`; **y** up, `0` (ground) to `109`; **z** front-to-back
  `0`–`149`. **Forward is +z:** the main cannon points toward higher `z` at rest.
- Build it roughly symmetric left-to-right (about the centerplane between `x = 59`
  and `x = 60`). The fortress is broad and long — longer front-to-back than it is
  wide or tall — riding raised on its legs and filling much of the volume.
- Each part is sculpted in these shared coordinates, where it sits on the assembled
  fortress.

## What the Aegis is (and what is yours to invent)

Fixed — the fortress must read unmistakably as all of these:

- A colossal armored citadel hull — a tiered, prowed stronghold, not a plain box —
  far bigger than any buildable unit, riding raised on legs.
- Multiple legs (six reads as a heavy walker; at least four) that carry it and walk.
- A big main turret on top with a dominant cannon projecting forward.
- A secondary turret out on each side (one per flank, plainly side-mounted, not on
  the roof).
- A radar/sensor vane up top that sweeps on its own.
- A clear solar-amber accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, number and
design of the legs, how the hull is tiered and prowed, how the turrets and vane are
shaped, and how you break the fortress into rig parts and place its joints. Nothing
here prescribes a shape; the test rewards a bold, characterful design that is
unmistakably the Aegis and animates convincingly.

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

Set a clear solar-amber accent (a command eye or lamp on the main turret, a muzzle
glow, a running-light stripe) so it shows from many angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name (you
author the motion). Author each with `voxel-anim define-animation` then
`add-keyframe`, choosing the period and each key's `--interp`
(`constant`/`linear`/`bezier` or `ease-in`/`ease-out`/`ease-in-out`, with optional
`--in-handle`/`--out-handle`) so heavy legs and guns carry weight rather than sliding
linearly.

- **`march`** — the walk (a game-triggered playable). The feet plant flat on the
  ground and the fortress advances over them, so it reads as a heavy machine pushing
  itself forward, not flailing. Author it in place: the body stays centered in the
  volume and the clip must not translate the whole model across the scene — the leg
  cycle alone carries the stride (played on its own, a planted foot slides straight
  back under the body, treadmill-style, then swings forward), and a consuming game
  supplies the real forward travel. The legs move; the guns hold.
- **`bombardment`** — the weapon showcase (a game-triggered playable). The main
  cannon holds its forward facing and elevates, and each side turret traverses its
  own flank independently, while the fortress stands its ground and the legs stay
  planted.
- **`radar_spin`** — the sensor sweep (a self-playing idle). The radar vane turns
  continuously on its own, under both playables and at rest.

You may add extra parts, joints, and animations of your own; you must produce these
three animations, by these names, and must not contradict them (e.g. don't move the
legs under `bombardment` or the guns under `march`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the three animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the `scene/*.png` previews between calls to
confirm the parts fit, the legs seat and spread to the ground, and the animations read
with weight. The recorded per-part logs and `rig.json` are your scored submission.
