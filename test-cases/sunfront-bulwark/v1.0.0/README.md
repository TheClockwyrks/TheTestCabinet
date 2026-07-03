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

## The animation contract

This case does **not** prescribe a rig. It fixes only the **named animations** the
model must author; the model invents whatever parts and joints it needs to realize
them and is judged on whether it works out the right pieces, attaches them where they
belong, and animates them convincingly.

The `[model]` table declares **two required animations the model must author** as
F-curves (`define-animation` + `add-keyframe`), reduced to `name`, `loop`, and
`auto_play`:

- **`walk`** — a game-triggered playable (`auto_play = false`) that strides the mech
  forward on its legs, the feet planting flat and still before lifting and swinging,
  the two legs in opposite phase so one foot is always down.
- **`smash`** — a game-triggered playable (`auto_play = false`) that winds the heavy
  siege maul up over the head and slams it down in a smash while the mech stands its
  ground.

The case declares only each animation's name and playback flags — **no keyframes, no
joints, no parts**; the model produces the motion, and `rig.json` is pre-seeded with
the empty declarations (and empty `parts`/`joints`) so the contract exists from the
first operation. The model may add whatever parts, joints, and extra animations it
needs on top, but must not drop or contradict the two required animations.

## Contents

| Path             | Seeded to run? | Purpose                                                    |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained sculpting-and-rigging brief.            |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.              |
| `test-case.toml` | No             | Manifest: voxel volume, tool, output, the animations, and review. |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).          |
| `description.md` | No             | Site blurb.                                                |
| `README.md`      | No             | This overview.                                             |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded
`rig.json` holding the required animation declarations (with empty `parts` and
`joints` — the model invents the rig). There is no target model and no operations
schema — the binary's `--help` is the contract.

## Variants

The Bulwark ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bulwark/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
