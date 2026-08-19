---
title: Engines
---

A test case is implemented by driving a [harness](/harnesses/overview/) through an
[orchestrator](/orchestrators/overview/). An engine is what the resulting game is
built on: the runtime that owns the frame loop, input, audio, assets, and
diagnostics, and in some engines rendering and a gameplay framework as well.

An engine is independent of the test case. It is selected per run alongside the
test case, variant, harness, and model, and its slug and version are recorded on
the run. A case declares which engines it supports, and a run of that case is
limited to that set.

This section is the catalogue of the engines. For the contract they implement,
covering the host interface, the frame, input actions, audio, assets, modules, and
how an engine is delivered and recorded, see
[Engines](/components/core/engines/).

## Engines

| Engine | Slug | What it provides |
| --- | --- | --- |
| [None](/engines/none/) | `none` | No runtime. The build supplies everything. The default. |
| [Simple 2D](/engines/simple/overview/) | `simple-2d` | Frame, input, audio, assets, and diagnostics for a 2D game that writes its own simulation and rendering. |
| [Simple 3D](/engines/simple/overview/) | `simple-3d` | The same services for a 3D game. |
| [Decoupled 2D](/engines/decoupled/overview/) | `decoupled-2d` | A gameplay framework with simulation separated from rendering, and engine-owned 2D rendering. |
| [Decoupled 3D](/engines/decoupled/overview/) | `decoupled-3d` | The same framework with engine-owned 3D rendering. |

## Families and dimensionality

The engines form two families. Simple provides the services a game needs around
its own code and leaves the simulation and the drawing to the game. Decoupled
provides a gameplay framework the game is written inside, separates simulation
from rendering, and owns the rendering itself.

Each family ships a 2D and a 3D engine as separate selectable engines rather than
as one engine with a mode. The spatial model, the rendering pipeline, the asset
kinds, and the touch layouts all differ between them, so a game targets one or the
other from the start and a case supports whichever suits it.

## Selecting an engine

An engine is selected per run and defaults to `none`. Because runs of one case
under different engines measure different work, the engine keys a
[coverage](/components/backend/coverage/) cell and a
[leaderboard](/components/site/overview/#leaderboard) row alongside the variant.

Support is declared per case version with the manifest's `engines` key. A version
supports the engines its specification was written for, so a case gains support
for an additional engine by adding a version.
