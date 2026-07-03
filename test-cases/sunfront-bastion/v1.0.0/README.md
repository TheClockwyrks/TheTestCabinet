# Sunfront Bastion — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bastion** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a huge Duneforged fortified keep as a 72×88×72 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-bastion` is the catalog slug for this case. It is the home keep / HQ of
the `sunfront-*` Duneforged voxel roster — the biggest, most detailed building —
and shares the faction's brass-and-sandstone palette and solar-amber team accent.
There is no target model — the model builds toward the seeded brief and is
reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]`
table —
parts, joints, and the three required animations (declared, but authored by the
model as F-curves):

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `base` | *(root)* | `[0, 0, 0]` | The fortress keep and its ramparts |
| `solar_crown` | `base` | `[36, 76, 36]` | The solar collector crown |
| `gate` | `base` | `[36, 22, 70]` | The gate in the front wall |
| `beacon` | `base` | `[36, 84, 36]` | The signal beacon atop the spire |

- **`crown_spin`** (auto, rotation about `y`, `-π..π`) — the collector crown turns
  a full revolution, driven by the `crown_spin` auto-play animation.
- **`gate_raise`** (auto, translation along `y`, `0..16`) — the gate lifts
  straight up, holds, and lowers, driven by the `gate_raise` auto-play animation.
- **`beacon_spin`** (auto, rotation about `y`, `-π..π`) — the beacon turns slowly
  a full revolution, driven by the `beacon_spin` auto-play animation.

All three required joints are `auto`-driven, each by one required decorative
**auto-play** animation (`crown_spin` period 4000 ms, `gate_raise` 3600 ms,
`beacon_spin` 5000 ms; all `loop = true`). The manifest declares each animation's
identity and intent only — **no keyframes**; the model authors the motion as
F-curves with `voxel-anim`'s `define-animation`/`add-keyframe` subcommands. The
bastion cycles on its own with no caller. The model may add its own extra parts,
joints, and animations on top, but must not drop or contradict the required
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

The Bastion ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bastion/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
