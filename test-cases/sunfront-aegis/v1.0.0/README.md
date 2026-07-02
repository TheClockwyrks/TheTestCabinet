# Sunfront Aegis — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Aegis** test case: an asset-generation
case (`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* a
giant Duneforged **siege fortress on treads** — a multi-gun tracked
war-fortress — as a 72×52×88 opaque-voxel model using only the `voxel-anim`
tool, one recorded operation at a time.

`sunfront-aegis` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-bronze palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The tracked hull and its two treads |
| `main_turret` | `chassis` | `[36, 32, 44]` | The big central turret |
| `main_gun` | `main_turret` | `[36, 38, 58]` | The main cannon on the turret front |
| `left_battery` | `chassis` | `[12, 30, 40]` | The left-flank secondary gun |
| `right_battery` | `chassis` | `[60, 30, 40]` | The right-flank secondary gun |

- **`main_turret_yaw`** (caller, rotation about `y`, `-π..π`) — traverses the whole
  main turret and its cannon about the vertical mount.
- **`main_gun_pitch`** (caller, rotation about `x`, `-0.2..0.8`) — elevates the
  main cannon about its mount.
- **`left_battery_pitch`** / **`right_battery_pitch`** (auto, rotation about `x`,
  `0.0..0.9`) — the two side batteries sweep on their own via their clips, in
  opposite phase.

The case also authors a **`bombardment`** review animation that drives both caller
joints so a reviewer can watch the turret sweep and the gun lob without dragging
the sliders. The model may add its own extra parts, joints, and clips on top, but
must not drop or contradict the required interface.

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
