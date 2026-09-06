---
title: Overview
---

This section describes the engine's internals: the model each subsystem imposes
on a game, how that subsystem behaves, and why it is shaped that way. It states
the model and the guarantees; the exact surface is at
[APIs](/engines/structured-2d/apis/overview/) and the idioms are at
[Usage](/engines/structured-2d/usage/overview/).

Four properties run through every page. A game reaches the engine through the
framework object it is inside rather than through a global. Input reaches the
simulation only through a controller. Drawing happens only in the rendering
pipeline. Everything the engine observes it broadcasts as an event a caller
subscribes to.

## Pages

| Page                                                                            | Covers                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Frame](/engines/structured-2d/concepts/frame/)                                 | The loop, the fixed frame order, simulated time, the clock behind delta time, and pausing.                                     |
| [World](/engines/structured-2d/concepts/world/)                                 | What a level describes, what opening one builds, the transition sequence, and what crosses it.                                 |
| [Gameplay Framework](/engines/structured-2d/concepts/gameplay-framework/)       | The game instance, the game mode, the game state, and the player states, and what each one is scoped to.                       |
| [Actors and Components](/engines/structured-2d/concepts/actors-and-components/) | Actors as the things in a world, components as the behavior and appearance attached to them, and the deferred destroy.         |
| [Possession](/engines/structured-2d/concepts/possession/)                       | Controllers as the one path from input to the simulation, possessing a pawn, and driving the same pawn from a player or a bot. |
| [Rendering](/engines/structured-2d/concepts/rendering/)                         | The declarative pipeline, the layer ordering, the render modes, and the direct-drawing path.                                   |
| [Camera and Viewport](/engines/structured-2d/concepts/camera-and-viewport/)     | The three spaces, the camera's projection, following and bounds, and the letterboxed fit.                                      |
| [Collision](/engines/structured-2d/concepts/collision/)                         | Channels and responses, the pairs the engine reports, the manifold, and the queries.                                           |
| [Input](/engines/structured-2d/concepts/input/)                                 | Named actions over bindings, magnitudes and edges consumed per controller, the pointer, and the touch layout catalogue.        |
| [Audio](/engines/structured-2d/concepts/audio/)                                 | Synthesized and file-backed cues, the first-interaction unlock, and the cue events.                                            |
| [Assets](/engines/structured-2d/concepts/assets/)                               | The single asset root, path resolution, and the load events.                                                                   |
| [Diagnostics](/engines/structured-2d/concepts/diagnostics/)                     | The instance and world registries, the overlay drawn in device space, and the frame metrics.                                   |
| [Debug Surface](/engines/structured-2d/concepts/debug/)                         | The object `initialize` returns, whose poses and readings act on the live world and are driven from code.                      |
| [Recording](/engines/structured-2d/concepts/recording/)                         | The wrapper over the context the pipeline draws through, per-frame inherited state, and independently drawable frames.         |
