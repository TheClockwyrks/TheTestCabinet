# Aegis (Marching Cubes, Animated) — `v1.0.0`

This is version `v1.0.0` of the **Aegis (Marching Cubes, Animated)** test case, an
asset-generation case (`asset_kind = "mc-animation"`) that asks a model to
composite and rig a colossal Duneforged walking war-fortress as a 120×110×150
signed-distance-field model meshed with Marching Cubes, using only the `mc-anim`
tool, one recorded operation at a time, authoring its walk and weapon animations
as F-curves. The fortress is a multi-gun stronghold that dwarfs every buildable
unit and strides on legs.

`aegis-mc-anim` is the catalog slug for this case. This is a meshed voxel kind:
the model composites a signed-distance field that the `mc-anim` binary extracts
into a triangle mesh with Marching Cubes. There is no target model: the model
builds toward the seeded brief and is reviewed subjectively against it.

## The meshing tool: Marching Cubes

The rig is identical in shape to a cube `voxel-animation` case: the same parts,
joints, and animations. Only how each part's geometry is authored and emitted
changes. Marching Cubes gives a fixed low-poly faceted character of chunky flat
facets from a coarse sample grid. That character is the binary's, and the brief
tells the model to lean into it. Surface Nets and Dual Contouring are the smooth
and sharp-edged siblings.

- Tool: `[tool].binary = "mc-anim"`. Its vocabulary is CSG-style field
  compositing — `add-sphere`/`add-box`/`add-ellipsoid`/`add-cylinder`, their
  `subtract-*` counterparts, an optional `--blend` radius, `replace-color`, and
  `mirror`. `mc-anim --help` is the contract; no operations schema is seeded.
- Output: `[output].actions = "parts/{part}.actions.json"` is the recorded op
  log. The per-part triangle mesh Marching Cubes extracts is emitted
  automatically as a per-part `.glb` (binary glTF), the authoritative scored
  geometry.
- Everything else matches the cube animated kind: the `[voxel]` volume framing,
  the `[model]` rig, the previews through the shared `wgpu` renderer, and the
  review-against-brief flow with no `[[reference]]`.

## The rig

The `[model]` table declares only the game-facing contract: three required
animations, by name. The model invents the whole skeleton at run time: the
parts, their hierarchy and pivots, and the joints that drive them. The case
fixes no parts, joints, ranges, or pose angles. Working out the pieces a
walking, firing fortress needs is the test.

Each required animation is a declaration only: a `name`, a `loop` flag, and an
`auto_play` flag. The model authors the period and the F-curves at run time with
`mc-anim define-animation` and `add-keyframe`.

- `march` (`auto_play = false`) — the walk. The feet plant flat and the fortress
  advances over them, authored in place so the leg cycle carries the stride and
  a game supplies the real travel.
- `bombardment` (`auto_play = false`) — the main cannon aims forward and
  elevates while the two side turrets each sweep their own flank, the legs
  holding planted.
- `radar_spin` (`auto_play = true`) — the sensor vane turns continuously on its
  own, under both playables and at rest.

The model may add extra parts, joints, and animations of its own, and must
produce these three, by these names, consistently with what they describe.

## Contents

| Path             | Seeded to run? | Purpose                                                  |
| ---------------- | -------------- | -------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained compositing-and-rigging brief.        |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.            |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).        |
| `description.md` | No             | Site blurb.                                              |
| `README.md`      | No             | This overview.                                           |

A run receives the seeded brief, the `mc-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations with empty `parts` and
`joints` for the model to fill, so the contract exists from the first operation.

## Variants

Three variants composite and rig the same Aegis at three field sizes. `base`
(`variants/base.toml`) is listed first and is the default, inheriting the case's
120×110×150 volume; `half` and `double` override `[voxel]` with each extent
halved and doubled, and the brief is rendered at the selected size. Every
variant seeds the common brief and is rated on the case's single `overall`
scoring domain.

## Versioning

This case follows semantic versioning, one folder per version. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
