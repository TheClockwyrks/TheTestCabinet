# Sunfront Monolith — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Monolith** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a towering super-heavy bipedal Duneforged war-mech as a 50×80×50
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-monolith` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The contract

This case does **not** prescribe a rig. It fixes only **what the Monolith is** and
the **animations** the model must author; the parts, joints, pivots, and ranges that
realize them are the model's to invent, and working them out is the test. What is
fixed:

- **The subject.** A super-heavy bipedal war-mech: a massive brass torso and head
  (the fixed core), two thick iron legs planted beneath the hips, and a giant iron
  cannon carried on the right arm that projects forward, aims up and down, and
  recoils — with a solar-amber chest core and amber shoulder lights, in the
  Duneforged palette.
- **The animations.** The `[model]` table declares two **required animations** the
  model must author as F-curves (no keyframes or joints ship in the manifest):
  **`walk`** (loops, `auto_play = false`) — a slow, heavy, planted opposite-phase
  stride that steps the two legs, one foot flat and still on the ground while the
  body passes over it — and **`fire`** (loops, `auto_play = false`) — a weapon-only
  recoil that snaps and settles the cannon while the legs hold, so a reviewer can
  watch it play back.

The model defines its own parts and joints with `voxel-anim define-part` /
`define-joint` and authors the two animations by name. It may add any extra parts,
joints, or animations on top (for example a live weapon-aim control), but must not
drop or contradict the two required animations.

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
the first operation; the model defines its own parts and joints and authors each
animation's F-curve keyframes). There is no target model and no operations schema —
the binary's `--help` is the contract.

## Variants

The Monolith ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-monolith/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
