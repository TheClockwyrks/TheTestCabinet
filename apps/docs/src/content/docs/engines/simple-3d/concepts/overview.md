---
title: Overview
---

This section describes the engine's internals: the model each subsystem imposes
on a game, how that subsystem behaves, and why it is shaped that way. It states
the model and the guarantees; the exact surface is at
[APIs](/engines/simple-3d/apis/overview/) and the idioms are at
[Usage](/engines/simple-3d/usage/overview/).

Each subsystem resolves one part of a browser game that is the same in every
browser game, and the model it imposes is what makes a build's behavior
reproducible across runs and examinable from outside. Two properties run through
every page. A game reaches the engine only through the scoped api handed to the
function it is in, and everything the engine observes it broadcasts as an event
a caller subscribes to.

A third property is particular to 3D. The picture is a retained scene the engine
owns and the game populates, drawn through an engine-owned camera the game
poses, with a 2D screen layer composited over it for the readouts every game
needs. The state carries the simulation alone, and the three objects a game
builds live beside it rather than in it.

## Pages

| Page | Covers |
| --- | --- |
| [Frame](/engines/simple-3d/concepts/frame/) | The loop, simulated time, the clock behind delta time, pacing, and the order of one frame across the two surfaces. |
| [Viewport](/engines/simple-3d/concepts/viewport/) | The fixed logical design size, the letterboxed fit over both canvases, the renderer's viewport and scissor, the measurement seam, and the per-frame resync. |
| [Rendering](/engines/simple-3d/concepts/rendering/) | The retained scene, the two surfaces and the compositing that joins them, the engine-owned camera, the headless backend, and why three objects stay out of the state. |
| [Camera and View](/engines/simple-3d/concepts/camera-and-view/) | The three spaces, posing the camera from `render` and reading it from `update`, picking with a ray, projecting a point, and the listener. |
| [Input](/engines/simple-3d/concepts/input/) | Named actions over bindings, magnitudes and edges, the pointer, and the 3D touch layout catalogue with its analog sticks. |
| [Audio](/engines/simple-3d/concepts/audio/) | Synthesized and file-backed cues, positional playback from the camera, the first-interaction unlock, and the cue events. |
| [Assets](/engines/simple-3d/concepts/assets/) | The single asset root, path resolution, textures and glTF models as templates, and the load events. |
| [Diagnostics](/engines/simple-3d/concepts/diagnostics/) | Named sources, reading them back, the renderer's counts, and the overlay drawn on the screen layer in device space. |
| [Debug Surface](/engines/simple-3d/concepts/debug/) | The object `initialize` returns beside the state, whose poses and readings a build is driven and read through from code. |
| [Recording](/engines/simple-3d/concepts/recording/) | The scene as submitted, the wrapper over the screen layer's context, per-frame inherited state, and independently drawable frames. |
