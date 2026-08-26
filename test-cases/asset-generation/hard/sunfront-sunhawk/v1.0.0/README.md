# Sunfront Sunhawk — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Sunhawk** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a wide, flat Duneforged gunship aircraft as a 74×28×76
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-sunhawk` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case fixes what the Sunhawk is and the named animations the model must
author. The subject is a wide, flat armored fuselage, a rotor out on each side,
and an underslung forward cannon. The parts, joints, pivots, and articulation
that realize the motion are the model's to invent, and the case measures whether
it can work out the pieces a hovering, firing gunship needs and animate them
convincingly.

The `[model]` table ships the declarations for three required animations and no
keyframes:

- `rotor_spin` (`auto_play = true`) — the self-playing rotor blur. Whirls both
  rotors continuously on their own.
- `hover` (`auto_play = false`) — the playable up/down hover movement. Bobs the
  whole craft as it holds station.
- `strafe` (`auto_play = false`) — the playable cannon gun-run. Sweeps the
  underslung cannon down to rake the ground and back up.

The model defines its own parts and joints with `define-part` and `define-joint`,
and authors each animation's F-curves at run time with `define-animation` and
`add-keyframe`. It may add its own extra parts, joints, and animations on top.
It must produce these three animations, by these names, without contradicting
them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt.                          |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations, so the contract exists
from the first operation. Its `parts` and `joints` start empty for the model to
fill in. No operations schema is seeded; the binary's `--help` is the contract.

## Variants

The Sunhawk ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain, and adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder,
`test-cases/sunfront-sunhawk/v1.0.0/`. Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
