# Aegis — Surface Nets sculpting brief

You are sculpting the Aegis, a colossal multi-gun war-fortress that rides on six
heavy legs — a heavily armored walking stronghold that dwarfs every ordinary
battlefield unit. It carries a dominant main cannon, secondary guns, and a sensor
vane. Build it as a static 3D mesh with the Surface Nets binary `sn` — one fixed
pose, no rig, no target model to copy, reading unmistakably as the Aegis.

## How meshing works

`sn` maintains a continuous signed-distance field and meshes its surface. Shape that
field by compositing primitives:

- Add material with `add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder` (each a
  center, an extent, an opaque `#rrggbb` color); carve it away with the matching
  `subtract-*` primitives.
- `--blend <radius>` selects a smooth join (default `0` = hard); `mirror`/`translate`/
  `copy`/`replace-color`/`clear` edit the whole field.

Build one operation at a time. The field is meshed with Surface Nets, which produces
a smooth, rounded, watertight skin; corners round by construction. `sn` re-renders
`model.png` after each call — read it between calls, and run `sn --help` for the
operations contract. The recorded operations are the submission (the mesh is
extracted to `mesh.glb`).

## The volume and coordinate system

- The volume is **120 wide (x) × 110 tall (y) × 150 deep (z)** and starts empty;
  primitive centers/extents are real-valued, not grid-snapped.
- x runs across `0`–`119`; y up, `0` (ground) to `109`; z front-to-back `0`–`149`.
  Forward is +z: the main cannon points to `z=149`.
- Build it symmetric about the vertical centerplane between `x = 59` and `x = 60`
  (build one half, `mirror` across `x = 60`). It is length-dominant — long and broad,
  riding raised on its legs — so let it fill much of the volume, never clipped past a
  face.

## What the Aegis is

At a glance it is a colossal six-legged walking war-fortress facing +z, made of: a
huge armored hull / citadel held up off the ground on its legs; six heavy legs it
stands on, three per side, planted wide; a main turret with a dominant forward-firing
main cannon on the centerplane; a secondary turret out on each side, mounted low on
the flank; and a sensor / radar vane up top.

That is the identity — what the Aegis is. The forms, proportions, surface detailing,
and exactly how each element is realized are yours to invent. This test measures
creativity, so there is no prescribed silhouette — shape it however reads best,
provided it stays unmistakably the Aegis (colossal, six-legged, multi-gun, symmetric,
forward-firing).

## Palette

Use only these opaque colors (off-palette colors and stray primitives count against
you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle / running-light accent (solar amber) | `#ff9d2e` |

Set a clear solar-amber accent — a command eye or lamp on the main turret's front, a
muzzle glow, or a running-light stripe — so it shows from many angles.

## Working the tool

`sn` is the only channel; anything made another way is discarded. Build the hull,
legs, turrets, cannon, and vane as one symmetric half `mirror`-ed across `x = 60`,
using `--blend` to flow pieces into one watertight skin. Stop when `model.png` reads
as the Aegis — the recorded operations are your submission.
