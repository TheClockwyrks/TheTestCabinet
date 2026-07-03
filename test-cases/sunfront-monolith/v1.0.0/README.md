# Sunfront Monolith — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Monolith** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a towering super-heavy bipedal Duneforged war-mech as a 64×80×56
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-monolith` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table.
Each leg is its own independent three-segment chain (thigh → shin → short flat
foot) so it can lift and plant its foot rather than only swing:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | The massive upper body and head |
| `thigh_l` | `torso` | `[20, 34, 28]` | Left upper leg (hip) |
| `shin_l` | `thigh_l` | `[20, 18, 28]` | Left lower leg (knee) |
| `foot_l` | `shin_l` | `[20, 3, 28]` | Left short flat foot (ankle) |
| `thigh_r` | `torso` | `[44, 34, 28]` | Right upper leg (hip) |
| `shin_r` | `thigh_r` | `[44, 18, 28]` | Right lower leg (knee) |
| `foot_r` | `shin_r` | `[44, 3, 28]` | Right short flat foot (ankle) |
| `weapon` | `torso` | `[44, 52, 32]` | The giant right arm-cannon |

- **`weapon_pitch`** (caller, rotation about `x`, `-0.7..0.7`) — the game-facing
  control: aims the giant right arm-cannon up and down about its shoulder mount.
- **`hip_l`/`hip_r`** (auto, rotation `x`, `-0.5..0.5`), **`knee_l`/`knee_r`**
  (auto, rotation `x`, `-1.4..0.2`, rest `-0.7` — a bent, reverse/digitigrade
  knee), **`foot_l`/`foot_r`** (auto, rotation `x`, `-0.3..0.3`) — the six leg
  joints the required `walk` animation drives.

The `[model]` table also declares two **required animations** the model must
author as F-curves (no keyframes ship in the manifest): **`walk`** (period 1100,
loops, `auto_play = false`) — a slow, heavy, planted opposite-phase stride driving
all six leg joints — and **`fire`** (period 600, loops, `auto_play = false`) — a
weapon-only recoil driving `weapon_pitch` so a reviewer can watch the cannon
recoil without dragging the slider. The model may add its own extra parts, joints,
and animations on top, but must not drop or contradict the required interface.

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
contract exists from the first operation; the model authors each animation's
F-curve keyframes). There is no target model and no operations schema — the binary's
`--help` is the contract.

## Variants

The Monolith ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-monolith/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
