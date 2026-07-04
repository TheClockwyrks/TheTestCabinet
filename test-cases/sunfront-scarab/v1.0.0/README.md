# Sunfront Scarab — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Scarab** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a low, wide four-legged Duneforged war-beetle as a 48×28×56
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-scarab` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The contract

This case fixes only **what the Scarab is** and **the animations it must author** —
not the rig. The brief describes the subject (a domed brass carapace body, four iron
legs, and a pair of snapping iron mandibles at the head) and how it must move; the
model **invents whatever parts and joints it needs** and is judged on whether it
works out the right pieces, attaches them where they belong, and animates them
convincingly. Nothing prescribes a parts list, joint placements, or pose angles.

The two required, model-authored animations (declared by name in
`test-case.toml`'s `[model]` table with no keyframes; the model produces the
F-curves) are:

- **`walk`** — a game-triggered playable that strides the beetle forward on its
  legs in a diagonal-pair gait, each foot planting flat and still before it lifts,
  swings, and plants again.
- **`bite`** — a game-triggered playable that snaps the front mandibles wide open
  and shut so a reviewer can watch the jaws work without dragging a slider.

The model may add its own extra parts, joints, and animations on top, but must not
drop or contradict the required `walk` and `bite`.

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

The Scarab ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-scarab/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
