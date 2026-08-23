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

The engine owns the frame loop, the [clock](/engines/simple-2d/apis/clocks/)
that decides what each frame's delta time is, the fit from the logical design
size to the canvas, the input action registry and its bindings, the audio bus,
the asset loader, the debug overlay together with the frame metrics it reports,
the draw-command recorder over the context the game draws through, and the debug
surface the game returned beside its state, held for a caller to read back.

The game owns its simulation and its drawing, supplied as a
[`Game<S, D>`](/engines/simple-2d/apis/game/): an `initialize` that builds the
state and the debug surface and returns them as `[state, debug]`, an `update`
that advances the state by a delta in seconds, and a `render` that draws it
through a 2D context. The declarations the engine works from are made
during initialization: action bindings, cue definitions, the assets the state
holds, the diagnostic sources the overlay reads, and the debug surface a caller
drives the build through.

Each function receives only the part of the engine it may use, so a frame's
audible and observable behavior belongs to the update and the picture belongs to
the render. Collision detection, physics, and gameplay structure belong to the
game, so a case that measures those measures them directly.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/simple-2d/apis/overview/) | The types and functions the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/simple-2d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/simple-2d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Examples](/engines/simple-2d/examples/overview/) | Complete games written against the engine, read as working reference. |
| [Validators](/engines/simple-2d/validators/overview/) | How a test case checks a build through the engine. |

## Where it fits

Simple 2D suits a case whose difficulty is the simulation and the presentation.
Carom-class games write their own collision response and draw their own
playfield, and the engine removes the surrounding work a case never intended to
measure.

A case's validators are vitest suites that run in the same process as the build
they check. A suite imports the engine and the build's own game module, creates
an engine over a scripted clock and a canvas it owns, and steps the game with
`engine.advance`. The clock, the input, the cues that played, the assets that
resolved, and the diagnostics are therefore read off engine code, and the frames
a check depends on are exactly the frames it asked for.

A case still declares the scenario its checks arrange, since setting up a
situation runs through the game's own state.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/simple-2d/concepts/recording/) around the stretch of a
scenario its check is about and hands back the operations the build issued,
which a reviewer replays beside the same scenario driven against the case's
reference implementation.
