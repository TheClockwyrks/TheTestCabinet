---
title: Overview
---

Structured 3D (slug `structured-3d`) is the 3D engine of the Structured
family. It provides a gameplay framework a game is written inside, engine-owned
rendering, and the services around both: the frame loop, collision detection,
input, audio, assets, and diagnostics. Dimensionality is an engine, not a mode
of one — a game targets Structured 3D or
[Structured 2D](/engines/structured-2d/overview/) from the start, and a case
declares whichever engines suit it.

The runtime is the npm package `@test-cabinet/structured-3d`, written entirely
in TypeScript and imported by a build as an ordinary dependency, with
`packages/structured-3d/` as its place in the repository and that package's
own `docs/` directory as the documentation seeded into a run workspace — the
framework documented in the depth a model needs to use it without seeing its
source. The engine is designed and awaiting implementation, so it is outside
the set a run may select.

## What each side owns

The engine owns the frame loop, the
[clock](/engines/structured-3d/apis/clocks/) that decides what each frame's
delta time is, the fit from the logical design size to the canvas, the frustum
[camera](/engines/structured-3d/apis/camera/) that projects the world into
that field, the rendering pipeline and its render modes, collision detection
with volumetric shapes and queries, the input action registry and its
bindings, the audio bus, the asset loader for meshes, textures, materials, and
audio, the debug overlay together with the frame metrics it reports, the
draw-command recorder over the scene context the rendering pipeline draws
through, and the debug surface the game instance returned from its
`initialize`, held for a caller to read back.

The game owns the levels it registers, the game modes that hold its rules, the
actors and components that populate a world, and the controllers that drive
its pawns. A level names a game mode and the actors placed in it, and the
engine builds a world from that description and drives it. An actor's
transform carries a position, an orientation, and a per-axis scale, and a game
configures what is drawn by attaching render components, which resolve meshes
and materials; the pipeline draws them under the modes `standard`,
`wireframe`, `unlit`, and `normals` without the game implementing any of
them. A component on the direct-draw path draws itself through the scene
context, for a case that measures the drawing itself.

The declarations that belong to the whole game are made once, when the game
instance initializes: the action bindings, the cue definitions, the assets the
instance holds, the diagnostic sources the overlay reads, and the debug
surface a caller drives the build through. What a single level needs it loads
in its own `load`, which the engine awaits before any actor of that level
exists.

## The sections

| Section | Covers |
| --- | --- |
| [APIs](/engines/structured-3d/apis/overview/) | The types, classes, and methods the engine exposes, as the specification its implementation satisfies. |
| [Concepts](/engines/structured-3d/concepts/overview/) | How each subsystem works and why it is shaped that way. |
| [Usage](/engines/structured-3d/usage/overview/) | How a build is expected to write its code against the engine. |
| [Examples](/engines/structured-3d/examples/overview/) | Complete games written against the engine, read as working reference. |
| [Validators](/engines/structured-3d/validators/overview/) | How a test case checks a build through the engine. |

## Where it fits

Structured 3D is the middle ground of the three engine families: it takes the
Decoupled family's gameplay framework and engine-owned rendering and keeps the
whole game in TypeScript, imported as an ordinary dependency, and the build
step that validation and the published source repository run installs and
bundles with Node alone. It suits a 3D case large enough that the framework is
a help rather than an imposition, and a case that wants engine-owned rendering
and engine-reported collision without a language boundary between the
simulation and the renderer. A check reads rendering and collision off engine
code, and the build stays in one language, so a run measures the model's work
against a codebase rather than its ability to compile a WebAssembly module.

A case's validators are vitest suites that run in the same process as the
build they check. A suite imports the engine and the build's own game module,
creates an engine over a scripted clock and a canvas it owns that yields a
WebGL2 context, and steps the world with `engine.advance`. A scenario is posed
through the build's
[debug surface](/engines/structured-3d/concepts/debug/), whose operations
arrange the live world through the same systems play uses, and read back off
`engine.world`.

The engine also captures what a build drew. A validator arms the
[recorder](/engines/structured-3d/concepts/recording/) around the stretch of a
scenario its check is about and hands back the operations the pipeline issued,
and it emits the recording as a review item's media by the same route a 2D
validator uses. What comes back is the same per-frame format the 2D engines
record: every frame carries the counter, the simulated time, the renderer
state it inherited, and the operations it issued, so a frame is drawn from
itself alone, and a recording from a 3D build seeks and scrubs in the
reviewer's player the same way a 2D one does.
