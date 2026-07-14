# Sunfront Reliquary — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Reliquary** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall, precious Duneforged monument cradling a glowing solar
core as a 60×100×60 opaque-voxel model using only the `voxel-anim` tool, one
recorded operation at a time.

`sunfront-reliquary` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent, with a heavy solar-hot glow at the core.
There is no target model — the model builds toward the seeded brief and is
reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. It fixes only the required **animations**
declared in `test-case.toml`'s `[model]` table (no parts, joints, or keyframes ship
in the manifest) — each a `loop`ing, self-playing (`auto_play`) decorative idle, so
the monument cycles on its own with no caller:

- **`ring_spin`** — the orbital ring turns a full, steady revolution.
- **`core_pulse`** — the solar core rises and settles back in a breathing pulse.
- **`fins_spin`** — the guardian fins counter-rotate a full revolution the opposite
  way from the ring.

The model **invents whatever parts and joints it needs** — which piece is the fixed
body, which three pieces move, and where each turns or rises — and authors each
animation's motion at run time with the `voxel-anim` `define-animation`/`add-keyframe`
subcommands. `rig.json` is pre-seeded with just these three animation declarations, so
the contract exists from the first operation. The model may add its own extra parts,
joints, and animations on top, but must produce these three animations by name and
must not contradict them.

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
the first operation; it declares no parts or joints — those are the model's to
invent). There is no target model and no operations schema — the binary's `--help`
is the contract.

## Variants

The Reliquary ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-reliquary/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
