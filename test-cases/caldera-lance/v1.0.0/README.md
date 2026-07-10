# Caldera Lance — `v1.0.0`

This is version `v1.0.0` of the **Caldera Lance** test case: an asset-generation case
(`asset_kind = "voxel-animation"`) that asks a model to sculpt *and rig* the anti-armor
tower of the Holdfast as a 26×74×30 opaque-voxel model using only the `voxel-anim` tool,
one recorded operation at a time.

`caldera-lance` is the catalog slug for this case. It is one of the `caldera-*` roster
whose produced models are seeded into the [`caldera`](../../caldera/) end-to-end case,
and it shares the Holdfast's brass-and-iron palette. There is no target model — the
model builds toward the seeded brief and is reviewed subjectively against it.

## The contract

This case fixes only **what the Lance is**, **the animations it must author**, and **the
accent region a game recolors** — not the rig. The brief describes the subject (a tall
narrow brass mast carrying one long, thin, horizontal iron rail held high, with a
verdigris accent yoke where the rail pivots) and how it must move; the model **invents
whatever parts and joints it needs** and is judged on whether it works out the right
pieces, attaches them where they belong, and animates them convincingly. Nothing
prescribes a parts list, joint placements, or pose angles.

The two required, model-authored animations (declared by name in `test-case.toml`'s
`[model]` table with no keyframes; the model produces the F-curves) are:

- **`idle`** — a self-playing idle that traverses the rail slowly back and forth across
  a narrow arc, scanning for a target, on its own, so the tower reads as live even when
  it is not firing. The mast stays fixed.
- **`fire`** — a game-triggered playable that draws the rail back to charge, then
  discharges it forward in one hard snap and settles — a single powerful shot, so a
  reviewer can watch the shot without dragging a slider.

The model may add its own extra parts, joints, and animations on top, but must not drop
or contradict the required `idle` and `fire`.

## The accent region

The Lance's **mounting yoke** where the rail pivots must be sculpted in `#2f7d72` and
that color must appear nowhere else on the model. This is not decoration: the `caldera`
build finds every voxel of that color and repaints it per upgrade level (brass dark at
level 0, steel at level 1, gold at level 2), so one model serves all three levels
without new geometry. The contract is documented in the end-to-end case's
`specs/assets.md`, and a review item scores whether the region is contiguous, correctly
colored, and visible from more than one angle.

The brief also forbids steel `#b8bcc2`, gold `#ffce54`, and white `#dfeaea` anywhere on
the model, since a game paints those onto the accent yoke at run time.

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

The Lance ships three variants, sculpting the same tower at three sizes: `base` (the
case's 26×74×30 volume, the default), `half` (each extent ~halved), and `double` (each
doubled). The `half` and `double` variant files override `[voxel]`, and the brief is
rendered at the selected variant's dimensions. All three seed the common brief and are
rated on the case's single `fidelity` scoring domain; they add no specs, review items,
or domains of their own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/caldera-lance/v1.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
