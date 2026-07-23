# Sunfront Monolith Forge — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Monolith Forge** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a towering Duneforged great forge as a 90×110×90 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-monolith-forge` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. It fixes only the **animations** the model
must author — the model invents whatever parts and joints it needs and is judged on
whether it works out the right pieces, attaches them where they belong, and
animates them convincingly. The required animations declared in `test-case.toml`'s
`[model]` table (declarations only — the model authors the F-curve keyframes at run
time):

| Animation | loop | auto_play | What it must show |
| --- | --- | --- | --- |
| `hammer_stamp` | yes | yes | The great hammer pounds straight down deep into the throat and back up, landing with weight. |
| `crown_spin` | yes | yes | The gear crown turns one steady full revolution atop the forge and loops seamlessly. |

Both animations are `auto_play` self-playing idles, so the forge cycles on its own
with no caller, while the forge tower stays fixed. The model may add its own extra
parts, joints, and animations on top, but must produce both required animations by
these names.

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
`rig.json` holding the required animation declarations (so the contract exists from
the first operation); the parts and joints are the model's to invent. There is no
target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Forge ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-monolith-forge/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
