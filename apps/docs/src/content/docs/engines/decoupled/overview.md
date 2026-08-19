---
title: Overview
---

The Decoupled family provides a gameplay framework a game is written inside, with
simulation separated from rendering. It ships two engines, `decoupled-2d` and
`decoupled-3d`, which differ in their rendering pipeline, spatial model, asset
kinds, and touch layouts.

A game's simulation is authored in Rust and compiled to WebAssembly. Its
rendering is configured declaratively and drawn by the engine's TypeScript
renderer. The two communicate through the engine, so a game's simulation runs with
no rendering dependency and the renderer reads simulation state without stepping
it.

## The gameplay framework

Decoupled supplies the structure a game is built inside: a game mode holding the
rules of a match, actors as the things that exist in the world, pawns as the
actors a controller drives, and controllers as the players and computer opponents
driving them.

A game written against Decoupled learns that structure from the engine's seeded
documentation and builds within it. This is the part of the family that measures
integration with an existing codebase, so the framework is documented in the depth
a model needs to use it without seeing its source.

## Rendering

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the engine's pipeline draws them. Render modes such
as wireframe, unlit, and normals belong to that pipeline and are available without
the game implementing them.

A game may also draw directly, for a case that measures the drawing itself. An
actor on that path implements its own rendering and the engine calls it as part of
the frame.

## The simulation boundary

A game's Rust crate builds against the engine's crate and compiles to a single
WebAssembly module. Per-frame state reaches the renderer through the engine rather
than by serializing a snapshot each frame.

The Rust toolchain is present only while a run is live, so a build compiles its
module once during the run and commits it as a build input. The build step that
validation and the published source repository run installs and bundles with Node
alone.

## Modules

Decoupled offers modules for the game-agnostic work a case may or may not want
provided, collision among them. A case declares the presets it supports, and the
preset that produced a run is recorded with it.

## Where it fits

Decoupled suits a case large enough that the framework is a help rather than an
imposition, and a case whose validation needs the precision that engine-owned
simulation and rendering give. A 3D case is the clearest instance, because the
work a game does around its own logic is largest there.
