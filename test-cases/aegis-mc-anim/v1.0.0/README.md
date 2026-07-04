# Aegis — Marching Cubes — `v1.0.0`

This is version `v1.0.0` of the **Aegis — Marching Cubes** test case: an
asset-generation case (`asset_kind = "mc-animation"`) that asks a model to
composite *and rig* a colossal Duneforged **walking war-fortress** — a
multi-gun stronghold that dwarfs every buildable unit and strides on legs —
as a 120×110×150 signed-distance-field model **meshed with Marching Cubes**,
using only the `mc-anim` tool, one recorded operation at a time, authoring its
walk and weapon animations as F-curves.

`aegis-mc-anim` is the catalog slug for this case. It is a **meshed** voxel
kind: the model does not paint discrete cells, it **composites a signed-distance
field** (adding and subtracting primitives, with an optional soft `--blend`)
that the `mc-anim` binary extracts into a triangle mesh with **Marching Cubes**
— a fixed, **low-poly faceted** character (chunky flat facets from a coarse
sample grid). There is no target model — the model builds toward the seeded
brief and is reviewed subjectively against it.

## Meshed kind — how it differs from the cube kinds

The rig (parts, joints, animations) is **identical in shape** to a cube
`voxel-animation` case; only how each part's geometry is authored and emitted
changes:

- **Tool:** `[tool].binary = "mc-anim"`. Its vocabulary is CSG-style field
  compositing (`add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder`, their
  `subtract-*` counterparts, an optional `--blend` radius, `replace-color`,
  `mirror`), **not** cell painting. `mc-anim --help` is the contract; no
  operations schema is seeded.
- **Output:** `[output].actions = "parts/{part}.actions.json"` — the recorded op
  log (as for any voxel case); the per-part triangle **mesh** Marching Cubes extracts
  is emitted automatically as a per-part `.glb` (binary glTF), the authoritative scored
  geometry.
- **Character:** Marching Cubes fixes the surface as **bold, low-poly,
  faceted**. It is the binary's character, not a manifest knob — the brief tells
  the model to lean into it. (Surface Nets and Dual Contouring are the smooth
  and sharp-edged siblings.)
- Everything else — `[voxel]` volume framing, the `[model]` rig, the previews
  through the shared `wgpu` renderer, the no-`[[reference]]`
  review-against-brief flow — matches the cube animated kind.

## The rig

The `[model]` table declares only the **game-facing contract**: three required
animations, by name. The model **invents** the whole skeleton — the parts, their
hierarchy and pivots, and the joints that drive them — at run time; the case fixes
no parts, joints, ranges, or pose angles. Working out the pieces a walking, firing
fortress needs is the test.

Each required animation is a declaration only — a `name`, a `loop` flag, and an
`auto_play` flag; the model authors the period and the F-curves at run time with
`mc-anim define-animation` / `add-keyframe`:

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
| `specs/brief.md` | **Yes**        | The self-contained compositing-and-rigging brief.        |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.            |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).        |
| `description.md` | No             | Site blurb.                                              |
| `README.md`      | No             | This overview.                                           |

A run receives the seeded brief, the `mc-anim` binary, and a pre-seeded
`rig.json` holding only the required animation declarations (with empty `parts`
and `joints` for the model to fill), so the contract exists from the first
operation. There is no target model and no
operations schema — the binary's `--help` is the contract.

## Variants

The Aegis ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
single `fidelity` scoring domain; it adds no specs, review items, or domains of
its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/aegis-mc-anim/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
