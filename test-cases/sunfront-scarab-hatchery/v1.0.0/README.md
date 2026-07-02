# Sunfront Scarab Hatchery — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Scarab Hatchery** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a squat, wide Duneforged hive-mound as a 56×40×56 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-scarab-hatchery` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The hive-mound foundation and shell |
| `hatch` | `base` | `[28, 20, 40]` | The central iris hatch on the crown |
| `vent` | `base` | `[28, 10, 16]` | The side exhaust vent |

- **`hatch_turn`** (auto, rotation about `y`, `-π..π`) — the central iris hatch
  slowly turns through a full sweep about its vertical axis on its own clip.
- **`vent_bob`** (auto, translation along `y`, `0..6`) — the side vent rises and
  settles on its own clip.

This building has **no** caller-driven joints and no review animation: the two
auto clips are the animation, cycling on their own while the `base` stays fixed.
The model may add its own extra parts, joints, and clips on top, but must not drop
or contradict the required interface.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required parts and joints (so the contract exists from the
first operation). There is no target model and no operations schema — the binary's
`--help` is the contract.

## Variants

The Hatchery ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-scarab-hatchery/v1.0.0/`). Each version is self-contained
and
immutable once a run references it; design revisions land as new version folders.
