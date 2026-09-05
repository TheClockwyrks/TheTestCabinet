---
title: Overview
---

This section is the specification of the surface Structured 3D exposes: the
types, classes, functions, and methods an implementation of the engine provides,
with their parameters, return values, defaults, and error conditions. An
implementer satisfies these pages; a game and a validator read them as
reference.

## Entry point

The package `@clockwyrks/structured-3d` has one entry point.

| Specifier | Provides |
| --- | --- |
| `@clockwyrks/structured-3d` | `createEngine`, the framework classes, the built-in components, the clocks, `TOUCH_LAYOUTS`, the viewport functions, the math helpers and constants, and every type a game or a validator names. |

`three` is a peer dependency of the package. A build declares `three` itself,
and the engine, the build, and `@clockwyrks/voxel-runtime/three` share that
one instance. The engine re-exports nothing from `three`; a game imports it
directly where it needs a three object, such as a texture, a geometry, or an
`Object3D`.

A game and a validator both import the package. A validator constructs the
engine over the build's own game definition, installs a scripted
[clock](/engines/structured-3d/apis/clocks/), steps it with `engine.advance`,
and reads the world, the scene, and the debug surface back off the engine it
holds, so the surface a validator exercises is the surface the game was written
against.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/structured-3d/apis/engine/) | `createEngine`, `EngineOptions`, `SurfaceMetrics`, `RunOptions`, `FrameInfo`, the `Engine` object's lifecycle, and `EngineEvents` with its event map. |
| [Game Instance](/engines/structured-3d/apis/game-instance/) | `GameDefinition`, `GameInstance`, the `InitApi` its `initialize` receives, and the debug surface it returns. |
| [Worlds](/engines/structured-3d/apis/worlds/) | `LevelDefinition`, `ActorSpec`, `LoadApi`, the `World` object, its timers, `WorldAudio` with positional playback, and the transition sequence. |
| [Game Mode](/engines/structured-3d/apis/game-mode/) | `GameMode`, `GameState`, `PlayerState`, `MatchPhase`, and the player and bot calls. |
| [Actors](/engines/structured-3d/apis/actors/) | `Actor`, `Pawn`, `Transform`, the tag calls, and the deferred destroy. |
| [Components](/engines/structured-3d/apis/components/) | `Component` and the built-in render, mesh, model, light, object, sprite, shape, text, draw, and camera components. |
| [Controllers](/engines/structured-3d/apis/controllers/) | `Controller`, `PlayerController`, `AIController`, `InputReader`, and possession. |
| [Rendering](/engines/structured-3d/apis/rendering/) | `Renderer`, `RenderMode`, the collision overlay switch, shadows, the screen layer, and the pipeline's ordering. |
| [Collision](/engines/structured-3d/apis/collision/) | `ColliderComponent`, `ColliderShape`, `CollisionResponse`, `CollisionWorld`, `Manifold`, `Hit`, and the queries. |
| [Camera](/engines/structured-3d/apis/camera/) | `Camera`, `CameraSnapshot`, `Projected`, `Ray`, `Viewport`, `fitViewport`, `applyViewport`, `syncCanvas`, and the three spaces. |
| [Math](/engines/structured-3d/apis/math/) | `Vec2`, `Vec3`, `Quat`, `Mat4`, `Box3`, the constants, and the vector, quaternion, and transform helpers. |
| [Clocks](/engines/structured-3d/apis/clocks/) | The `Clock` interface and the five clocks a run's deltas can come from. |
| [Input](/engines/structured-3d/apis/input/) | Action registration, `ActionBinding`, the read methods, the pointer, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/structured-3d/apis/audio/) | `CueSpec`, `WorldAudio`, `PlayOptions`, synthesized and file-backed cues, looping, positional playback, and the mute and unlock calls. |
| [Assets](/engines/structured-3d/apis/assets/) | `loadImage`, `loadTexture`, `loadModel`, `Model`, `loadAudio`, `load`, `resolve`, and the asset root. |
| [Diagnostics](/engines/structured-3d/apis/diagnostics/) | Source registration on the instance and the world, the values a read returns, `FrameMetrics`, the overlay, and its toggle. |
| [Recording](/engines/structured-3d/apis/recording/) | The recorder's engine members, `Recording` and `RecordedFrame`, frame boundaries, what a frame holds, the VP9 WebM encoding with its timestamps and keyframes, the frame bound, and the errors. |
