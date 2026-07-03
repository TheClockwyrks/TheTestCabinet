# Aegis — Surface Nets sculpting brief

You are sculpting the **Aegis**, a **colossal multi-gun war-fortress** that
stands on **six heavy legs** — a heavily armored walking stronghold that
**dwarfs every ordinary battlefield unit**. It carries a **dominant main
cannon**, **secondary guns**, and a **sensor vane**. Build it as a **static 3D
mesh** with the Surface Nets binary `sn` — one fixed pose, no rig, no target
model to copy, reading unmistakably as the Aegis.

## How meshing works (this is not a cube tool)

You do not place cubes: `sn` maintains a **continuous signed-distance field**,
meshing its surface. Shape it by **compositing** primitives — a CSG paradigm:

- **Add** material with `add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder`
  (each a center, an extent, an opaque `#rrggbb` color); **carve** with the
  matching `subtract-*` primitives.
- **`--blend <radius>`** selects a **smooth** join (default `0` = **hard**, a
  crease `sn` still rounds); `mirror`/`translate`/`copy`/`replace-color`/`clear`
  edit the whole field.

Build **one operation at a time**; the ordered operations produce the emitted
`mesh.json`, the **authoritative scored output**. `sn` re-renders `model.png`
after each call — **read it between calls**. `sn --help` is the contract.

## Surface Nets character — smooth, rounded, watertight

Surface Nets relaxes one vertex per surface cell, so it produces a **smooth,
rounded, watertight** surface with no sharp edges — corners round by
construction. **Design to it:** cast/molded armor with soft continuous surfaces,
domed turrets, cylindrical barrels and legs, all blended into one solid skin.
Don't fight it for knife-edges; use the fidelity to make the Aegis far more than
plain cubes.

## The volume and coordinate system

- The volume is **88 wide (x) × 80 tall (y) × 104 deep (z)** and starts
  **empty**; primitive centers/extents are **real-valued**, not grid-snapped.
- **x** runs across `0`–`87`; **y** up, `0` (ground) to `79`; **z**
  front-to-back `0`–`103`. **Forward is +z:** the main cannon points to `z=103`.
- Build it **symmetric about the vertical centerplane between `x = 43` and
  `x = 44`** (build one half, `mirror` across `x = 44`), **massive, tall, and
  broad**, filling much of the volume — never clipped past a face.

## What the Aegis is

At a glance it is a **colossal six-legged walking war-fortress facing +z**, made
of: a huge armored **hull / citadel** held up off the ground on its legs; **six
heavy legs**, three per side, each a clearly articulated limb (an upper thigh
and lower shin at a bent knee, on a broad flat foot) planted wide; a **main
turret** with a **dominant forward-firing main cannon** on the centerplane; a
**secondary turret out on each side**, mounted low on the flank; and a **sensor
/ radar vane** up top — every piece **blended into one watertight body**.

That is the *identity* — what the Aegis **is**. **The forms, proportions,
surface detailing, and exactly how each element is realized are yours to
invent.** This test measures creativity, so there is no prescribed silhouette —
shape it however reads best, provided it stays unmistakably the Aegis (colossal,
six-legged, multi-gun, symmetric, forward-firing) and owns its smooth look.

## Palette

Use only these opaque colors (off-palette colors and stray primitives count
against you):

| Role | Hex |
| --- | --- |
| Armor — primary plating (brass) | `#c69a4b` |
| Armor — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrels, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Command-eye / muzzle / running-light accent (solar amber) | `#ff9d2e` |

Set a clear **solar-amber** accent — a command eye or lamp on the main turret's
front, a muzzle glow, or a running-light stripe — so it shows from many angles.

## Working the tool

`sn` is the only channel; anything made another way is discarded. Build the
hull, legs, turrets, cannon, and vane as one symmetric half `mirror`-ed across
`x = 44`, using `--blend` to flow pieces into a rounded, watertight skin. Stop
when `model.png` reads as the Aegis — `mesh.json` is your submission.
