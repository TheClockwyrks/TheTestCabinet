# Midway — `v1.0.0`

This is version `v1.0.0` of the **Midway** test case, a `type = "full-stack"`
case. The implemented game is an original top-down theme-park management sim
titled Midway: you grow a fenced plot into a park, laying paths, building and
pricing rides and stalls, hiring staff, and keeping a desire-driven crowd happy
against a reputation feedback loop that couples happiness to arrivals and an
economy that can go bankrupt.

`midway` is the catalog slug for this lineage of park-management cases, and the
game's in-fiction title. The case is inspired by park-management sims, notably
*RollerCoaster Tycoon*; its name, look, system set, and scope are original to
The Test Cabinet.

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

- a path-and-placement park grid
- desire-driven guest AI with pathfinding and spending
- a queue/ride simulation with capacity, throughput, and breakdowns
- a pricing/upkeep/wage economy with a bankruptcy loss
- staff who clean and fix and cheer
- a reputation feedback loop coupling happiness back to arrivals

It also asks for a full asset-production pass: animated guest sheets, ride
animations, path/ride/stall/scenery/icon sprites, live particle effects, and
produced sound and a carnival music bed. The case is scored across two domains,
Park Systems and Presentation & Assets. The run's overall rating is the worst of
the two, so a strong build must both simulate and produce well.

## Contents

| Path                  | Seeded to run? | Purpose                                                |
| --------------------- | -------------- | ------------------------------------------------------ |
| `specs/`              | Yes            | The spec handed to the model, by concern.              |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.          |
| `workspaces/base/`    | Yes            | Starter project seeded to the run root.                |
| `test-case.toml`      | No             | Manifest: type, specs, variants, review items.         |
| `README.md`           | No             | This overview.                                         |

The specification is split across `specs/` by concern: `overview.md`,
`park.md`, `guests.md`, `rides.md`, `economy.md`, `staff.md`, `controls.md`,
`flow.md`, and `assets.md`, the asset-production contract. Those common specs
are seeded for every variant and copied into a run's repository. Each variant
seeds its own playable start to the stable path `specs/mode.md`. The case offers
two variants:

- `base` — the standard park start.
- `downpour` — the standard park under changing weather: periodic rain that
  empties the paths, drops arrivals and mood, and raises upkeep and ride
  breakdowns.

## Versioning

This case follows semantic versioning per version folder. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
