# Sunfront Garrison — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Garrison** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a low, wide Duneforged fortified infantry barracks as a 60×64×60
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-garrison` is the catalog slug for this case. The Garrison is the
**Trooper's spawner** in the Sunfront roster — the muster post fresh troopers deploy
from — and is deliberately its own building: a humble, fortified infantry billet,
plainly different from the faction's industrial foundries and its grand Bastion
keep. It is one of the `sunfront-*` Duneforged voxel roster and shares the faction's
brass-and-sandstone palette and solar-amber team accent. There is no target model —
the model builds toward the seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes
only the two named animations the model must author; the parts, joints, pivots, and
ranges that realize them are the model's to invent, and it is judged on working them
out. Both animations are self-playing decorative idles (`auto_play`, `loop`):

- **`muster_ramp_drop`** — the front deployment ramp hinges down from the muster
  gate's sill toward the ground and lifts back, on its own, like a drawbridge.
- **`muster_bell_swing`** — the belfry bell swings side to side about its yoke on its
  own, like a pendulum ringing.

Each animation is declared as a required contract but carries **no** keyframes — the
model authors its F-curve motion at run time with the `voxel-anim`
`define-animation`/`add-keyframe` subcommands. This building has **no** caller-driven
motion: the two decorative animations are the whole animation, cycling on their own
while the blockhouse body stays put. The model may add its own extra parts, joints,
and animations on top, but must not drop or contradict the two required animations.

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
`rig.json` holding the two required animation declarations (so the contract exists
from the first operation). There is no target model and no operations schema — the
binary's `--help` is the contract.

## Variants

The Garrison ships three size variants: **`base`** (the case's 60×64×60 volume, the
default), **`half`** (each extent ~halved, 30×32×30), and **`double`** (each doubled,
120×128×120). Each declares its own `[voxel]` override and renders the brief at those
dimensions; all share the single `fidelity` scoring domain and its review items.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-garrison/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
