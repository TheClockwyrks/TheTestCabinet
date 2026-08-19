---
title: Overview
---

This section describes the engine's internals: the model each subsystem imposes
on a game, how that subsystem behaves, and why it is shaped that way. It states
the model and the guarantees; the exact surface is at
[APIs](/engines/simple-2d/apis/overview/) and the idioms are at
[Usage](/engines/simple-2d/usage/overview/).

Read this section to understand what the engine guarantees. Each subsystem
resolves one part of a browser game that is the same in every browser game, and
the model it imposes is what makes a build's behaviour reproducible across runs
and drivable from outside.

## Pages

| Page | Covers |
| --- | --- |
| [Frame](/engines/simple-2d/concepts/frame/) | The loop, simulated time, the delta clamp, and the replaceable clock. |
| [Viewport](/engines/simple-2d/concepts/viewport/) | The fixed logical design size, the letterboxed fit, and the per-frame resync. |
| [Input](/engines/simple-2d/concepts/input/) | Named actions over bindings, magnitudes and edges, and the touch layout catalogue. |
| [Audio](/engines/simple-2d/concepts/audio/) | Synthesized cues, the first-interaction unlock, and the semantic cue log. |
| [Assets](/engines/simple-2d/concepts/assets/) | The single asset root, resolution, and the request log. |
| [Diagnostics](/engines/simple-2d/concepts/diagnostics/) | Named sources, the overlay drawn in device space, and its toggle. |
| [Host](/engines/simple-2d/concepts/host/) | The driver seam: what `createEngine` installs, the handle and version, and argument validation at the boundary. |
