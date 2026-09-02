# Junction — `v1.0.0`

This is version `v1.0.0` of the **Junction** test case, a `type = "full-stack"`
case. The implemented game is an original top-down transit-and-utility city
builder titled Junction: you zone land for homes, shops, and industry, lay the
roads and rail that carry citizens to work, and run the power and water that let
it all develop, keeping traffic flowing, demand met, and the budget solvent
against congestion, pollution, and upkeep, or the city goes bankrupt.

`junction` is the catalog slug for this lineage of city-builder cases, and the
game's in-fiction title. The case is inspired by city sims, notably *SimCity*,
and by the flow pressure of *Mini Metro*; its name, look, system set, and scope
are original to The Test Cabinet.

## What "full-stack" means

A full-stack case is an end-to-end playable-browser-game case with one
addition: the model under test produces the game's own assets during the run,
with the asset-generation binaries on the run image's `PATH`, and then builds a
game that uses them. One model both produces the art, effects, and audio and
builds the game around them.

The `full-stack` type, with `asset_dimension` left at its `2d` default,
schedules the run onto the `test-cabinet-full-stack-2d` image, which carries
exactly six binaries on `PATH`: `draw`, `draw-sheet`, `particle-2d`,
`sfx-synth`, `sfx-sample`, and `music`. Every sprite, animation,
particle effect, and sound the game plays is produced with one of them. There is
no `ui`/`paint`/`texture`/voxel/mesh tool, so all HUD, dashboard, and overlay
chrome is drawn in code, and `specs/assets.md` holds the full production
contract.

This case declares no `assets = [...]` of pre-made art. It does declare
`packages = ["@test-cabinet/particle-runtime"]`, the runtime the build plays its
produced particle systems with, and its `init` uses `npm install` so the
injected `file:` dependency resolves.

## Why this case

The case is demanding on two axes at once. It asks for several interacting
simulations layered on one grid:

- a self-developing zoned map with density tiers, pollution, and land value
- a transit network citizens path across with real flow-pressure congestion
- power and water utility networks whose supply propagates and gates
  development
- an RCI demand economy with a budget that ends in bankruptcy

It also asks for a full asset-production pass: zone/transit/utility sprites and
vehicles per tier, animated signal/construction/vehicle sheets, live particle
overlays, and produced sound and music. The simulation itself is authored in
Rust and compiled to a committed `.wasm` that the JS/TS front end drives. The
case is scored across two domains, City Systems and Presentation & Assets, and
the run's overall rating is the worst of the two, so a strong build must both
simulate and produce well.

## Contents

| Path                  | Seeded to run? | Purpose                                                |
| --------------------- | -------------- | ------------------------------------------------------ |
| `specs/`              | Yes            | The spec handed to the model, by concern.              |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.          |
| `workspaces/base/`    | Yes            | Starter project seeded to the run root.                |
| `test-case.toml`      | No             | Manifest: type, specs, variants, review items.         |
| `README.md`           | No             | This overview.                                         |

The specification is split across `specs/` by concern: `overview.md`, `map.md`,
`transit.md`, `utilities.md`, `economy.md`, `controls.md`, `flow.md`,
`simulation.md`, the Rust/WebAssembly simulation-core contract, and
`assets.md`, the asset-production contract. Those common specs are seeded for
every variant and copied into a run's repository. Each variant seeds its own
playable start to the stable path `specs/mode.md`. The case offers a single
variant, `base`, the standard flat starter valley.

## Versioning

This case follows semantic versioning per version folder. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
