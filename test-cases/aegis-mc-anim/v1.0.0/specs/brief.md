# Aegis — Marching Cubes compositing-and-rigging brief

You are compositing and rigging the Aegis, a colossal multi-gun war-fortress that
strides on legs — a heavily armored stronghold that dwarfs every ordinary
battlefield unit, carrying a dominant main cannon, secondary side guns, and a
sensor vane. Build it with `mc-anim` as a rigged 3D mesh a game poses at runtime.
There is no target model to copy: it must read unmistakably as the Aegis and
satisfy the animation contract below.

This brief fixes what the Aegis is and how it must move. It deliberately does not
give you a parts list, joint placements, or pose angles — working out the pieces a
walking, firing fortress needs, where they attach, and how they articulate is the
test. Invent the rig.

## How the tool works

`mc-anim` builds each part's geometry as a continuous signed-distance field and
meshes its surface. Shape a part by compositing primitives: add material with
`add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder` (each a center, an extent,
and an opaque `#rrggbb` color) and carve it away with the `subtract-*`
counterparts. `--blend <radius>` makes a smooth join (default `0` is a hard
crease), and `mirror`/`translate`/`copy`/`replace-color`/`clear` edit the whole
field. Every op names its part with `--part <name>` — each part is its own field,
meshed and previewed on its own — so create a part with `define-part` before you
sculpt into it.

Each part is meshed with Marching Cubes, which meshes on a coarse grid so the
surface reads faceted; detail finer than the grid is lost.

Build one operation at a time; each call only records to that part's log and
meshes/renders nothing. Run `mc-anim render` to extract the geometry and (re)draw
`parts/<part>.png` and the assembled `scene/*.png` — read them between calls — and
run it once more before you finish so every part's `.glb` is emitted (an unrendered
part is scored as empty); `--time`/`--animation` previews an animation and
`--component` renders one part. `mc-anim --help` is the contract.

## The volume and coordinate system

- Each field is framed by a **120 (x) × 110 (y) × 150 (z)** volume, starting
  empty; centers/extents are real-valued, not grid-snapped.
- **x** across `0`–`119`; **y** up, `0` (ground) to `109`; **z** front-to-back
  `0`–`149`. Forward is +z: the main cannon points toward higher `z` at rest.
- Build it roughly symmetric left-to-right across the centerplane at `x=60`
  (mirror between `x=59` and `x=60`) — long and broad, riding raised on its legs.
  It is longer front-to-back than it is wide, and no taller than it is wide.
- Each part is composited in these shared coordinates, where it sits on the
  assembled fortress.

## What the Aegis is (and what is yours to invent)

Fixed — the fortress must read unmistakably as all of these:

- A colossal armored citadel hull — a tiered, prowed stronghold, not a plain box
  — far bigger than any buildable unit, riding raised on legs.
- Multiple legs (at least four; more reads as heavier) that carry it and walk
  (see the animations).
- A big main turret on top with a dominant cannon projecting forward.
- A secondary turret out on each side (one per flank, plainly side-mounted, not
  on the roof).
- A radar/sensor vane up top that sweeps on its own.
- A clear solar-amber accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, number
and design of the legs, how the hull is tiered and prowed, how the turrets and
vane are shaped, and how you break the fortress into rig parts and place its
joints. Nothing here prescribes a shape; the test rewards a bold, characterful
design that is unmistakably the Aegis and animates convincingly.

## Palette

Use only these **opaque** colors (off-palette colors and stray primitives count
against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle / running-light accent (solar amber) | `#ff9d2e` |

Set a clear solar-amber accent (a command eye or lamp on the main turret, a
muzzle glow, a running-light stripe) so it shows from many angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with three required animation declarations by name; you
author each one's motion (its period and F-curves). Give the motion weight — legs
and guns are heavy.

- **`march`** — the walk (a game-triggered playable). The feet plant flat on the
  ground and the fortress advances over them so it reads as a heavy machine
  pushing itself forward, not flailing. Author it in place: the body does not
  translate across the scene — the leg cycle carries the stride, and a game
  supplies the real travel. The legs move; the guns hold.
- **`bombardment`** — the weapon showcase (a game-triggered playable). The main
  cannon holds its forward facing and elevates, and the two side turrets each
  traverse to sweep their own flank independently, while the fortress stands its
  ground and its legs stay planted.
- **`radar_spin`** — the sensor sweep (a self-playing idle). The radar vane turns
  continuously on its own, under both playables and at rest.

You may add extra parts, joints, and animations of your own; you must produce
these three animations, by these names, and must not contradict them (e.g. don't
move the legs under `bombardment` or the guns under `march`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the three
animations with `define-animation`/`add-keyframe` — running `mc-anim render` and
reading `parts/<part>.png` and the `scene/*.png` previews between calls to confirm
the parts fit, the legs reach the ground, and the animations read with weight, and
running `mc-anim render` once more before you finish so every part's `.glb` is
emitted. The recorded operations, the per-part `.glb`, and `rig.json` are your
scored submission.
