# Sunfront Bombard Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bombard Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a heavy Duneforged mortar-works as a 60×68×60 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-bombard-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The mortar-works tower and foundation |
| `crane_arm` | `base` | `[30, 52, 30]` | The overhead crane arm |
| `piston` | `base` | `[16, 30, 40]` | The loading piston head |

- **`crane_swing`** (auto, rotation about `x`, `-0.4..0.4`) — the crane arm rocks
  fore and aft over the works on its own via its auto-play animation.
- **`piston_bob`** (auto, translation along `y`, `-6..0`) — the loading piston bobs
  straight down and back up in its flank on its own via its auto-play animation.

Both required **animations** are declared in the `[model]` table by identity only
(`name`, `period_ms`, `loop`, `auto_play = true`, and the single joint each
drives) — the model authors their F-curve keyframes at run time with the
`voxel-anim` `define-animation`/`add-keyframe` subcommands.

This is a STRUCTURE-class case: it has **no caller joints and no playable
animations** — both required animations are decorative `auto_play` idles. Both
moving parts cycle on their own while the `base` stays fixed. The model may add
its own extra parts, joints, and animations on top, but must not drop or
contradict the required interface.

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

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bombard-foundry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
