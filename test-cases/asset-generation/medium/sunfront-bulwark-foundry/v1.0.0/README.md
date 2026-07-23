# Sunfront Bulwark Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bulwark Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a heavy armored Duneforged bunker-forge as a 66×56×66
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-bulwark-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes
only the **named animations** the model must author; the model invents whatever
parts, joints, and pivots the foundry needs and is scored on whether it works out
the right pieces, attaches them where they belong, and animates them convincingly:

- **`blast_door_raise`** (self-playing idle, `loop`, `auto_play = true`) — the heavy
  front blast door raises straight up, holds open, and drops back shut along a
  vertical track, on its own.
- **`flywheel_spin`** (self-playing idle, `loop`, `auto_play = true`) — the great
  flank drive flywheel turns steadily about its axle, a full continuous revolution
  each loop, on its own.

Both required **animations** are declared in the `[model]` table by identity only
(`name`, `loop`, `auto_play`) — the model authors their F-curve keyframes at run
time with the `voxel-anim` `define-animation`/`add-keyframe` subcommands. There are
**no `[[model.part]]` or `[[model.joint]]` tables**: `rig.json` is pre-seeded with
just the two animation declarations, so the contract exists from the first
operation.

This is a STRUCTURE-class case: it has **no caller controls** — both required
animations are decorative `auto_play` idles. Both moving elements cycle on their own
while the building body stays fixed. The model may add its own extra parts, joints,
and animations on top, but must not drop or contradict the two required animations.

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

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bulwark-foundry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
