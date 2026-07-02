# Sunfront Lumen — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lumen** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a floating Duneforged beacon drone as a 40×56×40 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-lumen` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent, carried here by a bright solar-hot core. There is no
target model — the model builds toward the seeded brief and is reviewed
subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `core` | *(root)* | `[0, 0, 0]` | The floating core hull and its heart |
| `ring_left` | `core` | `[10, 34, 20]` | The left orbiting ring |
| `ring_right` | `core` | `[30, 34, 20]` | The right orbiting ring |
| `emitter` | `core` | `[20, 26, 30]` | The forward beam projector |

- **`emitter_pitch`** (caller, rotation about `x`, `-0.6..0.6`) — the game-facing
  control: tilts the front beam projector up and down about its mount.
- **`ring_left_spin`** / **`ring_right_spin`** (auto, rotation about `z`,
  `-π..π`) — the two rings spin on their own via their clips, turning in opposite
  directions.

The case also authors a **`pulse`** review animation that drives `emitter_pitch`
so a reviewer can watch the beam nod without dragging the slider. The model may
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

The Lumen ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lumen/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
