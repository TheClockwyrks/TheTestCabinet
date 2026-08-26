# Siege Husk — `v1.0.0`

This is version `v1.0.0` of the **Siege Husk** test case: an asset-generation
case (`asset_kind = "mc-skinned"`) that asks a model to sculpt and rig a
decrepit, low-poly shambling humanoid enemy for the Siege first-person voxel
last-stand game. It is a skinned character, one continuous skin bound to a
model-invented skeleton, sculpted in a 24x48x20 volume using only the `mc-skin`
tool, one recorded operation at a time, with its walk, lunge, and collapse
animations authored as F-curves.

`siege-husk` is the catalog slug for this case. There is no target model: the
model builds toward the seeded brief and is reviewed subjectively against it.

## The skinning tool: Marching Cubes, one whole-body field

The rigid `-animation` mesh kinds build a separate mesh per part posed about
pivots, leaving a seam at every joint. A skinned kind builds one continuous mesh
bound to a skeleton and deforms it by per-vertex weights: as a bone rotates, the
skin around the joint stretches and folds smoothly across that seam. That is
what a shambling humanoid needs.

`mc-skin` sculpts one whole-body signed-distance field, the entire husk at once
with no `--part` flag, by compositing primitives: `add-` and `subtract-`
spheres, boxes, ellipsoids, and cylinders, a `--blend` radius for smooth joins,
plus `mirror`, `translate`, `copy`, `replace-color`, and `clear`. It extracts
the surface with Marching Cubes, giving a low-poly, chunky, faceted skin. That
surface character is fixed by the binary rather than a manifest knob.

On `render`, core extracts the surface, derives the per-vertex skin weights
automatically by bone-heat diffusion, capped at four influences per vertex, and
emits a single skinned `mesh.glb` carrying geometry plus the glTF skin of bone
weights and inverse-bind matrices, along with `rig.json`. That is the
authoritative output a reviewer and the frontend read. The binary's `--help` is
the contract, and no operations schema is seeded.

Because a skinned character is one field and one mesh, its `[tool].preview`
(`model.png`) and `[output].actions` (`actions.json`) are single files carrying
no `{part}` token, even though it is an animated kind. This is the skinned
exception to the rigid animated kinds' per-part templating.

## The rig

The `[model]` table declares only the game-facing contract: three required
animations, by name. The model invents the whole skeleton at run time, the bones,
their hierarchy and pivots, the joints that drive them, and how the skin binds to
them; the case fixes no bones, joints, ranges, weights, or pose angles. Working
out the bones a walking, lunging, collapsing humanoid needs is the test.

Each required animation is a declaration only, a `name`, a `loop` flag, and an
`auto_play` flag. The model authors the period and the F-curves at run time with
`mc-skin define-animation` and `add-keyframe`:

- `walk` (`loop = true`, `auto_play = false`) — a looping shamble whose legs
  plant and drag while the pelvis and spine flex and the arms sway, authored in
  place so the leg cycle carries the stride and a game supplies the real travel.
- `lunge` (`loop = false`, `auto_play = false`) — a one-shot forward attack
  wrench toward +z that snaps the torso and a shoulder forward to grab or swipe,
  then settles and holds.
- `collapse` (`loop = false`, `auto_play = false`) — a one-shot death crumple in
  which the legs buckle and the spine folds so the body slumps down and holds
  limp on the ground.

In each, the one continuous skin must deform across its joints, an elbow, hip, or
spine that bends and folds with no seam opening and nothing tearing away. The
model may add its own extra bones, joints, and animations on top, and must keep
all three required animations intact.

## Contents

| Path             | Seeded to run? | Purpose                                                     |
| ---------------- | -------------- | ----------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.             |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.               |
| `test-case.toml` | No             | Manifest: volume, tool, skinned output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).           |
| `description.md` | No             | Site blurb.                                                 |
| `README.md`      | No             | This overview.                                              |

A run receives the seeded brief, the `mc-skin` binary, and a pre-seeded
`rig.json` holding only the required animation declarations, with an empty
skeleton for the model to fill, so the contract exists from the first operation.
There is no target model and no operations schema. The binary's `--help` is the
contract, and the emitted skinned `mesh.glb` plus `rig.json` are the
authoritative output.

## Variants

The Siege Husk ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
single `overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/siege-husk/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
