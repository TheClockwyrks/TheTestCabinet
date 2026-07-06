# Siege Husk — `v1.0.0`

This is version `v1.0.0` of the **Siege Husk** test case: an asset-generation
case (`asset_kind = "mc-skinned"`) that asks a model to sculpt *and rig* a
decrepit, low-poly shambling humanoid enemy for the Siege first-person voxel
last-stand game — as a **skinned character**, one continuous skin bound to a
model-invented skeleton — in a 24x48x20 volume using only the `mc-skin` tool,
one recorded operation at a time, authoring its walk, lunge, and collapse
animations as F-curves.

`siege-husk` is the catalog slug for this case. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## The skinning tool: Marching Cubes, one whole-body field

Unlike the rigid `-animation` mesh kinds, which build a **separate mesh per
part** posed about pivots (a seam at every joint), a skinned kind builds **one
continuous mesh** bound to a skeleton and deforms it by **per-vertex weights**:
as a bone rotates, the skin around the joint stretches and folds smoothly across
the seam a rigid kind cannot cross. That is what a shambling humanoid needs.

`mc-skin` sculpts **one whole-body signed-distance field** — the entire husk at
once, there is **no `--part` flag** — by compositing primitives (`add-`/
`subtract-` spheres, boxes, ellipsoids, and cylinders, a `--blend` radius for
smooth joins, plus `mirror`/`translate`/`copy`/`replace-color`/`clear`) and
extracts its surface with **Marching Cubes**: a **low-poly, chunky, faceted**
skin. That surface character is fixed by the binary, not a manifest knob. On
`render`, core extracts the surface, **derives the per-vertex skin weights**
automatically by bone-heat diffusion (capped at four influences per vertex), and
emits a single skinned `mesh.glb` (geometry plus the glTF skin — bone weights and
inverse-bind matrices) plus `rig.json`, and that is the authoritative output a
reviewer and the frontend read. The binary's `--help` is the contract; no
operations schema is seeded.

Because a skinned character is one field and one mesh, its `[tool].preview`
(`model.png`) and `[output].actions` (`actions.json`) are **single files** — they
carry **no `{part}` token** — even though it is an animated kind. This is the
skinned exception to the rigid animated kinds' per-part templating.

## The rig

The `[model]` table declares only the **game-facing contract**: three required
animations, by name. The model **invents** the whole skeleton — the bones, their
hierarchy and pivots, the joints that drive them, and how the skin binds to them
— at run time; the case fixes no bones, joints, ranges, weights, or pose angles.
Working out the bones a walking, lunging, collapsing humanoid needs is the test.

Each required animation is a declaration only — a `name`, a `loop` flag, and an
`auto_play` flag; the model authors the period and the F-curves at run time with
`mc-skin define-animation` / `add-keyframe`:

- **`walk`** (`loop = true`, `auto_play = false`) — a looping shamble whose legs
  plant and drag while the pelvis and spine flex and the arms sway, authored in
  place so the leg cycle carries the stride and a game supplies the real travel.
- **`lunge`** (`loop = false`, `auto_play = false`) — a one-shot forward attack
  wrench toward +z that snaps the torso and a shoulder forward to grab or swipe,
  then settles and holds.
- **`collapse`** (`loop = false`, `auto_play = false`) — a one-shot death crumple
  in which the legs buckle and the spine folds so the body slumps down and holds
  limp on the ground.

In each, the one continuous skin must deform across its joints — an elbow, hip, or
spine that bends and folds with no seam opening and nothing tearing away. The
model may add its own extra bones, joints, and animations, but must not drop or
contradict these three.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: volume, tool, skinned output, animations, review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `mc-skin` binary, and a pre-seeded
`rig.json` holding only the required animation declarations (with an empty
skeleton for the model to fill), so the contract exists from the first operation.
There is no target model and no operations schema — the binary's `--help` is the
contract, and the emitted skinned `mesh.glb` plus `rig.json` are the authoritative
output.

## Variants

The Siege Husk ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's
`fidelity` and `deformation` scoring domains; it adds no specs, review items, or
domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/siege-husk/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
