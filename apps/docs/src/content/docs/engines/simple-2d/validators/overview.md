---
title: Overview
---

A case's validators are vitest suites that run in the same process as the build
they check. A suite imports the engine and the build's own game module, creates
an engine over a canvas it owns and a clock it scripts, and steps the game with
`engine.advance`. It poses a scenario through `engine.apply`, and asserts on
the state the frames left, the pixels the canvas holds, the draw calls the
context received, and the events the engine broadcast.

Running in process is what makes a check exact. A suite asks for a number of
frames and gets that number, at the deltas its clock supplied, and a failure
arrives as an ordinary stack trace through the game's own code.

## Engine-specific by construction

A suite imports `@test-cabinet/simple-2d` by name and builds a
[`Game<S, D>`](/engines/simple-2d/apis/game/) against this engine's API, so it is
written for this engine alone. A case that supports more than one engine ships a
set of validators for each, and each set is free to use everything its engine
provides.

The scenario a check arranges runs through the game's own state, because posing
a situation in the game's world belongs to the game. A suite arranges the
scenario through the build's debug surface, whose poses are transitions over
the state, advances the real systems forward, and reads the outcome back.

## Pages

| Page | Covers |
| --- | --- |
| [The Suite](/engines/simple-2d/validators/the-suite/) | Where the files live, the vitest project that runs them, the headless harness, and the module contract a case fixes. |
| [Simulation](/engines/simple-2d/validators/simulation/) | Stepping with a scripted clock, reading the state back, and asserting on outcomes that survive a change in step size. |
| [Rendering](/engines/simple-2d/validators/rendering/) | Pixel readback through `getImageData` and the recording proxy over the 2D context. |
| [Input and Audio](/engines/simple-2d/validators/input-and-audio/) | Driving named actions and asserting on the cues a build played. |
| [Recording](/engines/simple-2d/validators/recording/) | Arming the engine's recorder around a scenario and emitting it as the review item's media. |
