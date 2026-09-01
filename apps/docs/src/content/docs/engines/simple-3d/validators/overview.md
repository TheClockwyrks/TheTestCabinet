---
title: Overview
---

A case's validators are vitest suites that run in the same process as the build
they check. A suite imports the engine and the build's own game module, creates
an engine over canvases it owns and a clock it scripts, and steps the game with
`engine.advance`. It poses a scenario through `engine.apply`, and asserts on
the state the frames left, the scene the build populated, the pixels and draw
calls of the screen layer, and the events the engine broadcast.

Running in process is what makes a check exact. A suite asks for a number of
frames and gets that number, at the deltas its clock supplied, and a failure
arrives as an ordinary stack trace through the game's own code.

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

The engine runs under the `headless` backend in a suite, which maintains the
scene, updates its world matrices, draws the screen layer, and captures every
frame for the recorder, and produces no pixels of the 3D picture. A check
therefore reads four things.

| Surface | Reached through | Answers |
| --- | --- | --- |
| The scene | `engine.scene`, `engine.camera`, and `engine.view().camera()` | What is in the world, where each object stands, how it is colored, whether it is visible, and where the camera is. |
| Projection | `engine.view().project(point)` | The logical stage point a world point draws at, and whether it is in view. |
| The screen layer | The harness's screen canvas, through `getImageData` mapped by the viewport or through a recording proxy over its context | HUD text, readouts, and menus, as pixels or as the operations that drew them. |
| The recording | `engine.stopRecording()` | The draws, lights, and camera each frame submitted, and the screen layer's operations. |

A claim about the rendered pixels of the world pass is a browser check outside
the in-process suite. The in-process suite asserts on the scene, the
projection, the recording, and the screen layer, which between them state what
the build placed, where it lands on the stage, what was submitted to be drawn,
and what the HUD shows.

## Pages

| Page | Covers |
| --- | --- |
| [The Suite](/engines/simple-3d/validators/the-suite/) | Where the files live, the vitest project that runs them, the headless harness with its screen canvas, and the module contract a case fixes. |
| [Simulation](/engines/simple-3d/validators/simulation/) | Stepping with a scripted clock, reading the state back, and asserting on outcomes that survive a change in step size. |
| [Rendering](/engines/simple-3d/validators/rendering/) | Scene traversal, world positions and material colors, projection through the view, pixel readback from the screen layer, and the recording proxy over its context. |
| [Input and Audio](/engines/simple-3d/validators/input-and-audio/) | Driving named actions and the pointer, and asserting on the cues a build played and where it placed them. |
| [Recording](/engines/simple-3d/validators/recording/) | Arming the engine's recorder around a scenario and emitting it as the review item's media. |
