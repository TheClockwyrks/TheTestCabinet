# Caldera Core — `v1.0.0`

This is version `v1.0.0` of the **Caldera Core** test case: an asset-generation case
(`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* the Holdfast the
whole game defends as an 80×70×80 opaque-voxel model using only the `voxel-anim` tool, one
recorded operation at a time.

`caldera-core` is the catalog slug for this case. It is one of the `caldera-*` roster whose
produced models are seeded into the [`caldera`](../../caldera/) end-to-end case, and it
shares the Holdfast's brass-and-iron palette. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

This case fixes only **what the Core is**, **the animations it must author**, and **the
accent region a game recolors** — not the rig. The brief describes the subject (a broad
stepped brass keep, a ziggurat of receding tiers rising to a crowned summit, with banners
hanging from the upper tiers and a beacon at the very top) and how it must move; the model
**invents whatever parts and joints it needs** and is judged on whether it works out the
right pieces, attaches them where they belong, and animates them convincingly. Nothing
prescribes a parts list, joint placements, or pose angles.

The two required, model-authored animations (declared by name in `test-case.toml`'s
`[model]` table with no keyframes; the model produces the F-curves) are:

- **`idle`** — a self-playing idle that turns the beacon and stirs the banners so the Core
  reads as alive and garrisoned, while the tiered keep stays fixed.
- **`upgrade`** — a game-triggered one-shot that grinds the keep's tiers up, lifts and locks
  the crown ring, and flares the beacon, then **holds its taller final pose** rather than
  looping, so a reviewer can watch the moment of the Core becoming more powerful.

The model may add its own extra parts, joints, and animations on top, but must not drop or
contradict the required `idle` and `upgrade`.

## The accent region

The Core's **crown ring and banner trim** must be sculpted in `#2f7d72` and that color
must appear nowhere else on the model. This is not decoration: the `caldera` build finds
every voxel of that color and repaints it per upgrade level (brass dark at level 0, then
steel, gold, and white-hot), so one model serves all four levels without new geometry.
The contract is documented in the end-to-end case's `specs/assets.md`, and the reviewer
checks whether the region is contiguous, correctly colored, and visible from more than
one angle.

The brief also forbids steel `#b8bcc2`, gold `#ffce54`, and white `#dfeaea` anywhere on the
model, since a game paints those onto the accent at run time.

## Contents

| Path                  | Seeded to run? | Purpose                                                   |
| --------------------- | -------------- | --------------------------------------------------------- |
| `specs/brief.md.hbs`  | **Yes**        | The self-contained brief, rendered per variant.           |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.             |
| `test-case.toml`      | No             | Manifest: voxel volume, tool, output, animations, review. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).         |
| `description.md`      | No             | Site blurb.                                               |
| `changelog.md`        | No             | This version's changelog entry.                           |
| `README.md`           | No             | This overview.                                            |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded `rig.json`
holding the required animation declarations (so the contract exists from the first
operation). There is no target model and no operations schema — the binary's `--help` is
the contract.

## Variants

The Core ships three variants, sculpting the same keep at three sizes: `base` (the
case's 80×70×80 volume, the default), `half` (each extent ~halved), and `double` (each
doubled). The `half` and `double` variant files override `[voxel]`, and the brief is
rendered at the selected variant's dimensions. All three seed the common brief and are
rated on the case's single `overall` scoring domain; they add no specs or domains of
their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-core/v1.0.0/`). Each version is self-contained and immutable once a run
references it; design revisions land as new version folders.
