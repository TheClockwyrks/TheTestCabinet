# Sunfront Flakhound — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Flakhound** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a four-legged Duneforged anti-air walker as a 52×48×56
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-flakhound` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `body` | *(root)* | `[0, 0, 0]` | The armored body and hull |
| `legs_left` | `body` | `[12, 10, 28]` | The left bank of legs |
| `legs_right` | `body` | `[40, 10, 28]` | The right bank of legs |
| `turret` | `body` | `[26, 30, 28]` | The traversing flak turret |
| `barrel` | `turret` | `[26, 36, 34]` | The twin elevating flak barrels |

- **`turret_yaw`** (caller, rotation about `y`, `-π..π`) — the game-facing
  control: traverses the turret, and the barrels with it, about its vertical mount.
- **`barrel_pitch`** (caller, rotation about `x`, `0..1.3`) — the game-facing
  control: elevates the twin barrels up toward the air about their hinge.
- **`legs_left_scuttle`** / **`legs_right_scuttle`** (auto, rotation about `x`,
  `-0.6..0.6`) — the two leg banks scuttle on their own via their
  `scuttle_left` / `scuttle_right` clips, driven in opposite phase.

The case also authors a **`flak_track`** review animation that sweeps `turret_yaw`
while raising and lowering `barrel_pitch`, so a reviewer can watch the walker track
a target without dragging the sliders. The model may add its own extra parts,
joints, and clips on top, but must not drop or contradict the required interface.

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

The Flakhound ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-flakhound/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
