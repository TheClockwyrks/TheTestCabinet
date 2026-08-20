---
title: Decoupled 3D
---

Decoupled 3D (slug `decoupled-3d`) is the 3D engine of the Decoupled family. It
provides a gameplay framework a game is written inside, separates simulation
from rendering, and owns the rendering itself.

The engine is designed and awaiting implementation, so it is outside the set a
run may select. Its documentation arrives with its runtime, in the same four
sections [Simple 2D](/engines/simple-2d/overview/) uses.

## The gameplay framework

Decoupled 3D supplies the structure a game is built inside: a game mode holding
the rules of a match, actors as the things that exist in the world, pawns as the
actors a controller drives, and controllers as the players and computer
opponents driving them.

A game learns that structure from the engine's seeded documentation and builds
within it. This is the part of the family that measures integration with an
existing codebase, so the framework is documented in the depth a model needs to
use it without seeing its source.

## The simulation boundary

A game's simulation is authored in Rust and compiled to WebAssembly against the
engine's crate. Its rendering is configured declaratively and drawn by the
engine's TypeScript renderer, and per-frame state reaches the renderer through
the engine rather than by serializing a snapshot each frame. The simulation
therefore runs with no rendering dependency, and the renderer reads simulation
state without stepping it.

The Rust toolchain is present only while a run is live, so a build compiles its
module once during the run and commits it as a build input. The build step that
validation and the published source repository run installs and bundles with
Node alone.

## Rendering

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the engine's pipeline draws them. Render modes
such as wireframe, unlit, and normals belong to that pipeline and are available
without the game implementing them.

A game may also draw directly, for a case that measures the drawing itself. An
actor on that path implements its own rendering and the engine calls it as part
of the frame.

## Modules

Decoupled 3D offers modules for the game-agnostic work a case may or may not
want provided, collision among them.

## Where it fits

Decoupled 3D suits a 3D case large enough that the framework is a help rather
than an imposition, and a case whose validation needs the precision that
engine-owned simulation and rendering give. A 3D case is the clearest instance
for the family, because the work a game does around its own logic is largest
there.
