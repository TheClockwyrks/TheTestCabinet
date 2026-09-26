# Sunfront Bulwark Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bulwark Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt and rig a heavy armored Duneforged bunker-forge as a 66×56×66
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-bulwark-foundry` is the catalog slug for this case. It belongs to the
`sunfront-*` Duneforged voxel roster and shares the faction's
brass-and-sandstone palette and solar-amber team accent. There is no target
model; the model builds toward the seeded brief and is reviewed subjectively
against it.

## The contract

`test-case.toml`'s `[model]` table fixes only the named animations the model
must author. The model invents whatever parts, joints, and pivots the foundry
needs, and is scored on working out the right pieces, attaching them where they
belong, and animating them convincingly.

- `blast_door_raise` (self-playing idle, `loop`, `auto_play = true`) — the heavy
  front blast door raises straight up, holds open, and drops back shut along a
  vertical track, on its own.
- `flywheel_spin` (self-playing idle, `loop`, `auto_play = true`) — the great
  flank drive flywheel turns steadily about its axle, a full continuous
  revolution each loop, on its own.

Each animation is declared by identity only (`name`, `loop`, `auto_play`), and
the model authors its F-curve keyframes at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands. `rig.json` is pre-seeded with
just the two animation declarations, so the contract exists from the first
operation; there are no `[[model.part]]` or `[[model.joint]]` tables.

This is a STRUCTURE-class case: both required animations are decorative
`auto_play` idles, so both moving elements cycle on their own with no caller
controls while the building body stays fixed. The model may add extra parts,
joints, and animations on top of the two required animations. It must produce
both by name and must not contradict them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | Yes            | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the rig, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and the pre-seeded
`rig.json`. There is no target model and no operations schema; the binary's
`--help` is the contract.

## Variants

Three size variants sculpt the same foundry, declared in `variants/base.toml`,
`variants/half.toml`, and `variants/double.toml`. `base` is the default and
inherits the case's volume; `half` and `double` override `[voxel]` to scale
every extent. All three seed the common brief and are rated on the case's
single `overall` scoring domain, adding no specs or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bulwark-foundry/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
