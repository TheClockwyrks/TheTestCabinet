# Sunfront Skyworks — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Skyworks** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a broad Duneforged launch-pad hangar as a 64×64×64 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-skyworks` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes
only the two **animations** the model must author (declared as name +
loop/`auto_play` intent; the model authors their F-curves at run time) — there are
no `[[model.part]]` or `[[model.joint]]` tables. The model invents whatever parts
and joints it needs to realize them:

- **`turbine_spin`** (`auto_play = true`, a self-playing idle) — turns the turbine
  a full revolution overhead about its vertical axis, evenly and looping.
- **`launch_door_raise`** (`auto_play = true`, a self-playing idle) — slides the
  launch door up, holds it open, then lowers it back, looping on its own.

Both animations play on their own, so the Skyworks cycles with no caller while the
pad itself stays fixed. The model is free to add its own extra parts, joints, and
animations on top, but must produce these two animations by these names and not
contradict them.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, animations, review.  |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations (so the contract exists from
the first operation). There is no target model and no operations schema — the
binary's `--help` is the contract.

## Variants

The Skyworks ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-skyworks/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
