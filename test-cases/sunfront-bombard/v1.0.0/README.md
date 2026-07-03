# Sunfront Bombard — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bombard** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a four-legged Duneforged siege mortar walker as a 56×52×80
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-bombard` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored hull |
| `thigh_lf` / `shin_lf` / `foot_lf` | chain from `body` | `[13,16,56]` / `[13,9,56]` / `[13,2,56]` | Left-front leg (thigh → shin → flat foot) |
| `thigh_lr` / `shin_lr` / `foot_lr` | chain from `body` | `[13,16,24]` / `[13,9,24]` / `[13,2,24]` | Left-rear leg |
| `thigh_rf` / `shin_rf` / `foot_rf` | chain from `body` | `[43,16,56]` / `[43,9,56]` / `[43,2,56]` | Right-front leg |
| `thigh_rr` / `shin_rr` / `foot_rr` | chain from `body` | `[43,16,24]` / `[43,9,24]` / `[43,2,24]` | Right-rear leg |
| `turret` | `body` | `[28, 30, 44]` | The rotating turret on top |
| `barrel` | `turret` | `[28, 38, 56]` | The long mortar barrel, on the turret front |

Each leg is an **independent three-segment chain** (thigh → shin → foot) on its
own
hip directly above its own foot — no shared leg-bank part.

- **`turret_yaw`** (caller, rotation about `y`, `-π..π`) — the game-facing
  control: swings the turret, and the barrel with it, a full half-turn each way
  about its vertical mount.
- **`barrel_pitch`** (caller, rotation about `x`, `-0.2..1.0`, rest `0.4`) — the
  second game-facing control: elevates and depresses the mortar barrel so it can
  lob high.
- **`hip_*`** / **`knee_*`** / **`foot_*`** (auto, rotation about `x`, one set per
  leg `lf, lr, rf, rr`) — the twelve leg joints driven by the `walk` animation:
  a
  hip sweep (±0.5), a reverse knee (`-1.4..0.2`, bent-knee rest `-0.7`), and a flat
  foot tilt (±0.3).

The rig also declares two **required animations the model must author** as F-curves
(no keyframes in the manifest): **`walk`** (period 650 ms, drives all twelve leg
joints in a diagonal-pair gait with a planted stance phase and flat feet) and
**`bombard_fire`** (period 1000 ms, drives `barrel_pitch` in a quick recoil-lob).
The model authors both with the `voxel-anim` `define-animation`/`add-keyframe`
subcommands. The model may add its own extra parts, joints, and animations on top,
but must not drop or contradict the required interface.

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

The Bombard ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bombard/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
