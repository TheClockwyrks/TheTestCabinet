# Sunfront Flakhound — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Flakhound** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a four-legged Duneforged anti-air walker as a 36×32×46
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-flakhound` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The animation contract

The case fixes what the Flakhound is and the animations it must move by. The
subject is a squat armored body on four legs, a traversing back turret, and twin
elevating flak barrels. The parts, joints, pivots, and pose angles that realize
the motion are the model's to invent, and the case measures whether it can work
out the pieces a walking, target-tracking anti-air platform needs, attach them
where they belong, and animate them convincingly.

`test-case.toml`'s `[model]` table declares two required animations:

- `walk` (loops, `auto_play = false`) — a game-triggered playable that strides
  the walker forward on its legs. Each foot plants flat and still while the body
  passes over it, then lifts, swings, and plants again in a stable diagonal-pair
  gait, so the machine pushes itself forward. The weapon holds while it plays.
- `flak_track` (loops, `auto_play = false`) — a game-triggered playable that
  works the anti-air weapon. The back turret traverses onto a bearing and the
  twin barrels elevate and depress to track a target across the sky, while the
  walker stands its ground and its legs stay planted.

The case ships the declarations only, and the model authors their F-curve
keyframes at run time. It may add its own extra parts, joints, and animations on
top. It must produce both required animations by these names without
contradicting them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt.                          |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations, so the contract exists
from the first operation. No operations schema is seeded; the binary's `--help`
is the contract.

## Variants

The Flakhound ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain, and adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder,
`test-cases/sunfront-flakhound/v1.0.0/`. Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
