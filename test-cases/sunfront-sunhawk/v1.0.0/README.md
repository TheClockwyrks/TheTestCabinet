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

## The contract — animations only

This case does **not** prescribe a rig. It fixes only *what the Sunhawk is* (a wide,
flat armored fuselage, a rotor out on each side, and an underslung forward cannon)
and the **named animations** the model must author; the parts, joints, pivots, and
articulation that realize them are entirely the model's to invent. The model defines
its own parts and joints with `voxel-anim define-part`/`define-joint` and authors each
animation's F-curves with `define-animation`/`add-keyframe`. This is deliberate: the
case measures whether a model can work out the pieces a hovering, firing gunship needs
and animate them convincingly, rather than follow a prescribed skeleton.

The `[model]` table declares three **required animations** the model must **author**
at run time as F-curves — the case ships no keyframes, only the declarations:

- **`rotor_spin`** (`auto_play = true`) — the self-playing rotor blur; whirls both
  rotors continuously on their own.
- **`hover`** (`auto_play = false`) — the playable up/down hover movement; bobs the
  whole craft as it holds station.
- **`strafe`** (`auto_play = false`) — the playable cannon gun-run; sweeps the
  underslung cannon down to rake the ground and back up.

The model may add its own extra parts, joints, and animations on top, but must
produce these three animations, by these names, without contradicting them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the animations, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations (so the contract exists from
the first operation, with empty `parts` and `joints` for the model to fill in). There
is no target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Sunhawk ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-sunhawk/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
