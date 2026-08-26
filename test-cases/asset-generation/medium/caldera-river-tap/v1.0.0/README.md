# Caldera River Tap — `v1.0.0`

This is version `v1.0.0` of the **Caldera River Tap** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig the smallest, lowest waterworks of the Holdfast as a 28×26×28
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`caldera-river-tap` is the catalog slug for this case. It is one of the
`caldera-*` roster whose produced models are seeded into the `caldera` end-to-end
case, and it shares the Holdfast's brass-and-iron palette. There is no target
model; the model builds toward the seeded brief and is reviewed subjectively
against it.

## The contract

This case fixes what the River Tap is, the animations it must author, and the
accent region a game recolors. The brief describes the subject: a low brass sluice
gate spanning a river channel, a weir with a liftable gate in an iron frame, with
an undershot paddle wheel turning in the flow beside it. The parts list, the joint
placements, and the pose angles are all the model's to invent, and it is judged on
whether it works out the right pieces, attaches them where they belong, and
animates them convincingly.

The two required animations are declared by name in `test-case.toml`'s `[model]`
table with no keyframes, and the model authors the F-curves:

- `idle` — a self-playing idle that turns the paddle wheel gently in the current
  with the gate held still, so the Tap reads as sitting in the river, not drawing.
- `draw` — a game-triggered playable that lifts the sluice gate within its frame
  and spins the paddle wheel up as water is drawn through the weir, cycling
  steadily and reading as active but simple, distinct from the idle. A game plays
  it while the Tap is drawing.

The model may add extra parts, joints, and animations on top, and must not
drop or contradict the required `idle` and `draw`.

## The accent region

The River Tap's sluice gate frame must be sculpted in `#2f7d72`, and that color
must appear nowhere else on the model. The `caldera` build finds every voxel of
that color and repaints it on load. The fluid structures do not upgrade, so the
accent is always painted to brass dark, and the recolor runs unconditionally, so
the region must still be authored correctly. The contract is documented in the
end-to-end case's `specs/assets.md`, and the reviewer checks whether the region is
contiguous, correctly colored, and visible from more than one angle.

The brief also forbids steel `#b8bcc2`, gold `#ffce54`, and white `#dfeaea`
anywhere on the model. Those are the colors a game paints onto Holdfast accent
fittings at run time.

## Contents

| Path                  | Seeded to run? | Purpose                                                   |
| --------------------- | -------------- | --------------------------------------------------------- |
| `specs/brief.md.hbs`  | Yes            | The self-contained brief, rendered per variant.           |
| `prompt.hbs`          | No             | Rendered into the model's prompt.                         |
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

The River Tap ships three variants, sculpting the same weir at three sizes: `base`
(the case's 28×26×28 volume, the default), `half` (each extent ~halved), and
`double` (each doubled). The `half` and `double` variant files override `[voxel]`,
and the brief is rendered at the selected variant's dimensions. All three seed the
common brief and are rated on the case's single `overall` scoring domain; they add
no specs or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-river-tap/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
