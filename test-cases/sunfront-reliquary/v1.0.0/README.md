# Sunfront Reliquary — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Reliquary** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall, precious Duneforged monument cradling a glowing solar
core as a 60×96×60 opaque-voxel model using only the `voxel-anim` tool, one
recorded operation at a time.

`sunfront-reliquary` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent, with a heavy solar-hot glow at the core.
There is no target model — the model builds toward the seeded brief and is
reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The monument plinth and core cradle |
| `orbital_ring` | `base` | `[30, 60, 30]` | The ring encircling the core |
| `core` | `base` | `[30, 56, 30]` | The glowing solar core |
| `guardian_fins` | `base` | `[30, 78, 30]` | The crowning guardian fins |

- **`ring_spin`** (auto, rotation about `y`, `-π..π`) — the orbital ring turns a
  full revolution on its own clip.
- **`core_pulse`** (auto, translation along `y`, `0..6`) — the solar core rises
  and settles back in a breathing pulse on its own clip.
- **`fins_spin`** (auto, rotation about `y`, `-π..π`) — the guardian fins
  counter-rotate a full revolution the opposite way on their own clip.

All three required joints are `auto`-driven: the monument cycles on its own with
no caller and no case-authored review animation. The model may add its own extra
parts, joints, and clips on top, but must not drop or contradict the required
interface.

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

The Reliquary ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-reliquary/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
