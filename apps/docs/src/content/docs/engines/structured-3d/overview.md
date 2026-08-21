---
title: Structured 3D
---

Structured 3D (slug `structured-3d`) is the 3D engine of the Structured family. It
provides a gameplay framework a game is written inside, owns the rendering, and
keeps the whole game in TypeScript.

The engine is designed and awaiting implementation, so it is outside the set a
run may select. Its documentation arrives with its runtime, in the same five
sections [Structured 2D](/engines/structured-2d/overview/) uses.

## The gameplay framework

Structured 3D supplies the structure a game is built inside: a game instance that
outlives every level, a world holding one running level, a game mode holding the
rules of a match, actors as the things that exist in the world, pawns as the
actors a controller drives, and controllers as the players and computer opponents
driving them.

A game learns that structure from the engine's seeded documentation and builds
within it. This is the part of the family that measures integration with an
existing codebase, so the framework is documented in the depth a model needs to
use it without seeing its source.

## One language

A game's simulation and its configuration of the rendering are both TypeScript,
imported as an ordinary dependency. The build step that validation and the
published source repository run installs and bundles with Node alone.

## Rendering

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the engine's pipeline draws them. Render modes such
as wireframe, unlit, and normals belong to that pipeline and are available
without the game implementing them.

A game may also draw directly, for a case that measures the drawing itself. A
component on that path implements its own rendering and the engine calls it as
part of the frame.

## What dimensionality changes

The spatial model is 3D, so transforms carry a third axis and an orientation, the
camera projects a frustum rather than a rectangle, the render components resolve
meshes and materials, and the collision shapes and queries are volumetric. A game
targets one engine or the other from the start, and a case declares whichever
suits it.

## Where it fits

Structured 3D suits a 3D case large enough that the framework is a help rather
than an imposition, and a case that wants engine-owned rendering and
engine-reported collision without a language boundary between the simulation and
the renderer.
