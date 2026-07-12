# Caldera Runner — `v1.0.0`

This is version `v1.0.0` of the **Caldera Runner** test case: an asset-generation case
(`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* the fast,
fragile chaff of the Slag as a 20×24×44 opaque-voxel model using only the `voxel-anim`
tool, one recorded operation at a time.

`caldera-runner` is the catalog slug for this case. It is one of the `caldera-*` roster
whose produced models are seeded into the [`caldera`](../../caldera/) end-to-end case,
and it shares the Slag's obsidian-and-acid-green palette. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## The contract

This case fixes only **what the Runner is**, **the animations it must author**, and **the
accent region a game recolors** — not the rig. The brief describes the subject (a low,
long, wedge-shaped obsidian body on four thin sprung legs, a narrow head with a single
acid-green eye slit, and a raised dorsal ridge) and how it must move; the model **invents
whatever parts and joints it needs** and is judged on whether it works out the right
pieces, attaches them where they belong, and animates them convincingly. Nothing
prescribes a parts list, joint placements, or pose angles.

The two required, model-authored animations (declared by name in `test-case.toml`'s
`[model]` table with no keyframes; the model produces the F-curves) are:

- **`move`** — a game-triggered playable that sprints the Runner on its legs, light and
  darting, each foot planting before it lifts and swings. Authored in place: the leg cycle
  alone carries the stride and the game supplies the travel.
- **`attack`** — a game-triggered playable that coils the Runner back, throws its whole
  body forward in one strike, and recovers, so a reviewer can watch the lunge without
  dragging a slider.

The model may add its own extra parts, joints, and animations on top, but must not drop or
contradict the required `move` and `attack`.

## The accent region

The Runner's **dorsal ridge** must be sculpted in `#4a4358` and that color must appear
nowhere else on the model. This is not decoration: the `caldera` build finds every voxel
of that color and repaints it per tier (obsidian for Tier I, steel for Tier II, violet for
Tier III), so one model serves all three tiers without new geometry. The contract is
documented in the end-to-end case's `specs/assets.md`, and a review item scores whether the
region is contiguous, correctly colored, and visible from the side and above.

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

The Runner ships three variants, sculpting the same creature at three sizes: `base` (the
case's 20×24×44 volume, the default), `half` (each extent ~halved), and `double` (each
doubled). The `half` and `double` variant files override `[voxel]`, and the brief is
rendered at the selected variant's dimensions. All three seed the common brief and are
rated on the case's single `fidelity` scoring domain; they add no specs, review items,
or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-runner/v1.0.0/`). Each version is self-contained and immutable once a
run references it; design revisions land as new version folders.
