# Sunfront Sunhawk — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Sunhawk** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a wide, flat Duneforged gunship aircraft as a 64×36×64
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-sunhawk` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `hull` | *(root)* | `[0, 0, 0]` | The wide, flat fuselage |
| `rotor_left` | `hull` | `[14, 28, 32]` | The left rotor |
| `rotor_right` | `hull` | `[50, 28, 32]` | The right rotor |
| `cannon` | `hull` | `[32, 10, 44]` | The underslung forward cannon |

- **`cannon_pitch`** (caller, rotation about `x`, `-0.9..0.3`, rest `-0.3`) — the
  game-facing control: tilts the underslung cannon up and down about its mount.
- **`rotor_left_spin`** / **`rotor_right_spin`** (auto, rotation about `y`,
  `-π..π`) — the two rotors spin on their own via their fast spin clips.

The case also authors a **`strafe`** review animation that drives `cannon_pitch`
so a reviewer can watch the cannon rake the ground without dragging the slider.
The model may add its own extra parts, joints, and clips on top, but must not
drop or contradict the required interface.

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

The Sunhawk ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-sunhawk/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
