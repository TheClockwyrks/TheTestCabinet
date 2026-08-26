# Sunfront Scarab — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Scarab** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a low, wide four-legged Duneforged war-beetle as a 26×12×30
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-scarab` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case fixes what the Scarab is and the animations it must author. The brief
describes the subject, a domed brass carapace body, four iron legs, and a pair
of snapping iron mandibles at the head, and how it must move. The model invents
whatever parts and joints it needs and is judged on whether it works out the
right pieces, attaches them where they belong, and animates them convincingly.
The parts list, joint placements, and pose angles are all its own.

`test-case.toml`'s `[model]` table declares the two required animations by name
and ships no keyframes:

- `walk` — a game-triggered playable that strides the beetle forward on its legs
  in a diagonal-pair gait, each foot planting flat and still before it lifts,
  swings, and plants again.
- `bite` — a game-triggered playable that snaps the front mandibles wide open
  and shut so a reviewer can watch the jaws work without dragging a slider.

The model produces the F-curves. It may add its own extra parts, joints, and
animations on top. It must produce the required `walk` and `bite` without
contradicting them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt.                          |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations. The contract therefore
exists from the first operation. No operations schema is seeded; the binary's
`--help` is the contract.

## Variants

The Scarab ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain, and adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder,
`test-cases/sunfront-scarab/v1.0.0/`. Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
