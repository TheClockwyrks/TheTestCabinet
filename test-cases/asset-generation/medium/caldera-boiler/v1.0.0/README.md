# Caldera Boiler — `v1.0.0`

This is version `v1.0.0` of the **Caldera Boiler** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig the Holdfast's steam plant as a 34×44×34 opaque-voxel model using
only the `voxel-anim` tool, one recorded operation at a time.

`caldera-boiler` is the catalog slug for this case. It is one of the `caldera-*`
roster whose produced models are seeded into the [`caldera`](../../caldera/)
end-to-end case, and it shares the Holdfast's brass-and-iron palette. There is
no target model; the model builds toward the seeded brief and is reviewed
subjectively against it.

## The contract

This case fixes what the Boiler is, the animations it must author, and the
accent region a game recolors. The brief describes the subject: a tall riveted
brass pressure vessel on short legs straddling a geothermal vent, capped by a
tall iron chimney stack, with a bank of pistons down one flank. The brief also
says how it must move. The model invents whatever parts and joints it needs and
is judged on whether it works out the right pieces, attaches them where they
belong, and animates them convincingly. Nothing prescribes a parts list, joint
placements, or pose angles.

The two required, model-authored animations are declared by name in
`test-case.toml`'s `[model]` table with no keyframes, and the model produces the
F-curves:

- `idle` — a self-playing idle that ticks the vessel and rests the pistons,
  barely moving, so the Boiler reads as banked rather than working.
- `boil` — a game-triggered playable that pumps the bank of pistons hard down
  the flank and shudders the vessel, reading unmistakably as active production
  distinct from the idle. The game plays it only while the Boiler is actually
  fed water.

The model may add its own parts, joints, and animations on top, as long as the
required `idle` and `boil` survive as described.

## The accent region

The Boiler's riveted bands ringing the pressure vessel must be sculpted in
`#2f7d72`, and that color must appear nowhere else on the model. The `caldera`
build finds every voxel of that color and repaints it on load. The fluid
structures do not upgrade, so the accent is always painted to brass dark, but
the recolor runs unconditionally, so the region must still be authored
correctly. The contract is documented in the end-to-end case's
`specs/assets.md`, and the reviewer checks whether the region is contiguous,
correctly colored, and visible from more than one angle.

The brief also forbids steel `#b8bcc2`, gold `#ffce54`, and white `#dfeaea`
anywhere on the model, since a game paints those onto Holdfast accent fittings
at run time.

## Contents

| Path                  | Seeded to run? | Purpose                                                   |
| --------------------- | -------------- | --------------------------------------------------------- |
| `specs/brief.md.hbs`  | Yes            | The self-contained brief, rendered per variant.           |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.             |
| `test-case.toml`      | No             | Manifest: voxel volume, tool, output, animations, review. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).         |
| `description.md`      | No             | Site blurb.                                               |
| `changelog.md`        | No             | This version's changelog entry.                           |
| `README.md`           | No             | This overview.                                            |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations, so the contract exists
from the first operation. There is no target model and no operations schema; the
binary's `--help` is the contract.

## Variants

The Boiler ships three variants, sculpting the same plant at three sizes: `base`
(the case's 34×44×34 volume, the default), `half` (each extent ~halved), and
`double` (each doubled). The `half` and `double` variant files override
`[voxel]`, and the brief is rendered at the selected variant's dimensions. All
three seed the common brief and are rated on the case's single `overall` scoring
domain; they add no specs or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-boiler/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version
folders.
