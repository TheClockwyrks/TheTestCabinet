# Aegis (Dual Contouring, Animated) — `v1.0.0`

This is version `v1.0.0` of the **Aegis (Dual Contouring, Animated)** test case,
an asset-generation case (`asset_kind = "dc-animation"`) that asks a model to
mesh and rig a colossal Duneforged walking war-fortress as a Dual Contouring
mesh in a 120x110x150 volume, using only the `dc-anim` tool, one recorded
operation at a time, authoring its walk and weapon animations as F-curves. The
fortress is a multi-gun stronghold that dwarfs every buildable unit and strides
on legs.

`aegis-dc-anim` is the catalog slug for this case. It shares the Aegis subject
and the Duneforged brass-and-bronze palette with its sibling meshed cases; the
meshing algorithm is what differs. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The meshing tool: Dual Contouring

`dc-anim` maintains a continuous signed-distance field that the model shapes by
compositing primitives. It offers `add-`/`subtract-` spheres, boxes, ellipsoids
and cylinders, a `--blend` radius for smooth joins, and
`mirror`/`translate`/`copy`/`replace-color`/`clear`. It extracts the surface
with Dual Contouring, a high-fidelity extractor built on a fine grid and QEF
that preserves sharp edges and corners.

A hard union, `--blend 0`, leaves genuine creases that Dual Contouring keeps for
free. Dual Contouring alone among the meshers also exposes a per-primitive
`--sharp`/`--smooth` tag that controls whether an edge stays crisp or is
rounded, independent of the blend radius. The reviewer weighs whether the
extracted surface shows those crisp edges rather than a uniformly rounded one;
how the model uses that character is its own design choice. Core emits each
part's authored field as a per-part `.glb` (binary glTF), and that is the
authoritative geometry a reviewer and the frontend read.

## The rig

The `[model]` table declares only the game-facing contract: three required
animations, by name. The model invents the whole skeleton at run time: the
parts, their hierarchy and pivots, and the joints that drive them. The case
fixes no parts, joints, ranges, or pose angles. Working out the pieces a
walking, firing fortress needs is the test.

Each required animation is a declaration only: a `name`, a `loop` flag, and an
`auto_play` flag. The model authors the period and the F-curves at run time with
`dc-anim define-animation` and `add-keyframe`.

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
| `specs/brief.md` | Yes            | The self-contained meshing-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.            |
| `test-case.toml` | No             | Manifest: volume, tool, mesh output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).        |
| `description.md` | No             | Site blurb.                                              |
| `README.md`      | No             | This overview.                                           |

A run receives the seeded brief, the `dc-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations with empty `parts` and
`joints` for the model to fill, so the contract exists from the first operation.
The binary's `--help` is the contract; no operations schema is seeded. Each
part's emitted per-part `.glb` plus `rig.json` are the authoritative output.

## Variants

Three variants composite and rig the same Aegis at three field sizes. `base`
(`variants/base.toml`) is listed first and is the default, inheriting the case's
120x110x150 volume; `half` and `double` override `[voxel]` with each extent
halved and doubled, and the brief is rendered at the selected size. Every
variant seeds the common brief and is rated on the case's single `overall`
scoring domain.

## Versioning

This case follows semantic versioning, one folder per version. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
