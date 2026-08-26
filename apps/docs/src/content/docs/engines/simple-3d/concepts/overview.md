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

## Pages

| Page | Covers |
| --- | --- |
| [Frame](/engines/simple-3d/concepts/frame/) | The loop, simulated time, the clock behind delta time, and pacing. |
| [Viewport](/engines/simple-3d/concepts/viewport/) | World, logical, and device space, the frustum camera, the letterboxed fit, the measurement seam, and the per-frame resync. |
| [Input](/engines/simple-3d/concepts/input/) | Named actions over bindings, magnitudes and edges, the pointer, and the touch layout catalogue. |
| [Audio](/engines/simple-3d/concepts/audio/) | Synthesized and file-backed cues, the first-interaction unlock, and the cue events. |
| [Assets](/engines/simple-3d/concepts/assets/) | The single asset root, path resolution, the handles, and the load events. |
| [Diagnostics](/engines/simple-3d/concepts/diagnostics/) | Named sources, the overlay drawn on its own surface, and its toggle. |
| [Debug Surface](/engines/simple-3d/concepts/debug/) | The object `initialize` returns beside the state, whose poses and readings a build is driven and read through from code. |
| [Recording](/engines/simple-3d/concepts/recording/) | The recorder inside the scene context, per-frame inherited renderer state, and independently drawable frames. |
