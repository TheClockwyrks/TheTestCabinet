# Sunfront Bulwark — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bulwark** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a heavy bipedal Duneforged war-mech — a tower shield braced on
its left arm and a siege maul in its right — as a 56×68×48 opaque-voxel model
using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-bulwark` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The rig

The required, game-facing contract declared in `test-case.toml`'s `[model]` table:

| Part | Parent | Pivot | What it is |
| --- | --- | --- | --- |
| `torso` | *(root)* | `[0, 0, 0]` | Body, head, both shoulders, and the left shield arm |
| `leg_left` | `torso` | `[18, 28, 24]` | The left leg |
| `leg_right` | `torso` | `[38, 28, 24]` | The right leg |
| `weapon` | `torso` | `[40, 44, 26]` | The right arm gripping the siege maul |

- **`weapon_pitch`** (caller, rotation about `x`, `-0.5..1.1`) — the game-facing
  control: winds the right maul arm up over the head and smashes it down about its
  shoulder hinge. (The left arm and its braced tower shield are part of the fixed
  `torso`.)
- **`leg_left_stride`** / **`leg_right_stride`** (auto, rotation about `x`,
  `-0.5..0.5`) — the two legs walk on their own via their `walk_left` / `walk_right`
  clips, driven in opposite phase.

The case also authors a **`smash`** review animation that drives `weapon_pitch`
so a reviewer can watch the maul smash without dragging the slider. The model
may add its own extra parts, joints, and clips on top, but must not drop or
contradict the required interface.

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

The Bulwark ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bulwark/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
