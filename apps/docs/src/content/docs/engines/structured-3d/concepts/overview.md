---
title: Overview
---

This section describes the engine's internals: the model each subsystem imposes
on a game, how that subsystem behaves, and why it is shaped that way. It states
the model and the guarantees; the exact surface is at
[APIs](/engines/structured-3d/apis/overview/) and the idioms are at
[Usage](/engines/structured-3d/usage/overview/).

Four properties run through every page. A game reaches the engine through the
framework object it is inside rather than through a global. Input reaches the
simulation only through a controller. Drawing happens only in the rendering
pipeline. Everything the engine observes it broadcasts as an event a caller
subscribes to.

## Pages

| Page | Covers |
| --- | --- |
| [Frame](/engines/structured-3d/concepts/frame/) | The loop, the fixed frame order, the pipeline's place in it, simulated time, the clock behind delta time, and pausing. |
| [World](/engines/structured-3d/concepts/world/) | What a level describes, what opening one builds, the transition sequence, and what crosses it. |
| [Gameplay Framework](/engines/structured-3d/concepts/gameplay-framework/) | The game instance, the game mode, the game state, and the player states, and what each one is scoped to. |
| [Actors and Components](/engines/structured-3d/concepts/actors-and-components/) | Actors as the things in a world, the transform with its quaternion rotation, components as the behavior and appearance attached to an actor, the offset composition, and the deferred destroy. |
| [Possession](/engines/structured-3d/concepts/possession/) | Controllers as the one path from input to the simulation, possessing a pawn, and driving the same pawn from a player or a bot. |
| [Rendering](/engines/structured-3d/concepts/rendering/) | The declarative pipeline, the world pass through the camera and the screen pass over it, the layer ordering, the render modes, and the direct-drawing paths. |
| [Camera and Viewport](/engines/structured-3d/concepts/camera-and-viewport/) | The three spaces, the camera's projection, following a view target and bounds, picking along a ray, and the letterboxed fit. |
| [Collision](/engines/structured-3d/concepts/collision/) | Channels and responses, the volumetric shapes, the pairs the engine reports, the manifold, and the queries. |
| [Input](/engines/structured-3d/concepts/input/) | Named actions over bindings, magnitudes and edges consumed per controller, the pointer, and the touch layout catalogue with its sticks. |
| [Audio](/engines/structured-3d/concepts/audio/) | Synthesized and file-backed cues, positional playback heard from the camera, the first-interaction unlock, and the cue events. |
| [Assets](/engines/structured-3d/concepts/assets/) | The single asset root, path resolution, the texture and model loaders, and the load events. |
| [Diagnostics](/engines/structured-3d/concepts/diagnostics/) | The instance and world registries, the overlay drawn on the screen layer in device space, and the frame metrics with the renderer's counts. |
| [Debug Surface](/engines/structured-3d/concepts/debug/) | The object `initialize` returns, whose poses and readings act on the live world and are driven from code. |
| [Recording](/engines/structured-3d/concepts/recording/) | The scene as submitted, referenced assets and embedded content, the archive and its buffers, the projection the scene half is, budgets and coverage gaps, the wrapper over the screen layer's context, per-frame inherited state, and independently drawable frames. |
