# Sunfront Flak Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Flak Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall Duneforged works as a 56×80×56 opaque-voxel model using
only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-flak-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

This case does **not** prescribe a rig — no parts, joints, or pivots. The model
invents whatever skeleton it needs and is judged on whether it works out the right
pieces, attaches them where they belong, and animates them convincingly. The **only**
thing fixed in `test-case.toml`'s `[model]` table is the set of named **animations**
the model must author:

- **`dish_sweep`** (self-playing, `loop = true`, `auto_play = true`) — the crowning
  radar dish turns a full revolution about its vertical axis on its own.
- **`piston_bob`** (self-playing, `loop = true`, `auto_play = true`) — the flank
  piston bobs straight down and back up on its own.

Each animation is a **declaration only** — name, loop, and auto_play, with **no
keyframes and no bound joints**; the model defines its own parts and joints with
`voxel-anim define-part`/`define-joint` and authors each animation's F-curves at run
time with the `voxel-anim` `define-animation`/`add-keyframe` subcommands. Both are
self-playing idles, so the foundry cycles on its own with no caller while the works
body stays fixed. The model may add its own extra parts, joints, and animations on
top, but must not drop or contradict these two required animations.

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
`rig.json` holding the required animation declarations with no parts or joints (so
the contract exists from the first operation). There is no target model and no
operations schema — the binary's `--help` is the contract.

## Variants

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-flak-foundry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
