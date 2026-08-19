---
title: Overview
---

Simple 2D (slug `simple-2d`) is the 2D engine of the Simple family. It provides
everything a 2D browser game needs around its own code and leaves the game
itself to the model: the build writes its own simulation and its own drawing.

The runtime is the npm package `@test-cabinet/simple-2d`, written entirely in
TypeScript and imported by a build as an ordinary dependency. Its source is
`packages/simple-2d/`, and the documentation seeded into a run workspace is that
package's own `docs/` directory.

## What each side owns

The engine owns the frame loop and the delta time it hands the game, the canvas
fit, the input action registry and its bindings, the audio bus, the asset
loader, and the debug overlay. It also owns the host interface a validator
drives, which is engine code and therefore present in every build.

The game owns its simulation and its drawing. It supplies an update taking a
delta time in seconds and a render taking a 2D drawing context, plus the
declarations the engine works from: action bindings, cue definitions, and
diagnostic sources.

Collision detection, physics, and gameplay structure belong to the game, so a
case that measures those measures them directly.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/simple-2d/apis/overview/) | The types and functions the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/simple-2d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/simple-2d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Validators](/engines/simple-2d/validators/overview/) | How a validation script drives a build through the engine. |

## Where it fits

Simple 2D suits a case whose difficulty is the simulation and the presentation.
Carom-class games write their own collision response and draw their own
playfield, and the engine removes the surrounding work a case never intended to
measure.

Because every surface the engine owns is driven through the host interface
rather than through code the model wrote, the clock, the input, the audio log,
the asset log, and the diagnostics are checkable without the build exposing
instrumentation of its own. A case still declares the control operations its
checks need to arrange a situation, since the scenario setup remains the game's.
