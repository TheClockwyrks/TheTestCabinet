---
title: Overview
---

This section states how a validation script drives a build through the engine
rather than through code the model wrote. Every example here is driver-side
code: what a script calls, what it reads back, and how it sequences a check.

The host interface is engine code, installed by `createEngine`, so a build that
runs at all is a build that is driveable and the operations mean the same thing
for every case that selects the engine. A script replaces the clock, drives
actions, and reads the frame, cue, asset, and diagnostic state without the build
exposing instrumentation of its own.

A case still declares the control operations its own checks need, because
arranging a scenario in the game's world remains the game's. A driver sets up
through those operations, runs the real systems forward on the engine clock, and
reads the outcome back through the host interface.

## Pages

| Page | Covers |
| --- | --- |
| [The Host](/engines/simple-2d/validators/the-host/) | Finding the handle, checking the version, and the shape of every value returned. |
| [Clock](/engines/simple-2d/validators/clock/) | Taking the clock manually, installing a schedule, and advancing an exact number of frames. |
| [Input](/engines/simple-2d/validators/input/) | Reading the registered actions, holding an action at a magnitude, and arming an edge. |
| [Observations](/engines/simple-2d/validators/observations/) | Asserting on the frame counter, the cue log, the asset log, and the diagnostic sources. |
