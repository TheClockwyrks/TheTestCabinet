---
title: Overview
---

Structured 2D (slug `structured-2d`) is the 2D engine of the Structured family.
It provides a gameplay framework a game is written inside, engine-owned
rendering, and the services around both: the frame loop, collision detection,
input, audio, assets, and diagnostics.

The runtime is the npm package `@test-cabinet/structured-2d`, written entirely
in TypeScript and imported by a build as an ordinary dependency. Its source is
`packages/structured-2d/`, and the documentation seeded into a run workspace is
that package's own `docs/` directory.

The engine is designed and awaiting implementation, so it is outside the set a
run may select.

## What each side owns

The engine owns the frame loop, the
[clock](/engines/structured-2d/apis/clocks/) that decides what each frame's
delta time is, the fit from the logical design size to the canvas, the camera
projection, the rendering pipeline, collision detection, the input action
registry and its bindings, the audio bus, the asset loader, the debug overlay
together with the frame metrics it reports, the draw-command recorder over the
context the rendering pipeline draws through, and the debug surface the game
instance returned from its `initialize`, held for a caller to read back.

The game owns the levels it registers, the game modes that hold its rules, the
actors and components that populate a world, and the controllers that drive its
pawns. A level names a game mode and the actors placed in it, and the engine
builds a world from that description and drives it.

The declarations that belong to the whole game are made once, when the game
instance initializes: the action bindings, the cue definitions, the assets the
instance holds, the diagnostic sources the overlay reads, and the debug surface
a caller drives the build through. What a single level needs it loads in its own
`load`, which the engine awaits before any actor of that level exists.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/structured-2d/apis/overview/) | The types, classes, and methods the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/structured-2d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/structured-2d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Examples](/engines/structured-2d/examples/overview/) | Complete games written against the engine, read as working reference. |
| [Validators](/engines/structured-2d/validators/overview/) | How a test case checks a build through the engine. |

## Where it fits

Structured 2D is the middle ground of the three engine families: it takes the
Decoupled family's gameplay framework and engine-owned rendering and keeps the
whole game in TypeScript. It suits a 2D case large enough that the framework is
a help rather than an imposition, and a case that wants to measure integration
with an existing object model without a language boundary in the way. A check
reads rendering and collision off engine code, and the build stays in one
language, so a run measures the model's work against a codebase rather than its
ability to compile a WebAssembly module.

A case's validators are vitest suites that run in the same process as the build
they check. A suite imports the engine and the build's own game module, creates
an engine over a scripted clock and a canvas it owns, and steps the world with
`engine.advance`. A scenario is posed through the build's
[debug surface](/engines/structured-2d/concepts/debug/), whose operations
arrange the live world through the same systems play uses, and read back off
`engine.world`.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/structured-2d/concepts/recording/) around the stretch of a
scenario its check is about and hands back the operations the pipeline issued,
which a reviewer replays beside the same scenario driven against the case's
reference implementation.

| Family | Gameplay framework | Simulation and rendering |
| --- | --- | --- |
| Simple | None | The game writes both, in TypeScript |
| Structured | Worlds, levels, game modes, actors, pawns, controllers | The engine renders; the game's simulation is TypeScript beside it |
| Decoupled | The same framework | The simulation is Rust compiled to WebAssembly; the engine's TypeScript renderer draws it |
