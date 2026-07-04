# Sunfront Bombard — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Bombard** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* a four-legged Duneforged siege mortar walker as a 40×40×60
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time.

`sunfront-bombard` is the catalog slug for this case. It is one of the `sunfront-*`
Duneforged voxel roster and shares the faction's brass-and-sandstone palette and
solar-amber team accent. There is no target model — the model builds toward the
seeded brief and is reviewed subjectively against it.

## The contract

The case does **not** prescribe a rig. `test-case.toml`'s `[model]` table fixes only
the **animations** the model must author; the parts, joints, pivots, and ranges that
realize them are the model's to invent, and it is judged on whether it works out the
right pieces, attaches them where they belong, and animates them convincingly. This
is deliberate: fixing a full skeleton turned the test into instruction-following and
made every model produce near-identical output.

The subject stays fixed — a four-legged siege mortar walker: a low armored hull
raised on legs, four legs that carry and walk it, a turret on top that swivels to
aim, and a long mortar barrel projecting forward that elevates to lob high, with a
solar-amber muzzle glow and the Duneforged palette.

The rig declares two **required animations the model must author** as F-curves (no
keyframes in the manifest), both game-triggered playables:

- **`walk`** — a four-legged gait that strides the walker forward on planted flat
  feet in a diagonal-pair pattern (feet plant flat and still, then lift, swing, and
  plant), while the turret and barrel hold.
- **`bombard_fire`** — the weapon showcase: the mortar barrel kicks up in a quick
  recoil-lob and settles, while the legs hold planted.

The model authors both with the `voxel-anim` `define-animation`/`add-keyframe`
subcommands, defining its own parts and joints (`define-part`, `set-pivot`,
`define-joint`) as it goes. It may add extra parts, joints, and animations on top,
but must produce these two animations by these names.

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
the first operation); the parts and joints start empty for the model to define. There
is no target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Bombard ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`fidelity` scoring domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-bombard/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
