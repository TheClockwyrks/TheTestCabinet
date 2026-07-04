# Sunfront Bastion — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bastion** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a huge Duneforged fortified keep as a 90×120×90 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-bastion` is the catalog slug for this case. It is the home keep / HQ of
the `sunfront-*` Duneforged voxel roster — the biggest, most detailed building —
and shares the faction's brass-and-sandstone palette and solar-amber team accent.
There is no target model — the model builds toward the seeded brief and is
reviewed subjectively against it.

## The contract (animations only)

This case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes
only the set of **named animations** the model must author; the parts, joints,
pivots, and ranges that realize them are the model's to invent, and the test judges
whether it works out the right pieces, attaches them where they belong, and animates
them convincingly.

The three required animations (declared, but authored by the model as F-curves):

- **`crown_spin`** (self-playing idle, `loop = true`) — turns the solar collector
  crown ringing the summit a full revolution on its own.
- **`gate_raise`** (self-playing idle, `loop = true`) — lifts the gate in the front
  wall straight up, holds it open, and lowers it back down on its own.
- **`beacon_spin`** (self-playing idle, `loop = true`) — turns the beacon crowning
  the central spire slowly a full revolution on its own.

Each animation is a **declaration only** — name, `loop`, and `auto_play`, with **no
keyframes** and no joint bindings; the model authors the motion as F-curves with
`voxel-anim`'s `define-animation`/`add-keyframe` subcommands, and invents whatever
parts and joints drive it (defined with `define-part`/`define-joint`). All three are
self-playing, so the bastion cycles on its own with no caller while the keep base
stays fixed. The model may add its own extra parts, joints, and animations on top,
but must not drop or contradict the three required animations.

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
the first operation); it carries no parts or joints — the model invents those. There
is no target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Bastion ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bastion/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
