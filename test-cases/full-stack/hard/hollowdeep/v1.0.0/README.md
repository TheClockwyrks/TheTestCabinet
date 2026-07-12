# Hollowdeep — `v1.0.0`

This is version `v1.0.0` of the **Hollowdeep** test case, and the **flagship
exemplar** of a new test type: `type = "full-stack"`. The implemented game is an
original side-view sealed-colony survival sim titled **Hollowdeep**: you dig a
cross-section colony into a sealed underground and keep a crew of delvers alive against
a diffusing oxygen/CO2 air economy, a power network, needs-driven workers, and a
refine→build→farm loop — all racing a finite starting pocket of air.

`hollowdeep` is the catalog slug for this lineage of colony-survival cases, and the
game's in-fiction title. The case is inspired by colony survival sims (notably *Oxygen
Not Included*) but is not a clone of any of them — the name, look, system set, and
scope are original to The Test Cabinet.

## What "full-stack" means

A **full-stack** case is an end-to-end (playable-browser-game) case with **one
addition**: the model under test must **produce the game's own assets during the run**,
with the asset-generation binaries on the run image's `PATH`, and then build a game
that uses them. It is **not** the older two-run pattern (a separate asset-gen run makes
an asset a later game consumes); here **one** model both produces the art, effects, and
audio and builds the game around them.

The `full-stack` type schedules the run onto the `test-cabinet-full-stack-2d` image,
which carries exactly six binaries on `PATH` — `draw`, `draw-sheet`, `particle-2d`,
`sfx-synth`, `sfx-sample`, and `music` — and no others. Every sprite, animation,
particle effect, and sound the game plays is produced with one of them; there is no
`ui`/`paint`/`texture`/voxel/mesh tool, so all HUD/dashboard chrome is drawn in code.
The full production contract is `specs/assets.md`. Accordingly this case declares **no**
`assets = [...]` of pre-made art (that would defeat the point); it does declare
`packages = ["@test-cabinet/particle-runtime"]`, the runtime the build plays its
produced particle systems with, and its `init` uses `npm install` (not `npm ci`) so the
injected `file:` dependency resolves.

## Why this case

Hollowdeep is the pattern the sibling full-stack cases will copy, so convention fidelity
matters most. It is a **hard** case on two axes at once: several interacting
simulations (a dig-able tile world, a two-gas diffusion economy with buoyancy and
suffocation, a power network, pathfinding delvers on a job queue, a build/food economy,
and a survival-pressure loss state) **and** a full asset-production pass (animated
delver sheets, tile/machine/item/icon sprites, live particle overlays, and produced
sound and music). It is scored across two domains — **Colony Systems** and
**Presentation & Assets** — with the run's overall rating the worst of the two, so a
strong build must both simulate and produce well.

## Contents

| Path                  | Seeded to run? | Purpose                                                |
| --------------------- | -------------- | ------------------------------------------------------ |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.              |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.          |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.     |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as targets.         |
| `workspaces/base/`    | **Yes**        | Starter project seeded to the run root.                |
| `test-case.toml`      | No             | Manifest: type, specs, variants, checks, review items. |
| `README.md`           | No             | This overview.                                         |

The specification is split across `specs/` by concern: `overview.md`, `world.md`,
`gas.md`, `power.md`, `delvers.md`, `economy.md`, `controls.md`, `flow.md`,
`assets.md` (the asset-production contract), `proof.md`, and the mode specs under
`specs/modes/`. The common specs (everything except the variant-only mode spec) are
seeded for every variant; the variant seeds its own mode spec. The case offers a single
variant — `base` (the standard colony start).

The seeded specs and the rendered reference screenshots are copied into a run's
repository. The reference *source* mockups are not seeded, so a model builds the UI from
the specs and the screenshots rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/hollowdeep/v1.0.0/`). Each version is self-contained and immutable once a
run references it; design revisions land as new version folders.
