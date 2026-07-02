# Sunfront Bombard — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bombard** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a low, tracked Duneforged siege mortar as a 56×44×80 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-bombard` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The tracked hull and its two tracks |
| `turret` | `chassis` | `[28, 22, 36]` | The rotating turret on top |
| `barrel` | `turret` | `[28, 30, 48]` | The long mortar barrel, on the turret front |

- **`turret_yaw`** (caller, rotation about `y`, `-π..π`) — the game-facing
  control: swings the turret, and the barrel with it, a full half-turn each way
  about its vertical mount.
- **`barrel_pitch`** (caller, rotation about `x`, `-0.2..1.0`, rest `0.4`) — the
  second game-facing control: elevates and depresses the mortar barrel so it can
  lob high.

The case also authors a **`bombard_fire`** review animation that drives
`barrel_pitch` in a quick recoil-lob so a reviewer can watch the mortar fire
without dragging the slider. The model may add its own extra parts, joints, and
clips on top, but must not drop or contradict the required interface.

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
