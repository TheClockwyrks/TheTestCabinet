# Sunfront Scarab Hatchery — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Scarab Hatchery** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a squat, wide Duneforged hive-mound as a 60×40×60 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-scarab-hatchery` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes
only the two named animations the model must author; the parts, joints, pivots, and
ranges that realize them are the model's to invent, and it is judged on working them
out. Both animations are self-playing decorative idles (`auto_play`, `loop`):

- **`hatch_turn`** — the central iris hatch crowning the mound turns continuously
  about its vertical axis on its own, like a slowly rotating iris.
- **`vent_bob`** — the side exhaust vent lifts off its seat and settles back on its
  own.

Each animation is declared as a required contract but carries **no** keyframes — the
model authors its F-curve motion at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands. This building has **no** caller-driven
motion: the two decorative animations are the whole animation, cycling on their own
while the mound body stays put. The model may add its own extra parts, joints, and
animations on top, but must not drop or contradict the two required animations.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the two required animation declarations (so the contract exists
from the first operation). There is no target model and no operations schema — the
binary's `--help` is the contract.

## Variants

The Hatchery ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-scarab-hatchery/v1.0.0/`). Each version is self-contained
and
immutable once a run references it; design revisions land as new version folders.
