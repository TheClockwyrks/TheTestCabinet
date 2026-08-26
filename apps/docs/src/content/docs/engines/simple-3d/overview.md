---
title: Overview
---

Simple 3D (slug `simple-3d`) is the 3D engine of the Simple family. It provides
everything a 3D browser game needs around its own code and leaves the game
itself to the model: the build writes its own simulation and its own drawing.
Dimensionality is an engine, not a mode of one — a game targets Simple 3D or
[Simple 2D](/engines/simple-2d/overview/) from the start, and a case declares
whichever engines suit it.

The runtime is the npm package `@test-cabinet/simple-3d`, written entirely in
TypeScript and imported by a build as an ordinary dependency, with
`packages/simple-3d/` as its place in the repository and that package's own
`docs/` directory as the documentation seeded into a run workspace. The engine
is designed and awaiting implementation, so it is outside the set a run may
select.

## What each side owns

The engine owns the frame loop, the [clock](/engines/simple-3d/apis/clocks/)
that decides what each frame's delta time is, the fit from the logical design
size to the canvas, the input action registry and its bindings, the pointer
mapped into the game's logical coordinates, the audio bus, the asset loader
for meshes, textures, materials, and audio, the debug overlay together with
the frame metrics it reports, the scene context the game draws through with
the draw-command recorder inside it, and the debug surface the game returned
beside its state, held for a caller to read back.

The game owns its simulation and its drawing, supplied as a
[`Game<S, D>`](/engines/simple-3d/apis/game/): an `initialize` that builds the
state and the debug surface and returns them as `[state, debug]`, an `update`
that takes the current state and a delta in seconds and returns the next
state, and a `render` that draws that state through the engine-owned
`SceneContext` — a write-only 3D surface whose every draw call names its full
world transform, and whose only retained state is the camera, the lights, and
the render mode. The game keeps its camera in its own state as a plain
`CameraState` and applies it from `render`, so the camera it renders with is
the one it picks against. The engine holds the state by value and hands every
reader a read-only view, so rendering cannot change the state and nothing but
a transition advances it. The declarations the engine works from are made
during initialization: action bindings, cue definitions, the assets the state
holds, the diagnostic sources the overlay reads, and the debug surface a
caller drives the build through.

Each function receives only the part of the engine it may use, so a frame's
audible and observable behavior belongs to the update and the picture belongs
to the render. Collision detection, physics, and gameplay structure belong to
the game, so a case that measures those measures them directly.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/simple-3d/apis/overview/) | The types and functions the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/simple-3d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/simple-3d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Examples](/engines/simple-3d/examples/overview/) | Complete games written against the engine, read as working reference. |
| [Validators](/engines/simple-3d/validators/overview/) | How a test case checks a build through the engine. |

## Where it fits

Simple 3D suits a 3D case whose difficulty is the simulation and the
presentation, and which wants the surrounding work provided rather than
measured. The build writes its own collision arithmetic and draws its own
scene, and the engine removes the work a case never intended to measure.

A case's validators are vitest suites that run in the same process as the
build they check. A suite imports the engine and the build's own game module,
creates an engine over a scripted clock and a canvas it owns that yields a
WebGL2 context, and steps the game with `engine.advance`. The clock, the
input, the cues that played, the assets that resolved, and the diagnostics are
therefore read off engine code, and the frames a check depends on are exactly
the frames it asked for.

A case still declares the scenario its checks arrange, since setting up a
situation runs through the game's own state: a validator poses it through
`engine.apply` and the build's debug surface, and reads it back off
`engine.state`.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/simple-3d/concepts/recording/) around the stretch of a
scenario its check is about and hands back the operations the build issued,
and it emits the recording as a review item's media by the same route a 2D
validator uses. What comes back is the same per-frame format the 2D engines
record: every frame carries the counter, the simulated time, the renderer
state it inherited, and the operations it issued, so a frame is drawn from
itself alone, and a recording from a 3D build seeks and scrubs in the
reviewer's player the same way a 2D one does.
