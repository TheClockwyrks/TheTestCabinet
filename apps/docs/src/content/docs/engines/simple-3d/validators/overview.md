---
title: Overview
---

A case's validators are vitest suites that run in a browser page beside the
build they check. A suite imports the engine and the build's own game module,
creates an engine over canvases it makes in the page and a clock it scripts,
and steps the game with `engine.advance`. It poses a scenario through
`engine.apply`, and asserts on the state the frames left, the scene the build
populated, the pixels of the stage canvas and the screen layer, the draw calls
of the screen layer, and the events the engine broadcast.

The suite drives the engine's clock directly in the page, which is what makes
a check exact. A suite asks for a number of frames and gets that number, at the
deltas its clock supplied, and a failure arrives as an ordinary stack trace
through the game's own code.

## Engine-specific by construction

A suite imports `@test-cabinet/simple-3d` by name and builds a
[`Game<S, D>`](/engines/simple-3d/apis/game/) against this engine's API, so it is
written for this engine alone. A case that supports more than one engine ships a
set of validators for each, and each set is free to use everything its engine
provides.

The scenario a check arranges runs through the game's own state, because posing
a situation in the game's world belongs to the game. A suite arranges the
scenario through the build's debug surface, whose poses are transitions over
the state, advances the real systems forward, and reads the outcome back.

## What a check reads

The engine renders in the page as it does in the built game, so every surface
the game produces is readable from a check. A check reads five things.

| Surface | Reached through | Answers |
| --- | --- | --- |
| The scene | `engine.scene`, `engine.camera`, and `engine.view().camera()` | What is in the world, where each object stands, how it is colored, whether it is visible, and where the camera is. |
| Projection | `engine.view().project(point)` | The logical stage point a world point draws at, and whether it is in view. |
| The screen layer | The harness's screen canvas, through `getImageData` mapped by the viewport or through a recording proxy over its context | HUD text, readouts, and menus, as pixels or as the operations that drew them. |
| The stage canvas | The harness's stage canvas, drawn into a 2D canvas the suite owns and read with `getImageData` mapped by the viewport | What the rendered picture shows at a point: the background, the letterbox bars, and the color a lit object left where its projection lands. |
| The recording | `engine.stopRecording()` | The frames of a section of the scenario as video, with a frame count, for the reviewer's evidence. |

The scene, the projection, the two pixel surfaces, and the screen layer's
draw-call stream are how a check states a claim, because a claim needs a value
to assert against. The recording is what the reviewer looks at afterwards.

## Pages

| Page | Covers |
| --- | --- |
| [The Suite](/engines/simple-3d/validators/the-suite/) | Where the files live, the browser-mode vitest project that runs them, the page-canvas harness with its screen canvas, and the module contract a case fixes. |
| [Simulation](/engines/simple-3d/validators/simulation/) | Stepping with a scripted clock, reading the state back, and asserting on outcomes that survive a change in step size. |
| [Rendering](/engines/simple-3d/validators/rendering/) | Scene traversal, world positions and material colors, projection through the view, pixel readback from the stage canvas and the screen layer, and the recording proxy over the screen context. |
| [Input and Audio](/engines/simple-3d/validators/input-and-audio/) | Driving named actions and the pointer, and asserting on the cues a build played and where it placed them. |
| [Recording](/engines/simple-3d/validators/recording/) | Arming the engine's recorder around a scenario and emitting the `.webm` video as the review item's media. |
