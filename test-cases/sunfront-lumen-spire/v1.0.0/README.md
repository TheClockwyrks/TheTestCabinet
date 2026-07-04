# Sunfront Lumen Spire — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lumen Spire** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a slim Duneforged beacon spire as a 44×88×44 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-lumen-spire` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. It fixes only the set of **named
animations** the model must author, declared in `test-case.toml`'s `[model]`
table; the parts, joints, pivots, and ranges that realize them are entirely the
model's to invent. This measures creativity and craft, not instruction-following.

The two required animations (motion supplied as F-curves at run time, not shipped
by the case):

| Animation | `auto_play` | Loop | What it does |
| --- | --- | --- | --- |
| `halo_ring_spin` | yes | yes | Turns the halo ring a full, continuous revolution about the spire's vertical axis. |
| `lens_pulse` | yes | yes | Bobs the solar lens up off its seat and back down. |

Both animations are self-playing idles (`auto_play = true`): the spire cycles on
its own with no caller, while the tower stays fixed. The model invents whatever
parts and joints it needs and may add extra parts, joints, and animations on top,
but must produce both required animations by these names and not contradict them.

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

The Spire ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lumen-spire/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
