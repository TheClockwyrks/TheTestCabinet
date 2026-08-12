# Sunfront Sentinel — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Sentinel** test case: an
asset-generation case (`asset_kind = "voxel-animation"`) that asks a model to
sculpt *and rig* an upright bipedal Duneforged war-mech as a 20×40×20 opaque-voxel
model using only the `voxel-anim` tool, one recorded operation at a time.

`sunfront-sentinel` is the catalog slug for this case. It is one of the
`sunfront-*` Duneforged voxel roster and shares the faction's brass-and-sandstone
palette and solar-amber team accent. There is no target model — the model builds
toward the seeded brief and is reviewed subjectively against it.

## The rig

The case does **not** prescribe a rig. The `[model]` table in `test-case.toml`
fixes only the **animations** the model must author, by name; the model invents
whatever parts and joints a walking, firing mech needs and is judged on whether it
works out the right pieces, attaches them where they belong, and animates them
convincingly. The two **required animations** the model must **author** (name +
intent only; the model lays down the F-curve keyframes at run time with
`define-animation`/`add-keyframe`) are:

- **`walk`** (loop, not auto-play) — a game-triggered walk: the mech strides
  forward on its two legs in a two-phase gait, a planted-flat stance where each
  foot sits still on the ground while the mech passes over it, then a swing that
  lifts, carries forward, and plants, the two legs in opposite phase. The legs
  move; the rifle holds.
- **`fire`** (loop, not auto-play) — a game-triggered weapon showcase: the
  right-arm rifle snaps into a quick recoil nod, aiming up and down about its
  shoulder mount and settling, while the mech stands its ground and the legs stay
  planted.

The model may add its own extra parts, joints, and animations on top, but must not
drop or contradict the required animations.

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
the first operation); the parts and joints are the model's to invent. There is no
target model and no operations schema — the binary's `--help` is the contract.

## Variants

The Sentinel ships a single default variant — `base`, declared in
`variants/base.toml`. It seeds the common brief and is rated on the case's single
`overall` scoring domain; it adds no specs or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/sunfront-sentinel/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
