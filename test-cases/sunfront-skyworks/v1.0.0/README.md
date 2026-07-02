# Sunfront Skyworks — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Skyworks** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a broad Duneforged launch-pad hangar as a 64×64×64 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-skyworks` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The launch-pad hangar and its foundation |
| `turbine` | `base` | `[32, 50, 32]` | The spinning turbine on the center mast |
| `launch_door` | `base` | `[32, 20, 50]` | The launch door in the front face |

- **`turbine_spin`** (auto, rotation about `y`, `-π..π`) — the turbine turns a
  full revolution fast on its own clip.
- **`launch_door_raise`** (auto, translation along `y`, `0..16`) — the launch
  door slides up, holds open, then lowers back on its own clip.

Both required joints are `auto`-driven: the Skyworks cycles on its own with no
caller and no case-authored review animation. The model may add its own extra
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

The Skyworks ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-skyworks/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
