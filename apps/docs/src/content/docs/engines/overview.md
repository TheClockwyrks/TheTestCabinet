---
title: Engines
---

A test case is implemented by driving a [harness](/harnesses/overview/) through
an [orchestrator](/orchestrators/overview/). An engine is what the resulting
game is built on: the runtime that owns the frame loop, input, audio, assets,
and diagnostics, and in some engines rendering and a gameplay framework as well.

An engine is independent of the test case. It is selected per run alongside the
test case, variant, harness, and model, and its slug and version are recorded on
the run. A case declares which engines it supports, and a run of that case is
limited to that set.

This section is the catalogue of the engines. For the contract they implement,
covering the host interface, the frame, input actions, audio, assets, and how an
engine is delivered and recorded, see [Engines](/components/core/engines/).

## The catalogue

A run selects one of these engines.

| Engine | Slug | What it provides |
| --- | --- | --- |
| [None](/engines/none/) | `none` | No runtime. The build supplies everything. The default. |
| [Simple 2D](/engines/simple-2d/overview/) | `simple-2d` | Frame, input, audio, assets, and diagnostics for a 2D game that writes its own simulation and rendering. |

The remaining engines are designed and awaiting implementation, so they document
their intent and stay outside the set a run selects from: [Simple
3D](/engines/simple-3d/overview/), [Decoupled
2D](/engines/decoupled-2d/overview/), and [Decoupled
3D](/engines/decoupled-3d/overview/).

## Families and dimensionality

Each engine belongs to a family, which fixes how much of a game the runtime
owns. The Simple family provides the services a game needs around its own code
and leaves the simulation and the drawing to the game. The Decoupled family
provides a gameplay framework the game is written inside, separates simulation
from rendering, and owns the rendering itself.

A family covers 2D and 3D as separate selectable engines rather than as one
engine with a mode. The spatial model, the rendering pipeline, the asset kinds,
and the touch layouts all differ between them, so a game targets one or the
other from the start and a case supports whichever suits it.

Each engine documents itself in full, so the section for one engine states its
whole contract rather than deferring to a sibling. An engine's pages are split
four ways: the APIs it must expose, the concepts behind its internals, how a
build uses it, and how a validator drives it.

## Selecting an engine

An engine is selected per run and defaults to `none`. Support is declared per
case version with the manifest's `engines` key. A version supports the engines
its specification was written for, so a case gains support for an additional
engine by adding a version.
