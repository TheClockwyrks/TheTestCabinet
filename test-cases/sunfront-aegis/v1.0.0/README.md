# Sunfront Aegis — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Aegis** test case: an asset-generation
case (`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* a
tall, broad two-legged Duneforged guardian mech as a 64×76×56 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-aegis` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The armored torso and head |
| `leg_left` | `torso` | `[20, 32, 28]` | The left leg |
| `leg_right` | `torso` | `[44, 32, 28]` | The right leg |
| `weapon` | `torso` | `[18, 46, 30]` | The left tower-shield arm |

- **`weapon_pitch`** (caller, rotation about `x`, `-0.4..0.8`) — the game-facing
  control: raises and lowers the huge left tower-shield about its shoulder mount.
- **`leg_left_stride`** / **`leg_right_stride`** (auto, rotation about `x`,
  `-0.5..0.5`) — the two legs walk on their own via their `walk_left` / `walk_right`
  clips, driven in opposite phase.

The case also authors a **`guard`** review animation that drives `weapon_pitch`
so a reviewer can watch the shield raise and hold without dragging the slider. The
model may add its own extra parts, joints, and clips on top, but must not drop or
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

The Aegis ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-aegis/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
