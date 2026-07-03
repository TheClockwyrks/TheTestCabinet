# Sunfront Lumen Spire — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lumen Spire** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a slim Duneforged beacon spire as a 44×88×44 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-lumen-spire` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The spire tower and its foundation |
| `halo_ring` | `base` | `[22, 66, 22]` | The halo ring around the crown |
| `lens` | `base` | `[22, 74, 22]` | The solar lens atop the tip |

- **`halo_ring_spin`** (auto, rotation about `y`, `-π..π`) — the halo ring turns
  a full revolution about the spire's vertical axis.
- **`lens_pulse`** (auto, translation along `y`, `0..4`) — the solar lens bobs
  straight up and back down.

Both joints are driven by required **auto-play animations** the model must author
(motion supplied as F-curves at run time, not shipped by the case):

| Animation | Period | `auto_play` | Loop | Drives |
| --- | --- | --- | --- | --- |
| `halo_ring_spin` | 2200 ms | yes | yes | `halo_ring_spin` |
| `lens_pulse` | 1500 ms | yes | yes | `lens_pulse` |

Both required joints are `auto`-driven and both animations are decorative
(`auto_play = true`): the spire cycles on its own with no caller. The model may
add
its own extra parts, joints, and animations on top, but must not drop or contradict
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

The Spire ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lumen-spire/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
