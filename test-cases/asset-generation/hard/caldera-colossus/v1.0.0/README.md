# Caldera Colossus — `v1.0.0`

This is version `v1.0.0` of the **Caldera Colossus** test case: an asset-generation case
(`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* the massive elite
bruiser of the Slag as a 64×76×60 opaque-voxel model using only the `voxel-anim` tool, one
recorded operation at a time.

`caldera-colossus` is the catalog slug for this case. It is one of the `caldera-*` roster
whose produced models are seeded into the [`caldera`](../../caldera/) end-to-end case, and
it shares the Slag's obsidian-and-acid-green palette. There is no target model — the model
builds toward the seeded brief and is reviewed subjectively against it.

## The contract

This case fixes only **what the Colossus is**, **the animations it must author**, and **the
accent region a game recolors** — not the rig. The brief describes the subject (a massive,
columnar obsidian quadruped on four thick column legs, an enormous body with heavy shoulder
guards, an open furnace crater in its back exposing a molten acid-green core, and molten
seams radiating from the crater) and how it must move; the model **invents whatever parts
and joints it needs** and is judged on whether it works out the right pieces, attaches them
where they belong, and animates them convincingly. Nothing prescribes a parts list, joint
placements, or pose angles.

The three required, model-authored animations (declared by name in `test-case.toml`'s
`[model]` table with no keyframes; the model produces the F-curves) are:

- **`move`** — a game-triggered playable that walks the Colossus forward on its four thick
  column legs, ponderous and immensely heavy, each leg landing with weight and the whole
  mass settling onto it. Authored in place: the leg cycle alone carries the stride and the
  game supplies the travel.
- **`attack`** — a game-triggered playable that rears the Colossus and brings its full mass
  down in one crushing slam, then settles, so a reviewer can watch the slam without dragging
  a slider.
- **`aura`** — a **self-playing** idle (`auto_play = true`) that runs continuously under
  everything else: the furnace core in the back crater pulses and breathes and the molten
  seams swell and dim with it, so the armor aura the Colossus projects over nearby Slag
  reads as always on. It moves no leg.

The model may add its own extra parts, joints, and animations on top, but must not drop or
contradict the required `move`, `attack`, and `aura`.

## The accent region

The Colossus's **shoulder guards and the raised rim around the back crater** must be
sculpted in `#4a4358` and that color must appear nowhere else on the model — not on the
molten core or its seams. This is not decoration: the `caldera` build finds every voxel
of that color and repaints it per tier (obsidian for Tier I, steel for Tier II, violet
for Tier III), so one model serves all three tiers without new geometry. The contract is
documented in the end-to-end case's `specs/assets.md`, and the reviewer checks whether
the region is contiguous, correctly colored, and visible from more than one angle.

The brief also forbids steel `#c9ced6` and violet `#b56bff` anywhere on the model, since a
game paints those on at run time.

## Contents

| Path                  | Seeded to run? | Purpose                                                   |
| --------------------- | -------------- | --------------------------------------------------------- |
| `specs/brief.md.hbs`  | **Yes**        | The self-contained brief, rendered per variant.           |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.             |
| `test-case.toml`      | No             | Manifest: voxel volume, tool, output, animations, review. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).         |
| `description.md`      | No             | Site blurb.                                               |
| `changelog.md`        | No             | This version's changelog entry.                           |
| `README.md`           | No             | This overview.                                            |

A run receives the seeded brief, the `voxel-anim` binary, and a pre-seeded `rig.json`
holding the required animation declarations (so the contract exists from the first
operation). There is no target model and no operations schema — the binary's `--help` is
the contract.

## Variants

The Colossus ships three variants, sculpting the same creature at three sizes: `base`
(the case's 64×76×60 volume, the default), `half` (each extent ~halved), and `double`
(each doubled). The `half` and `double` variant files override `[voxel]`, and the brief
is rendered at the selected variant's dimensions. All three seed the common brief and
are rated on the case's single `overall` scoring domain; they add no specs or domains of
their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-colossus/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
