# Aegis (Surface Nets, Animated) — `v1.0.0`

This is version `v1.0.0` of the **Aegis (Surface Nets, Animated)** test case, an
asset-generation case (`asset_kind = "sn-animation"`) that asks a model to
sculpt and rig a colossal Duneforged walking war-fortress as a Surface Nets mesh
in a 120x110x150 volume, using only the `sn-anim` tool, one recorded operation
at a time, authoring its walk and weapon animations as F-curves. The fortress is
a multi-gun stronghold that dwarfs every buildable unit and strides on legs.

`aegis-sn-anim` is the catalog slug for this case. It shares the Aegis subject
and the Duneforged brass-and-bronze palette with its sibling meshed cases; the
meshing algorithm is what differs. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The meshing tool: Surface Nets

`sn-anim` maintains a continuous signed-distance field that the model shapes by
compositing primitives. It offers `add-`/`subtract-` spheres, boxes, ellipsoids
and cylinders, a `--blend` radius for smooth joins, and
`mirror`/`translate`/`copy`/`replace-color`/`clear`. It extracts the surface
with Surface Nets, which yields a smooth, watertight, uniformly tessellated,
rounded mesh with no sharp edges. The reviewer weighs whether the extracted
surface shows Surface Nets' smooth, rounded character rather than fighting the
algorithm for crisp edges it cannot deliver. Core emits each part's authored
field as a per-part `.glb` (binary glTF), and that is the authoritative geometry
a reviewer and the frontend read.

## The rig

The `[model]` table declares only the game-facing contract: three required
animations, by name. The model invents the whole skeleton at run time: the
parts, their hierarchy and pivots, and the joints that drive them. The case
fixes no parts, joints, ranges, or pose angles. Working out the pieces a
walking, firing fortress needs is the test.

Each required animation is a declaration only: a `name`, a `loop` flag, and an
`auto_play` flag. The model authors the period and the F-curves at run time with
`sn-anim define-animation` and `add-keyframe`.

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
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.          |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.            |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).        |
| `description.md` | No             | Site blurb.                                              |
| `README.md`      | No             | This overview.                                           |

A run receives the seeded brief, the `sn-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations with empty `parts` and
`joints` for the model to fill, so the contract exists from the first operation.
The binary's `--help` is the contract; no operations schema is seeded. Each
part's emitted per-part `.glb` plus `rig.json` are the authoritative output.

## Variants

Three variants sculpt and rig the same Aegis at three field sizes. `base`
(`variants/base.toml`) is listed first and is the default, inheriting the case's
120x110x150 volume; `half` and `double` override `[voxel]` with each extent
halved and doubled, and the brief is rendered at the selected size. Every
variant seeds the common brief and is rated on the case's single `overall`
scoring domain.

## Versioning

This case follows semantic versioning, one folder per version. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
