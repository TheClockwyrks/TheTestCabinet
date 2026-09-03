---
title: Overview
---

Simple 3D (slug `simple-3d`) is the 3D engine of the Simple family. It provides
everything a 3D browser game needs around its own code and leaves the game
itself to the model: the build writes its own simulation and its own picture.

The runtime is the npm package `@test-cabinet/simple-3d`, written in
TypeScript over three.js and imported by a build as an ordinary dependency,
with `three` as a peer dependency the build declares itself. Its source is
`packages/simple-3d/`, and the documentation seeded into a run workspace is
that package's own `docs/` directory.

## What each side owns

The engine owns the frame loop, the [clock](/engines/simple-3d/apis/clocks/)
that decides what each frame's delta time is, the fit from the logical design
size to the canvas, the renderer over the canvas, the scene object and the
camera it renders through, the screen layer a game draws its readouts on, the
input action registry and its bindings, the pointer mapped into the game's
logical coordinates, the audio bus with its positional cues, the asset loader
with its texture and model decoders, the debug overlay together with the frame
metrics it reports, the recorder that captures the picture it drew as video,
frame by frame, and the debug surface the game returned beside its state, held
for a caller to read back.

The game owns its simulation and its picture, supplied as a
[`Game<S, D>`](/engines/simple-3d/apis/game/): an `initialize` that builds the
state and the debug surface and returns them as `[state, debug]`, an `update`
that takes the current state and a delta in seconds and returns the next state,
and a `render` that populates the engine's scene, poses its camera, and draws
on the screen layer from that state. The engine holds the state by value and
hands every reader a read-only view, so rendering cannot change the state and
nothing but a transition advances it. The three objects a game builds live in
the retained [scene](/engines/simple-3d/concepts/rendering/) rather than in the
state.

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

## What dimensionality changes

The spatial model is 3D. The game draws by building a three.js scene and
posing a camera rather than by issuing 2D context calls, and the engine
composites a 2D screen layer over the picture for the readouts every game
needs. The assets a game loads gain textures and glTF models, the models the
voxel binaries produce among them.
The pointer arrives in logical stage units as in 2D, and the engine turns it
into a world-space ray through the camera on request. The touch layouts add
analog sticks to the pads.

## Where it fits

Simple 3D suits a 3D case whose difficulty is the simulation and the
presentation, and which wants the surrounding work provided rather than
measured. A crane yard, a vehicle, or an arena written against it spends its
effort on the physics and the scene, and the engine removes the frame loop,
the fit, the input, the audio graph, and the overlay a case never intended to
measure.

A case's validators are vitest suites that run in a browser, in the page
beside the build they check. A suite imports the engine and the build's own
game module, creates an engine over a canvas it makes with a scripted clock,
and steps the game with `engine.advance`. The clock, the input, the cues that
played, the assets that resolved, and the diagnostics are read off engine
code, and the scene the build populated is read back through `engine.scene`,
the camera's projection, and the stage canvas's pixels.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/simple-3d/concepts/recording/) around the stretch of a
scenario its check is about and hands back a video of the frames the build
drew, one per engine frame and timestamped in simulated time, which a reviewer
scrubs beside the same scenario driven against the case's reference
implementation.
