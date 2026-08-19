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
covering the host interface, the frame, input actions, audio, assets, and how an
engine is delivered and recorded, see [Engines](/components/core/engines/).

## The catalogue

A run selects one of these engines.

| Engine | Slug | What it provides |
| --- | --- | --- |
| [None](/engines/none/) | `none` | No runtime. The build supplies everything. The default. |
| [Simple 2D](/engines/simple/simple-2d/) | `simple-2d` | Frame, input, audio, assets, and diagnostics for a 2D game that writes its own simulation and rendering. |

## Families and dimensionality

An engine belongs to a family. [Simple](/engines/simple/overview/) provides the
services a game needs around its own code and leaves the simulation and the
drawing to the game. [Decoupled](/engines/decoupled/overview/) provides a gameplay
framework the game is written inside, separates simulation from rendering, and
owns the rendering itself.

A family covers 2D and 3D as separate selectable engines rather than as one
engine with a mode. The spatial model, the rendering pipeline, the asset kinds,
and the touch layouts all differ between them, so a game targets one or the other
from the start and a case supports whichever suits it. Each family page describes
the engines that family is designed to cover; the catalogue above is what a run
may select today.

## Selecting an engine

An engine is selected per run and defaults to `none`. Support is declared per
case version with the manifest's `engines` key. A version supports the engines
its specification was written for, so a case gains support for an additional
engine by adding a version.
