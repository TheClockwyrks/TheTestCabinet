# Sunfront Trooper — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Trooper** test case: an
asset-generation case (`asset_kind = "dc-skinned"`) that asks a model to sculpt
and rig an armored Duneforged infantry soldier as a 24×48×20 hard-surface
character using only the `dc-skin` tool, one recorded operation at a time.

`sunfront-trooper` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged roster and shares the faction's bronze-and-canvas palette
and amber visor glow. There is no target model: the model builds toward the seeded
brief and is reviewed subjectively against it.

## Skinned, not per-part

This is a skinned case, the sibling of the rigid `-animation` kinds. `dc-skin`
sculpts a single, whole-body signed-distance field, one continuous surface, and
binds it to a skeleton, so as a bone rotates the skin around the joint stretches
and folds across a seam a rigid, per-part kind cannot cross. Because the
character is one field and one mesh:

- `[tool].preview` is a single `model.png` and `[output].actions` a single
  `actions.json`, with no `{part}` token; it is the one animated kind that does
  not template by part.
- The skinned `mesh.glb` and `rig.json` are emitted automatically by core rather
  than declared in the manifest. The `mesh.glb` carries the geometry plus the
  glTF skin: per-vertex bone weights and inverse-bind matrices.
- The per-vertex weights binding the skin are derived automatically at `render`
  by bone-heat diffusion, up to four bones per vertex.

## The rig

The `[model]` table in `test-case.toml` fixes only the animations the model must
author, by name, and that is the only thing the case fixes about the rig. The
model invents whatever bones and joints a marching, firing, bracing soldier needs
and is judged on whether its one continuous skin deforms convincingly across the
joints. The three required animations are declared as a name plus intent; the
model lays down the F-curve keyframes at run time with
`define-animation`/`add-keyframe`:

- `march` (loop, no auto-play) — a game-triggered walk: a purposeful two-phase
  gait, each foot planting and holding while the body passes over it, then
  lifting, swinging, and planting, the two legs in opposite phase with the arms
  counter-swinging. Authored in place, with the skin folding across the hips,
  knees, and waist.
- `fire` (play once, no auto-play) — a game-triggered shoulder-rifle shot: the
  rifle snaps to the shoulder, braces, and takes a single recoil kick that ripples
  through the shoulder and torso and settles, while the legs hold planted.
- `brace` (play once and hold, no auto-play) — a game-triggered crouch behind
  cover: the knees bend deeply, the hips and spine flex forward and the head tucks
  down, then holds. The deep bends read as the continuous skin folding across the
  joints.

The model may add its own extra bones, joints, and animations on top, and must
keep the required animations as declared.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: field volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `dc-skin` binary, a pre-seeded
`dc-skin.config.json`, and a pre-seeded `rig.json` holding the required animation
declarations, so the contract exists from the first operation. The skeleton and
its binding are the model's to invent. There is no target model and no operations
schema; the binary's `--help` is the contract.

## Variants

The Trooper ships three variants that sculpt the same soldier at three sizes, each
overriding the case's `[voxel]` volume: `base` (24×48×20, the default, declared in
`variants/base.toml`), `half` (each extent ~halved), and `double` (each extent
doubled). All three seed the common brief, rendered at the selected variant's
dimensions, and are rated on the case's single `overall` scoring domain; they add
no specs or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-trooper/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
