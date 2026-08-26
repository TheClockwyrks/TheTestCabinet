---
title: Overview
---

This section is the specification of the surface Structured 3D exposes: the
types, classes, functions, and methods an implementation of the engine provides,
with their parameters, return values, defaults, and error conditions. An
implementer satisfies these pages; a game and a validator read them as
reference.

## Entry point

The package `@test-cabinet/structured-3d` has one entry point for game and
validator code, and a `./recording` subpath that serves the recording format
on its own.

| Specifier | Provides |
| --- | --- |
| `@test-cabinet/structured-3d` | `createEngine`, the framework classes, the built-in components, the clocks, the math functions, `TOUCH_LAYOUTS`, the viewport and projection functions, `RECORDING_FORMAT`, and every type a game or a validator names. |
| `@test-cabinet/structured-3d/recording` | `RECORDING_FORMAT` and the [recording](/engines/structured-3d/apis/recording/) format's types, as a leaf module loadable with no engine and no DOM. |

A game and a validator both import it. A validator constructs the engine over
the build's own game definition, installs a scripted
[clock](/engines/structured-3d/apis/clocks/), steps it with `engine.advance`,
and reads the world and the debug surface back off the engine it holds, so the
surface a validator exercises is the surface the game was written against.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/structured-3d/apis/engine/) | `createEngine`, `EngineOptions`, `SurfaceMetrics`, `RunOptions`, `FrameInfo`, the `Engine` object's lifecycle, and `EngineEvents` with its event map. |
| [Game Instance](/engines/structured-3d/apis/game-instance/) | `GameDefinition`, `GameInstance`, the `InitApi` its `initialize` receives, and the debug surface it returns. |
| [Worlds](/engines/structured-3d/apis/worlds/) | `LevelDefinition`, `ActorSpec`, `LoadApi`, the `World` object, its timers, and the transition sequence. |
| [Game Mode](/engines/structured-3d/apis/game-mode/) | `GameMode`, `GameState`, `PlayerState`, `MatchPhase`, and the player and bot calls. |
| [Actors](/engines/structured-3d/apis/actors/) | `Actor`, `Pawn`, `Transform`, the tag calls, and the deferred destroy. |
| [Components](/engines/structured-3d/apis/components/) | `Component` and the built-in render, mesh, shape, text, draw, camera, and light components. |
| [Controllers](/engines/structured-3d/apis/controllers/) | `Controller`, `PlayerController`, `AIController`, `InputReader`, and possession. |
| [Rendering](/engines/structured-3d/apis/rendering/) | `Renderer`, `RenderMode`, the collision overlay switch, and the pipeline's ordering. |
| [Collision](/engines/structured-3d/apis/collision/) | `ColliderComponent`, `CollisionResponse`, `CollisionWorld`, `Manifold`, and the queries. |
| [Camera](/engines/structured-3d/apis/camera/) | `Camera`, `CameraState`, `Viewport`, `fitViewport`, `syncCanvas`, `projectPoint`, `pointerRay`, and the three spaces. |
| [Clocks](/engines/structured-3d/apis/clocks/) | The `Clock` interface and the five clocks a run's deltas can come from. |
| [Input](/engines/structured-3d/apis/input/) | Action registration, `ActionBinding`, the read methods, the pointer, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/structured-3d/apis/audio/) | `CueSpec`, `WorldAudio`, synthesized and file-backed cues, looping, and the mute and unlock calls. |
| [Assets](/engines/structured-3d/apis/assets/) | `loadMesh`, `loadTexture`, `loadMaterial`, `loadAudio`, `load`, `resolve`, the handles, and the asset root. |
| [Diagnostics](/engines/structured-3d/apis/diagnostics/) | Source registration on the instance and the world, `FrameMetrics`, the overlay, and its toggle. |
| [Recording](/engines/structured-3d/apis/recording/) | The recorder's engine members, `Recording`, `RecordedFrame`, `RenderState`, `DrawOp`, and `DrawValue`. |
