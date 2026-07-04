# Sunfront Lancer Foundry — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Lancer Foundry** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a tall, slender Duneforged foundry spire as a 46×86×46
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-lancer-foundry` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's
brass-and-sandstone palette and solar-amber team accent. There is no target model
— the model builds toward the seeded brief and is reviewed subjectively against
it.

## The contract

The case does **not** prescribe a rig. The `[model]` table in `test-case.toml`
declares **only the two animations** the model must author (by name); the parts,
joints, and pivots that realize them are entirely the model's to invent, and working
them out is the test. Both are looping, self-playing idles, so the foundry cycles on
its own with no caller:

- **`rail_arm_slide`** — rides a heavy rail-arm smoothly up its shaft and back down.
- **`focus_ring_spin`** — turns a machined focus-ring a full revolution about the
  vertical axis.

The two `[[model.animation]]` entries carry only `name`, `loop`, and `auto_play` —
**declarations only**, no keyframes and no joints: the model authors each motion as an
F-curve at run time with the `voxel-anim` `define-animation`/`add-keyframe`
subcommands, and defines its own parts and joints with `define-part`/`define-joint`.
The base tower stays fixed while only the rail-arm and focus-ring move. The model may
add further parts, joints, and animations on top, but must produce these two
animations by these names and must not contradict them.

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
`rig.json` holding the two required animation declarations (so the contract exists
from the first operation) — but no parts or joints, which the model invents. There is
no target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Foundry ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-lancer-foundry/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
