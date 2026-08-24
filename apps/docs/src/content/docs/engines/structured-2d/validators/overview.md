---
title: Overview
---

A case's validators are vitest suites that run in the same process as the build
they check. A suite imports the engine and the build's own game definition,
creates an engine over a canvas it owns and a clock it scripts, and steps it
with `engine.advance`. It asserts on the world the engine holds, the pixels the
canvas holds, the draw calls the context received, and the events the engine
broadcast.

Running in process is what makes a check exact. A suite asks for a number of
frames and gets that number, at the deltas its clock supplied, and a failure
arrives as an ordinary stack trace through the build's own code.

A suite that cannot construct its scenario reports it by skipping, with
`it.skipIf`, so an unanswered point reaches a reviewer rather than failing.

## Engine-specific by construction

A suite imports `@test-cabinet/structured-2d` by name and drives a
[`GameDefinition`](/engines/structured-2d/apis/game-instance/) built against
this engine's API, so it is written for this engine alone. A case that supports
more than one engine ships a set of validators for each, and each set is free to
use everything its engine provides. This engine's set lives in
`validation/structured-2d/` in the case's version folder.

## What a check reads

The engine's own object model is what a check reads. A suite finds actors with
`world.byTag`, reads the match through `world.state`, drives a pawn by
possessing it with a controller of its own, and observes transitions on
`engine.events`. Rendering and collision are engine-owned, so a check reads them
off engine code as well.

A case fixes the tag vocabulary, the level names, the action names, and the cue
names in its own constants module, so a check names things every build of the
case agrees on. Posing a situation runs through the build's debug surface, the
value its game instance's `initialize` returned, which the engine hands back off
`engine.debug`. The case's instrumentation spec states the surface's operations,
and each pose arranges the live world through the same systems play uses.

## Pages

| Page | Covers |
| --- | --- |
| [The Suite](/engines/structured-2d/validators/the-suite/) | Where the files live, the vitest project that runs them, the headless harness, and the module contract a case fixes. |
| [Simulation](/engines/structured-2d/validators/simulation/) | Stepping with a scripted clock, reading the world back, and asserting on outcomes that survive a change in step size. |
| [World and Actors](/engines/structured-2d/validators/world-and-actors/) | The level open, the match phase, which actors exist, which controller holds which pawn, and what a transition produced. |
| [Rendering](/engines/structured-2d/validators/rendering/) | Pixel readback through `getImageData` and the recording proxy over the 2D context, both converted through the camera and the viewport. |
| [Input and Audio](/engines/structured-2d/validators/input-and-audio/) | Dispatching key events at the harness event target and asserting on the cues a build played. |
| [Recording](/engines/structured-2d/validators/recording/) | Arming the engine's recorder around a scenario and emitting it as the review item's media. |
