# Caldera Slag — `v1.0.0`

This is version `v1.0.0` of the **Caldera Slag** test case: an asset-generation case
(`asset_kind = "sn-skinned"`) that asks a model to sculpt *and rig* a lumbering molten
elemental creature as a 44×36×44 **skinned** character using only the `sn-skin` tool,
one recorded operation at a time.

`caldera-slag` is the catalog slug for this case. The Slag is an enemy for the Caldera
hex tower-defense game: a hunched, top-heavy mass of glowing magma sheathed in a cracked
cooling-basalt crust, in the disciplined Caldera palette. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## Skinned, not rigid

This is a **skinned** case (`sn-skin`, Surface Nets — smooth, watertight,
mid-fidelity), not a rigid per-part animated one. The model composites **one
whole-body signed-distance field** into a **single continuous mesh** and binds it to a
model-invented skeleton; as a bone rotates, the skin **stretches and folds across the
joint** by linear-blend skinning — the seam a rigid mecha-style rig cannot cross. That
is what a molten, organic creature needs. Consequences that show up in the manifest:

- There is **one field / one mesh / one log**. So `[tool].preview` (`model.png`) and
  `[output].actions` (`actions.json`) are **single files** and carry **no `{part}`
  token** — the one animated kind that does not template by part.
- The per-vertex **skin weights are derived automatically** at render (bone-heat
  diffusion, up to four influences per vertex) — the model does not paint them.
- The skinned **`mesh.glb`** (geometry + the glTF skin: bone weights and inverse-bind
  matrices) and **`rig.json`** (skeleton, joint interface, F-curve animations) are
  **emitted automatically by core** — neither is declared in the manifest.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes only
the **animations** the model must author; the bones, joints, pivots, ranges, and the
per-vertex binding that realize them are the model's to invent, and it is judged on
whether it works out the right pieces and **deforms the skin convincingly**. This is
deliberate: fixing a full skeleton turned the test into instruction-following and made
every model produce near-identical output.

The subject stays fixed — a hunched molten elemental: a top-heavy mass of glowing magma
sheathed in a cracked cooling-basalt crust, carried on short planted limbs it hauls
itself along on, its magma glowing through deep fissures.

The rig declares three **required animations the model must author** as F-curves (no
keyframes in the manifest), all game-triggered playables, each deforming the one
continuous skin across its joints:

- **`advance`** (loops) — a lumbering walk that hauls the mass forward on planted limbs
  while the pelvis, spine, and crust flex across the joints and the whole body rolls
  with weight.
- **`slam`** (plays once, holds) — a one-shot attack: the creature rears and brings its
  mass down, the impact carrying up through the shoulders and spine as continuous-skin
  deformation, then settles.
- **`emerge`** (plays once, holds) — a rise from the ground: the body heaves up into its
  standing pose, the skin stretching into shape across the joints as it forms and lifts.

The model authors all three with the `sn-skin` `define-animation`/`add-keyframe`
subcommands, defining its own bones and joints (`define-bone`, `set-bone`,
`define-joint`) as it goes. It may add extra bones, joints, and animations on top, but
must produce these three animations by these names.

## Contents

| Path             | Seeded to run? | Purpose                                                       |
| ---------------- | -------------- | ------------------------------------------------------------ |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.              |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                |
| `test-case.toml` | No             | Manifest: field volume, tool, output, the rig, and review.   |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).            |
| `description.md` | No             | Site blurb.                                                  |
| `README.md`      | No             | This overview.                                               |

A run receives the seeded brief, the `sn-skin` binary, a seeded `sn-skin.config.json`
(field dimensions, background, and the log / preview / `mesh.glb` / `rig.json` paths),
and a pre-seeded `rig.json` holding the required animation declarations (so the contract
exists from the first operation); the bones and joints start empty for the model to
define. There is no target model and no operations schema — the binary's `--help` is the
contract.

## Variants

The Slag ships a single default variant — `base`, declared in `variants/base.toml`. It
seeds the common brief and is rated on the case's single `fidelity` scoring domain; it
adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-slag/v1.0.0/`). Each version is self-contained and immutable once a
run references it; design revisions land as new version folders.
