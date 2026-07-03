# Sunfront Sentinel Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Sentinel Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall Duneforged assembly tower as a 56×72×56 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-sentinel-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes only
the set of **named animations** the model must author — the parts, joints, pivots, and
ranges that realize them are the model's to invent, and are what the test measures.

The two required, self-playing (`auto_play`, looping) `[[model.animation]]`
declarations:

| Animation | Self-playing? | What it must show |
| --- | --- | --- |
| `piston_stamp` | Yes (idle) | The stamping press hammers straight down to the bottom of its stroke and eases back up in the tower's throat. |
| `gear_spin` | Yes (idle) | The drive gear turns a full revolution continuously and loops seamlessly. |

Each animation is a **declaration only** — no keyframes, no period, no bound joints;
the model authors the motion as F-curves at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands, and defines its own parts and joints
with `define-part`/`define-joint`. The foundry cycles on its own with no caller, and
the tower itself stays put — only the press and the gear move. The model may add its
own extra parts, joints, and self-playing animations on top, but must produce both
required animations, by those names, and must not contradict them.

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
`rig.json` holding the required animation declarations — no parts and no joints (so
the animations-only contract exists from the first operation). There is no target
model and no operations schema — the binary's `--help` is the contract.

## Variants

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-sentinel-foundry/v1.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders.
