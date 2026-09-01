---
title: Overview
---

Structured 3D (slug `structured-3d`) is the 3D engine of the Structured family.
It provides a gameplay framework a game is written inside, engine-owned
rendering, and the services around both: the frame loop, collision detection,
input, audio, assets, and diagnostics.

The runtime is the npm package `@test-cabinet/structured-3d`, written in
TypeScript over three.js and imported by a build as an ordinary dependency,
with `three` as a peer dependency the build declares itself. Its source is
`packages/structured-3d/`, and the documentation seeded into a run workspace is
that package's own `docs/` directory.

The engine is specified in full on these pages and awaiting its
implementation, so it stays outside the set a run selects from until the
package lands. The specification is what the implementation is written to
satisfy.

## What each side owns

The engine owns the frame loop, the
[clock](/engines/structured-3d/apis/clocks/) that decides what each frame's
delta time is, the fit from the logical design size to the canvas, the camera
and its projection, the rendering pipeline over three.js and the screen layer
it composites over the picture, collision detection, the input action registry
and its bindings, the audio bus with its positional cues, the asset loader with
its texture and model decoders, the debug overlay together with the frame
metrics it reports, the recorder that captures the scene and the screen layer
frame by frame, and the debug surface the game instance returned from its
`initialize`, held for a caller to read back.

The game owns the levels it registers, the game modes that hold its rules, the
actors and components that populate a world, and the controllers that drive
its pawns. A level names a game mode and the actors placed in it, and the
engine builds a world from that description and drives it. What is drawn is
described by render components: meshes from geometry and material
declarations, loaded models with their animations, lights, and the
screen-space shapes, text, and sprites of a HUD.

The declarations that belong to the whole game are made once, when the game
instance initializes: the action bindings, the cue definitions, the assets the
instance holds, the diagnostic sources the overlay reads, and the debug surface
a caller drives the build through. What a single level needs it loads in its
own `load`, which the engine awaits before any actor of that level exists.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/structured-3d/apis/overview/) | The types, classes, and methods the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/structured-3d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/structured-3d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Examples](/engines/structured-3d/examples/overview/) | Complete games written against the engine, read as working reference. |
| [Validators](/engines/structured-3d/validators/overview/) | How a test case checks a build through the engine. |

## What dimensionality changes

The spatial model is 3D. A transform carries a position, a quaternion
rotation, and a scale on three axes, and the engine ships the plain vector and
quaternion helpers a game moves with. The camera projects a frustum into the
logical design field rather than a rectangle, and it follows a view target's
transform and field of view. The render components resolve meshes, materials,
models, and lights, and the render modes swap materials at draw time so
wireframe, unlit, and normals views cover the direct path as well. The
collision shapes and queries are volumetric. The touch layouts add analog
sticks to the pads.

## Where it fits

Structured 3D suits a 3D case large enough that the framework is a help rather
than an imposition, and a case that wants engine-owned rendering and
engine-reported collision without a language boundary between the simulation
and the renderer. A check reads rendering and collision off engine code, and
the build stays in one language, so a run measures the model's work against a
codebase rather than its ability to compile a WebAssembly module. A 3D case is
where the work a game does around its own logic is largest, so the framework
buys the most here.

A case's validators are vitest suites that run in the same process as the
build they check. A suite imports the engine and the build's own game module,
creates an engine over a scripted clock with the headless backend, and steps
the world with `engine.advance`. A scenario is posed through the build's
[debug surface](/engines/structured-3d/concepts/debug/), whose operations
arrange the live world through the same systems play uses, and read back off
`engine.world` and the scene the pipeline maintains.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/structured-3d/concepts/recording/) around the stretch of a
scenario its check is about and hands back the scene and the screen layer the
pipeline submitted, frame by frame, which a reviewer replays beside the same
scenario driven against the case's reference implementation.

| Family | Gameplay framework | Simulation and rendering |
| --- | --- | --- |
| Simple | None | The game writes both, in TypeScript |
| Structured | Worlds, levels, game modes, actors, pawns, controllers | The engine renders; the game's simulation is TypeScript beside it |
| Decoupled | The same framework | The simulation is Rust compiled to WebAssembly; the engine's TypeScript renderer draws it |
