---
title: Overview
---

A case's validators are vitest suites that run in a browser. The project runs in
vitest browser mode with the Playwright provider on headless Chromium, and a
suite runs in the page: it imports the engine and the build's own game
definition, creates an engine over a canvas it makes with
`document.createElement("canvas")` and a clock it scripts, and steps it with
`engine.advance`. It asserts on the world the engine holds, the scene the
pipeline placed, the pixels of the stage canvas, the pixels and the operations
of the screen layer, the recording the engine captured, and the events the
engine broadcast.

The suite drives the engine's clock directly in the page, which is what makes a
check exact. A suite asks for a number of frames and gets that number, at the
deltas its clock supplied, and a failure arrives as an ordinary stack trace
through the build's own code. Chromium renders WebGL2 in software, so the
picture a check reads is the one the pipeline drew, with no GPU on the host.

A suite poses its own scenario through the case's debug surface, removing the
entities its requirement is not about and placing the ones it is, so every check
reaches a verdict.

## Engine-specific by construction

A suite imports `@clockwyrks/structured-3d` by name and drives a
[`GameDefinition`](/engines/structured-3d/apis/game-instance/) built against
this engine's API, so it is written for this engine alone. A case that supports
more than one engine ships a set of validators for each, and each set is free to
use everything its engine provides. This engine's set lives in
`validation/structured-3d/` in the case's version folder.

## What a check reads

The engine's own object model is what a check reads. A suite finds actors with
`world.byTag`, reads the match through `world.state`, drives a pawn by
possessing it with a controller of its own, and observes transitions on
`engine.events`. Rendering and collision are engine-owned, so a check reads them
off engine code as well: the render components on an actor are data, and
`engine.scene` holds the three objects the pipeline placed for them.

The scene is read through `engine.scene` and `engine.world` together. A check
finds an object by name or by traversal, reads its world position, its
visibility, its geometry's vertex count, and its material's color, and reads the
camera's pose through `world.camera.snapshot()`. Projection is a reading of its
own: `world.camera.worldToLogical` gives the logical stage point a world point
draws at, so a claim about where something appears on screen is checked without
pixels.

Pixels come from two canvases. The screen layer is a 2D canvas the harness
supplies, so `getImageData` on its context and a recording proxy over that
context work exactly as they do for a 2D engine, for HUD text, readouts, and
menus. The stage canvas holds the world pass, and a suite reads it by drawing
the canvas into a 2D canvas of its own and sampling that with `getImageData`,
which is how a claim about the rendered picture is stated.

The recording is the fifth reading. `stopRecording` resolves with the
[`Recording`](/engines/structured-3d/apis/recording/) the engine captured, and a
check reads its frame count from `frames.length` and hands its video bytes to
the output the verdict unit declared.

A case fixes the tag vocabulary, the level names, the action names, and the cue
names in its own constants module, so a check names things every build of the
case agrees on. Posing a situation runs through the build's debug surface, the
value its game instance's `initialize` returned, which the engine hands back off
`engine.debug`. The case's instrumentation spec states the surface's operations,
and each pose arranges the live world through the same systems play uses.

## Pages

| Page                                                                    | Covers                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [The Suite](/engines/structured-3d/validators/the-suite/)               | Where the files live, the vitest browser project that runs them, the harness with its stage and screen canvases, and the module contract a case fixes.                                                                         |
| [Simulation](/engines/structured-3d/validators/simulation/)             | Stepping with a scripted clock, reading the world back, and asserting on outcomes that survive a change in step size.                                                                                                          |
| [World and Actors](/engines/structured-3d/validators/world-and-actors/) | The level open, the match phase, which actors exist, 3D transforms in assertions, which controller holds which pawn, and what a transition produced.                                                                           |
| [Rendering](/engines/structured-3d/validators/rendering/)               | Render components as data, the scene the pipeline placed, projection through the camera, pixel readback from the stage canvas and the screen layer, the recording proxy over the screen layer, and asserting on a render mode. |
| [Input and Audio](/engines/structured-3d/validators/input-and-audio/)   | Dispatching key and pointer events at the harness event target and asserting on the cues a build played, with the world point a positional cue carries.                                                                        |
| [Recording](/engines/structured-3d/validators/recording/)               | Arming the engine's recorder around a scenario and emitting the `.webm` video as the review item's media.                                                                                                                      |
