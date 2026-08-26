# Hollowdeep — `v1.0.0`

This is version `v1.0.0` of the **Hollowdeep** test case, the flagship
`type = "full-stack"` case. The implemented game is an original side-view
sealed-colony survival sim titled Hollowdeep: you dig a cross-section colony
into a sealed underground and keep a crew of delvers alive against a diffusing
oxygen/CO2 air economy, a power network, needs-driven workers, and a
refine→build→farm loop, all racing a finite starting pocket of air.

`hollowdeep` is the catalog slug for this lineage of colony-survival cases, and
the game's in-fiction title. The case is inspired by colony survival sims,
notably *Oxygen Not Included*; its name, look, system set, and scope are
original to The Test Cabinet.

## What "full-stack" means

A full-stack case is an end-to-end playable-browser-game case with one
addition: the model under test produces the game's own assets during the run,
with the asset-generation binaries on the run image's `PATH`, and then builds a
game that uses them. One model both produces the art, effects, and audio and
builds the game around them.

The `full-stack` type schedules the run onto the `test-cabinet-full-stack-2d`
image, which carries exactly six binaries on `PATH`: `draw`, `draw-sheet`,
`particle-2d`, `sfx-synth`, `sfx-sample`, and `music`. Every sprite, animation,
particle effect, and sound the game plays is produced with one of them. There is
no `ui`/`paint`/`texture`/voxel/mesh tool, so all HUD and dashboard chrome is
drawn in code, and `specs/assets.md` holds the full production contract.

This case declares no `assets = [...]` of pre-made art. It does declare
`packages = ["@test-cabinet/particle-runtime"]`, the runtime the build plays its
produced particle systems with, and its `init` uses `npm install` so the
injected `file:` dependency resolves.

## Why this case

The case is demanding on two axes at once. It asks for several interacting
simulations:

- a dig-able tile world
- a two-gas diffusion economy with buoyancy and suffocation
- a power network
- pathfinding delvers on a job queue
- a build/food economy
- a survival-pressure loss state

It also asks for a full asset-production pass: animated delver sheets,
tile/machine/item/icon sprites, live particle overlays, and produced sound and
music. The case is scored across two domains, Colony Systems and Presentation &
Assets. The run's overall rating is the worst of the two, so a strong build must
both simulate and produce well.

## Contents

| Path                  | Seeded to run? | Purpose                                                |
| --------------------- | -------------- | ------------------------------------------------------ |
| `specs/`              | Yes            | The spec handed to the model, by concern.              |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.          |
| `workspaces/base/`    | Yes            | Starter project seeded to the run root.                |
| `test-case.toml`      | No             | Manifest: type, specs, variants, review items.         |
| `README.md`           | No             | This overview.                                         |

The specification is split across `specs/` by concern: `overview.md`,
`world.md`, `gas.md`, `power.md`, `delvers.md`, `economy.md`, `controls.md`,
`flow.md`, and `assets.md`, the asset-production contract. Those common specs
are seeded for every variant and copied into a run's repository. Each variant
seeds its own playable start to the stable path `specs/mode.md`. The case offers
a single variant, `base`, the standard colony start.

## Versioning

This case follows semantic versioning per version folder. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
