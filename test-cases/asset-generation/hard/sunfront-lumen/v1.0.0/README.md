# Sunfront Lumen — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lumen** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a floating Duneforged beacon drone as a 20×26×20 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-lumen` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent, carried here by a bright solar-hot core.
There is no target model: the model builds toward the seeded brief and is
reviewed subjectively against it.

## The animation contract

`test-case.toml`'s `[model]` table fixes the set of required animations the model
must author at run time as F-curves with `define-animation` and `add-keyframe`.
Each declaration gives the animation's identity alone: its name, whether it
loops, and whether it self-plays. The keyframes, and every part, joint, pivot,
and range, are the model's to author. The three required animations are:

- `ring_spin` (`auto_play = true`) — the self-playing decorative idle. The two
  rings counter-rotate on their own, in opposite directions, around the core.
- `hover` (`auto_play = false`) — a game-triggered playable movement bob. The
  whole legless craft rises and settles gently so it reads as floating in place.
- `pulse` (`auto_play = false`) — a game-triggered playable. The front beam
  emitter nods up and down about its mount and settles.

Realizing them takes a hovering core with a solar-hot heart, two rings that
spin, and a forward beam emitter that tilts. The model is judged on whether it
works out the right pieces, attaches them where they belong, and animates them
convincingly. It may add its own extra parts, joints, and animations on top, and
must produce the three required animations by these names without contradicting
them.

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
from the first operation. It declares no parts or joints. No operations schema
is seeded; the binary's `--help` is the contract.

## Variants

The Lumen ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain, and adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder,
`test-cases/sunfront-lumen/v1.0.0/`. Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
