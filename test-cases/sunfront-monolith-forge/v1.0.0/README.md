# Sunfront Monolith Forge — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Monolith Forge** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a towering Duneforged great forge as a 68×84×68 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-monolith-forge` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The forge tower and its foundation |
| `hammer` | `base` | `[34, 58, 34]` | The massive stamping hammer head |
| `gear_crown` | `base` | `[34, 74, 34]` | The gear crown atop the forge |

- **`hammer_stamp`** (auto, translation along `y`, `-18..0`) — the great hammer
  pounds straight down and back up in the forge's throat.
- **`crown_spin`** (auto, rotation about `y`, `-π..π`) — the gear crown turns a
  full revolution atop the forge.

Both required joints are `auto`-driven by the case's two required animations
(declarations only — the model authors the F-curve keyframes at run time):

| Animation | Period | loop | auto_play | Drives |
| --- | --- | --- | --- | --- |
| `hammer_stamp` | 1600 ms | yes | yes | `hammer_stamp` |
| `crown_spin` | 2600 ms | yes | yes | `crown_spin` |

Both animations are `auto_play` decorative idles, so the forge cycles on its own
with no caller. The model may add its own extra parts, joints, and animations on
top, but must not drop or contradict the required interface.

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
`rig.json` holding the required parts, joints, and animation declarations (so the
contract exists from the first operation). There is no target model and no
operations schema — the binary's
`--help` is the contract.

## Variants

The Forge ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-monolith-forge/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
