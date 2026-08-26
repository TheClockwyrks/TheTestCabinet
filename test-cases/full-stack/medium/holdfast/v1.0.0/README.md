# Holdfast — `v1.0.0`

This is version `v1.0.0` of the **Holdfast** test case, a `type = "full-stack"`
case. The implemented game is an original top-down colony survival-management
sim: you direct a handful of settlers on a single frontier map to gather,
build, cook, and farm, and hold the base against an escalating threat director
that sends ranged raids, all while racing the settlers' own needs and the
day/night clock.

`holdfast` is the catalog slug for this lineage of colony-survival cases, and
the game's in-fiction title. The case draws on colony survival sims, notably
*RimWorld*, with a name, look, system set, and scope original to The Test
Cabinet.

## What "full-stack" means

A full-stack case is an end-to-end (playable-browser-game) case with one
addition: the model under test produces the game's own assets during the run,
with the asset-generation binaries on the run image's `PATH`, and then builds
a game that uses them. It is not the older two-run pattern, in which a
separate asset-gen run makes an asset that a later game consumes. Here one
model both produces the art, effects, and audio and builds the game around
them.

The `full-stack` type schedules the run onto the `test-cabinet-full-stack-2d`
image, which carries exactly six binaries on `PATH` and no others: `draw`,
`draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, and `music`. Every
sprite, animation, particle effect, and sound the game plays is produced with
one of them. There is no `ui`, `paint`, `texture`, voxel, or mesh tool, so all
HUD and dashboard chrome is drawn in code. The full production contract is
`specs/assets.md`. Accordingly this case declares no `assets = [...]` of
pre-made art. It does declare `packages = ["@test-cabinet/particle-runtime"]`,
the runtime the build plays its produced particle systems with, and its `init`
uses `npm install`, not `npm ci`, so the injected `file:` dependency resolves.

## Scope and scoring

Holdfast follows the full-stack convention set by the flagship `hollowdeep`.
It is a hard case on two axes at once. It asks for several interacting
simulations: a top-down tile world with resource nodes, needs-and-mood-driven
settlers with skills on a priority job queue and pathfinding, a
gather/build/cook/farm economy, a day/night cycle, and an escalating
ranged-combat threat director with cover, downed settlers, and a colony-wipe
loss state. On top of that it asks for a full asset-production pass: animated
settler and raider sheets, terrain, structure, item, and icon sprites, live
combat and construction particle effects, and produced sound and music. It is
scored across two domains, Colony Systems and Presentation & Assets, with the
run's overall rating the worst of the two.

## Contents

| Path                  | Seeded to run? | Purpose                                                |
| --------------------- | -------------- | ------------------------------------------------------ |
| `specs/`              | Yes            | The spec handed to the model, by concern.              |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.          |
| `workspaces/base/`    | Yes            | Starter project seeded to the run root.                |
| `test-case.toml`      | No             | Manifest: type, specs, variants, review items.         |
| `README.md`           | No             | This overview.                                         |

The specification is split across `specs/` by concern: `overview.md`,
`world.md`, `settlers.md`, `economy.md`, `combat.md`, `time.md`,
`controls.md`, `flow.md`, and `assets.md`, the asset-production contract, all
seeded for every variant, plus the mode source `mode-base.md`. The variant
seeds it to the stable dest `specs/mode.md`, which the common specs reference;
the mode spec replaces the playable start. The case offers a single variant,
`base`, the standard frontier start.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/full-stack/medium/holdfast/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land
as new version folders.
