# Aegis (Dual Contouring, Animated) — `v1.0.0`

This is version `v1.0.0` of the **Aegis (Dual Contouring, Animated)** test case:
an asset-generation case (`asset_kind = "dc-animation"`) that asks a model to
mesh *and rig* a colossal Duneforged **six-legged walking fortress** — a
multi-gun war-fortress that dwarfs every buildable unit and strides on six
**independent three-segment legs** (thigh + shin + flat foot) — as a **Dual
Contouring mesh** in a 120x110x150 volume using only the `dc-anim` tool, one
recorded operation at a time, authoring its walk and weapon animations as
F-curves.

`aegis-dc-anim` is the catalog slug for this case. It shares the Aegis subject
and the Duneforged brass-and-bronze palette with its sibling meshed cases; what
differs is the **meshing algorithm**. There is no target model — the model
builds toward the seeded brief and is reviewed subjectively against it.

## The meshing tool: Dual Contouring

Unlike a cube voxel case, `dc-anim` does not place discrete cells. It maintains
a **continuous signed-distance field** the model shapes by **compositing
primitives** — `add-`/`subtract-` spheres, boxes, ellipsoids, and cylinders, a
`--blend` radius for smooth joins, plus
`mirror`/`translate`/`copy`/`replace-color`/`clear` — and extracts its surface
with **Dual Contouring**: a high-fidelity extractor (fine grid + QEF) that
**preserves sharp edges and corners**. Hard unions (`--blend 0`) leave genuine
creases DC keeps for free, and — uniquely among the meshers — DC exposes a
per-primitive **`--sharp` / `--smooth`** tag that controls whether an edge stays
crisp or is rounded, independent of the blend radius. The brief tunes the Aegis
to that character (crisp hard-surface armor with clean edges and defined panel
seams, rounded forms only where chosen), and a `[[review_item]]` scores whether
the submission plays to it rather than producing a uniformly rounded surface.
Each part's authored field is emitted as a per-part `.glb` (binary glTF)
automatically by core, and that is the authoritative geometry a reviewer and the
frontend read. The binary's `--help` is the contract; no
operations schema is seeded.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]`
table — **twenty-four parts** (the hull, six three-segment legs, the main turret
and cannon, two side turrets, and the radar):

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored fortress hull, raised on legs |
| `thigh_lf` / `shin_lf` / `foot_lf` | `chassis` / `thigh_lf` / `shin_lf` | `[14,30,78]` / `[10,14,78]` / `[8,4,78]` | Left-front thigh + shin + foot |
| `thigh_lm` / `shin_lm` / `foot_lm` | `chassis` / `thigh_lm` / `shin_lm` | `[14,30,52]` / `[10,14,52]` / `[8,4,52]` | Left-middle leg |
| `thigh_lr` / `shin_lr` / `foot_lr` | `chassis` / `thigh_lr` / `shin_lr` | `[14,30,26]` / `[10,14,26]` / `[8,4,26]` | Left-rear leg |
| `thigh_rf` / `shin_rf` / `foot_rf` | `chassis` / `thigh_rf` / `shin_rf` | `[73,30,78]` / `[77,14,78]` / `[79,4,78]` | Right-front leg |
| `thigh_rm` / `shin_rm` / `foot_rm` | `chassis` / `thigh_rm` / `shin_rm` | `[73,30,52]` / `[77,14,52]` / `[79,4,52]` | Right-middle leg |
| `thigh_rr` / `shin_rr` / `foot_rr` | `chassis` / `thigh_rr` / `shin_rr` | `[73,30,26]` / `[77,14,26]` / `[79,4,26]` | Right-rear leg |
| `main_turret` | `chassis` | `[44, 60, 56]` | The big central turret |
| `main_gun` | `main_turret` | `[44, 66, 74]` | The main cannon on the turret front |
| `left_turret` | `chassis` | `[12, 44, 52]` | The rotating left-side turret, on its sponson |
| `right_turret` | `chassis` | `[75, 44, 52]` | The rotating right-side turret, on its sponson |
| `radar` | `chassis` | `[44, 72, 40]` | The decorative sweeping radar vane |

The joints — **eighteen auto leg joints**, **four caller gun joints**, and **one
auto radar joint** — and the deliberate drive of each:

- **`hip_*`** / **`knee_*`** / **`foot_*`** (auto, rotation about `x`) —
  eighteen leg joints, a hip, a knee, and an ankle for each of the six legs
  (`lf, lm, lr, rf, rm, rr`). The hip sweeps the leg fore-and-aft (`-0.5..0.5`);
  the knee folds the shin the reverse/digitigrade way (`-1.4..0.2`, **rest
  `-0.7` — a bent knee**) to lift the foot clear; the ankle (`-0.3..0.3`) keeps
  the foot flat. Each leg is an independent three-segment chain on its own hip
  above its own foot — so no single pivot drags a bank of feet below ground.
  Auto-driven by the model-authored `march` walk.
- **`main_turret_yaw`** (caller, rotation about `y`, `-0.35..0.35`) — a narrow
  forward cone that keeps the main cannon pointed forward; the fortress turns
  its hull to aim.
- **`main_gun_pitch`** (caller, rotation about `x`, `-0.2..0.8`) — elevates the
  main cannon about its mount.
- **`left_turret_yaw`** (caller, rotation about `y`, `-1.6..0.0`) /
  **`right_turret_yaw`** (caller, rotation about `y`, `0.0..1.6`) — traverse the
  two **side-mounted** turrets so each swings independently to cover only its
  own flank.
- **`radar_spin`** (auto, rotation about `y`, `-π..π`) — sweeps the decorative
  radar vane on its own forever, driven by the self-playing `radar_spin`
  animation.

The `[model]` table declares **three required animations** as declarations only
(name, period, loop/auto_play, and the joints each drives — **no keyframes**);
the model authors their F-curves at run time with `dc-anim define-animation` /
`add-keyframe`. **`march`** (`auto_play = false`) drives the eighteen leg joints
in a two-tripod gait with a planted, flat, still stance phase and an `ease-in`
foot-plant. **`bombardment`** (`auto_play = false`) drives only the four gun
joints — the main cannon lobs forward while the side turrets sweep their own
flanks — while the legs hold planted. **`radar_spin`** (`auto_play = true`) is
the decorative self-playing radar sweep. The model may add its own extra parts,
joints, and animations on top, but must not drop or contradict the required
interface.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained meshing-and-rigging brief.              |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, the rig, and review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `dc-anim` binary, and a pre-seeded
`rig.json` holding the required parts, joints, and animation declarations (so
the contract exists from the first operation). There is no target model and no
operations schema — the binary's `--help` is the contract, and each part's
emitted per-part `.glb` plus `rig.json` are the authoritative output.

## Variants

The Aegis ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
single `fidelity` scoring domain; it adds no specs, review items, or domains of
its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/aegis-dc-anim/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
