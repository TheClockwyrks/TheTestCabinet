# Sunfront Aegis — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Aegis** test case: an asset-generation
case (`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* a
colossal Duneforged **six-legged walking fortress** — a multi-gun war-fortress that
dwarfs every buildable unit and strides on six heavy legs — as an 88×80×104
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-aegis` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-bronze palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `chassis` | *(root)* | `[0, 0, 0]` | The armored hull, raised on legs |
| `legs_left` | `chassis` | `[18, 16, 52]` | The three left legs, as one part |
| `legs_right` | `chassis` | `[70, 16, 52]` | The three right legs, as one part |
| `main_turret` | `chassis` | `[44, 60, 56]` | The big central turret |
| `main_gun` | `main_turret` | `[44, 66, 74]` | The main cannon on the turret front |
| `left_turret` | `chassis` | `[16, 56, 52]` | The rotating left-flank side turret |
| `right_turret` | `chassis` | `[71, 56, 52]` | The rotating right-flank side turret |

- **`main_turret_yaw`** (caller, rotation about `y`, `-0.35..0.35`) — a narrow
  forward cone that makes only fine corrections keeping the main cannon pointed
  forward; the fortress turns its hull to aim.
- **`main_gun_pitch`** (caller, rotation about `x`, `-0.2..0.8`) — elevates the
  main cannon about its mount.
- **`left_turret_yaw`** (caller, rotation about `y`, `-1.6..0.0`) /
  **`right_turret_yaw`** (caller, rotation about `y`, `0.0..1.6`) — traverse the
  two side turrets so each swings independently to cover its own flank arc.
- **`legs_left_stride`** / **`legs_right_stride`** (auto, rotation about `x`,
  `-0.5..0.5`) — walk the six heavy legs in opposite phase on their own via
  looping clips.

The case also authors a **`bombardment`** review animation that drives all four
caller joints so a reviewer can watch the main cannon lob forward while the two
side turrets sweep their own flanks, without dragging the sliders. The model may
add its own extra parts, joints, and clips on top, but must not drop or contradict
the required interface.

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
