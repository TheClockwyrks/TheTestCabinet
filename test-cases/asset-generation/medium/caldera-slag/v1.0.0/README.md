# Caldera Slag — `v1.0.0`

This is version `v1.0.0` of the **Caldera Slag** test case: an asset-generation
case (`asset_kind = "sn-skinned"`) that asks a model to sculpt and rig a lumbering
molten elemental creature as a 44×36×44 skinned character using only the `sn-skin`
tool, one recorded operation at a time.

`caldera-slag` is the catalog slug for this case. The Slag is an enemy for the
Caldera hex tower-defense game: a hunched, top-heavy mass of glowing magma sheathed
in a cracked cooling-basalt crust, in the disciplined Caldera palette. There is no
target model; the model builds toward the seeded brief and is reviewed subjectively
against it.

## One continuous skin

This is a skinned case (`sn-skin`, Surface Nets, smooth, watertight,
mid-fidelity). The model composites one whole-body signed-distance field into a
single continuous mesh and binds it to a model-invented skeleton; as a bone
rotates, the skin stretches and folds across the joint by linear-blend skinning,
which is what a molten, organic creature needs. Consequences that show up in the
manifest:

- There is one field, one mesh, and one log. So `[tool].preview` (`model.png`) and
  `[output].actions` (`actions.json`) are single files carrying no `{part}` token,
  the one animated kind whose paths are not templated by part.
- The per-vertex skin weights are derived automatically at render by bone-heat
  diffusion, up to four influences per vertex.
- The skinned `mesh.glb` (geometry plus the glTF skin: bone weights and
  inverse-bind matrices) and `rig.json` (skeleton, joint interface, F-curve
  animations) are emitted automatically by core, and neither is declared in the
  manifest.

## The contract

`test-case.toml`'s `[model]` table fixes the animations the model must author. The
bones, joints, pivots, ranges, and the per-vertex binding that realize them are
the model's to invent, and it is judged on whether it works out the right pieces
and deforms the skin convincingly.

The subject stays fixed: a hunched molten elemental, a top-heavy mass of glowing
magma sheathed in a cracked cooling-basalt crust, carried on short planted limbs
it hauls itself along on, its magma glowing through deep fissures.

The rig declares three required animations the model must author as F-curves, with
no keyframes in the manifest. All three are game-triggered playables, and each
deforms the one continuous skin across its joints:

- `advance` (loops) — a lumbering walk that hauls the mass forward on planted
  limbs while the pelvis, spine, and crust flex across the joints and the whole
  body rolls with weight.
- `slam` (plays once, holds) — a one-shot attack. The creature rears and brings
  its mass down, the impact carrying up through the shoulders and spine as
  continuous-skin deformation, then settles.
- `emerge` (plays once, holds) — a rise from the ground. The body heaves up into
  its standing pose, the skin stretching into shape across the joints as it forms
  and lifts.

The model authors all three with the `sn-skin` `define-animation` and
`add-keyframe` subcommands, defining its own bones and joints (`define-bone`,
`set-bone`, `define-joint`) as it goes. It may add extra bones, joints, and
animations on top, and must produce these three animations under these names.

## Contents

| Path                 | Seeded to run? | Purpose                                                    |
| -------------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md.hbs` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`         | No             | Rendered into the model's prompt.                          |
| `test-case.toml`     | No             | Manifest: field volume, tool, output, the rig, and review. |
| `variants/`          | No             | One TOML file per variant (listed in `variants`).          |
| `description.md`     | No             | Site blurb.                                                |
| `README.md`          | No             | This overview.                                             |

A run receives the seeded brief, the `sn-skin` binary, a seeded
`sn-skin.config.json` (field dimensions, background, and the log, preview,
`mesh.glb`, and `rig.json` paths), and a pre-seeded `rig.json` holding the
required animation declarations, so the contract exists from the first operation.
The bones and joints start empty for the model to define. There is no target model
and no operations schema; the binary's `--help` is the contract.

## Variants

The Slag ships three variants, sculpting the same creature at three sizes: `base`
(declared in `variants/base.toml`, the case's 44×36×44 field bounds, and the
default), `half` (each extent ~halved), and `double` (each doubled). The `half`
and `double` variant files override `[voxel]`, and the brief is rendered at the
selected variant's dimensions. All three seed the common brief and are rated on
the case's single `overall` scoring domain; they add no specs or domains of their
own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-slag/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
