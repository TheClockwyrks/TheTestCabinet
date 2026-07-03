# Sunfront Flak Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Flak Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall Duneforged works as a 56×76×56 opaque-voxel model using
only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-flak-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The foundry works and its foundation |
| `dish` | `base` | `[28, 64, 28]` | The radar dish crowning the works |
| `piston` | `base` | `[40, 34, 24]` | The charging piston on the flank |

- **`dish_sweep`** (auto, rotation about `y`, `-π..π`) — the radar dish turns a
  full revolution.
- **`piston_bob`** (auto, translation along `y`, `-5..0`) — the piston bobs
  straight down and back up.

Both required joints are `auto`-driven by two required decorative **animations**
(same names, `auto_play = true`, `loop = true`): `dish_sweep` (`period_ms = 3000`)
and `piston_bob` (`period_ms = 1200`). The animations are **declarations only**
in
`test-case.toml` — name, period, loop, auto_play, and the joint each drives, with
**no keyframes**; the model authors each one's F-curves at run time with the
`voxel-anim` `define-animation`/`add-keyframe` subcommands. The foundry cycles on
its own with no caller. The model may add its own extra parts, joints, and
auto-play animations on top, but must not drop or contradict the required
interface.

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
operations schema — the binary's `--help` is the contract.

## Variants

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-flak-foundry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
