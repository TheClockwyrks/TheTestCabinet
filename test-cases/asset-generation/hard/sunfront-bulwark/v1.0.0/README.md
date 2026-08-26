# Sunfront Bulwark — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bulwark** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a heavy bipedal Duneforged war-mech as a 40×60×30 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time. The
mech braces a tower shield on its left arm and carries a siege maul in its
right.

`sunfront-bulwark` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model: the model builds
toward the seeded brief and is reviewed subjectively against it.

## The animation contract

`test-case.toml`'s `[model]` table fixes the named animations the model must
author. The model invents whatever parts and joints it needs to realize them and
is judged on whether it works out the right pieces, attaches them where they
belong, and animates them convincingly. Each declaration carries `name`, `loop`,
and `auto_play` and no keyframes; the model lays down the F-curves at run time
with `define-animation` and `add-keyframe`. Two animations are required, both
game-triggered playables (`auto_play = false`):

- `walk` — strides the mech forward on its legs, the feet planting flat and
  still before lifting and swinging, the two legs in opposite phase so one foot
  is always down.
- `smash` — winds the heavy siege maul up over the head and slams it down in a
  smash while the mech stands its ground.

`rig.json` is pre-seeded with these declarations, so the contract exists from the
first operation. The model may add whatever parts, joints, and extra animations
it needs on top. It must produce the two required animations by these names
without contradicting them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt.                          |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and the pre-seeded
`rig.json`. Its `parts` and `joints` are empty, and the model invents the rig.
No operations schema is seeded; the binary's `--help` is the contract.

## Variants

The Bulwark ships a single default variant, `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain, and adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder,
`test-cases/sunfront-bulwark/v1.0.0/`. Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
