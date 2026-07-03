# Sunfront Lancer Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lancer Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall, slender Duneforged foundry spire as a 44×84×44
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-lancer-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's
brass-and-sandstone palette and solar-amber team accent. There is no target model
— the model builds toward the seeded brief and is reviewed subjectively against
it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The tower shaft and its footing |
| `rail_arm` | `base` | `[22, 50, 22]` | The sliding mid-shaft rail-arm |
| `focus_ring` | `base` | `[22, 68, 22]` | The spinning focus-ring at the crown |

This is a **structure**: it has no caller-driven controls. Both moving parts
animate on their own through auto joints, each driven by a required auto-play
animation the model authors:

- **`rail_arm_slide`** (auto, translation along `y`, `0..10`) — rides the rail-arm
  up and down its shaft, driven by the required `rail_arm_slide` animation
  (`period_ms = 1600`, loop, auto_play).
- **`focus_ring_spin`** (auto, rotation about `y`, `-π..π`) — turns the
  focus-ring a full revolution, driven by the required `focus_ring_spin` animation
  (`period_ms = 2000`, loop, auto_play).

The two `[[model.animation]]` entries are **declarations only** — no keyframes:
the model authors each motion as an F-curve at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands. The `base` stays fixed. The model
may add its own extra parts, joints, and animations on top, but must not drop or
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
`rig.json` holding the required parts, joints, and animation declarations (so the
contract exists from the first operation). There is no target model and no
operations schema — the binary's
`--help` is the contract.

## Variants

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lancer-foundry/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
