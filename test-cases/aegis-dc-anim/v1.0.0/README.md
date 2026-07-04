# Aegis (Dual Contouring, Animated) — `v1.0.0`

This is version `v1.0.0` of the **Aegis (Dual Contouring, Animated)** test case:
an asset-generation case (`asset_kind = "dc-animation"`) that asks a model to
mesh *and rig* a colossal Duneforged **walking war-fortress** — a multi-gun
stronghold that dwarfs every buildable unit and strides on legs — as a **Dual
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
crisp or is rounded, independent of the blend radius. A `[[review_item]]` scores
whether the extracted surface shows those crisp edges rather than a uniformly
rounded one; how the model uses that character is its own design choice.
Each part's authored field is emitted as a per-part `.glb` (binary glTF)
automatically by core, and that is the authoritative geometry a reviewer and the
frontend read. The binary's `--help` is the contract; no
operations schema is seeded.

## The rig

The `[model]` table declares only the **game-facing contract**: three required
animations, by name. The model **invents** the whole skeleton — the parts, their
hierarchy and pivots, and the joints that drive them — at run time; the case fixes
no parts, joints, ranges, or pose angles. Working out the pieces a walking, firing
fortress needs is the test.

Each required animation is a declaration only — a `name`, a `loop` flag, and an
`auto_play` flag; the model authors the period and the F-curves at run time with
`dc-anim define-animation` / `add-keyframe`:

- **`march`** (`auto_play = false`) — the walk: the feet plant flat and the
  fortress advances over them, authored in place so the leg cycle carries the
  stride and a game supplies the real travel.
- **`bombardment`** (`auto_play = false`) — the main cannon aims forward and
  elevates while the two side turrets each sweep their own flank, the legs holding
  planted.
- **`radar_spin`** (`auto_play = true`) — the sensor vane turns continuously on its
  own, under both playables and at rest.

The model may add its own extra parts, joints, and animations, but must not drop or
contradict these three.

## Contents

| Path             | Seeded to run? | Purpose                                                  |
| ---------------- | -------------- | -------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained meshing-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.            |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).        |
| `description.md` | No             | Site blurb.                                              |
| `README.md`      | No             | This overview.                                           |

A run receives the seeded brief, the `dc-anim` binary, and a pre-seeded
`rig.json` holding only the required animation declarations (with empty `parts`
and `joints` for the model to fill), so the contract exists from the first
operation. There is no target model and no
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
