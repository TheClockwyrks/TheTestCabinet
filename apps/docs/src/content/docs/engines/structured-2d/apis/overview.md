---
title: Overview
---

This section is the specification of the surface Structured 2D exposes: the
types, classes, functions, and methods an implementation of the engine provides,
with their parameters, return values, defaults, and error conditions. An
implementer satisfies these pages; a game and a validator read them as
reference.

## Entry points

The package `@test-cabinet/structured-2d` has two entry points.

| Specifier | Provides |
| --- | --- |
| `@test-cabinet/structured-2d` | `createEngine`, the framework classes, the built-in components, the clocks, `TOUCH_LAYOUTS`, the viewport functions, and every type a game names. |
| `@test-cabinet/structured-2d/host` | `HOST_HANDLE`, `HOST_VERSION`, `installHost`, and the types the published handle exposes. |

A game and a validator both import the root entry point. A validator constructs
the engine over the build's own game definition, installs a scripted
[clock](/engines/structured-2d/apis/clocks/), and steps it with
`engine.advance`, so the surface a validator exercises is the surface the game
was written against.

The host entry point depends on the contract types alone, so a build check
imports it for its constants and types without pulling in the engine.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/structured-2d/apis/engine/) | `createEngine`, `EngineOptions`, `SurfaceMetrics`, `RunOptions`, `FrameInfo`, the `Engine` object's lifecycle, and `EngineEvents` with its event map. |
| [Game Instance](/engines/structured-2d/apis/game-instance/) | `GameDefinition`, `GameInstance`, and the `InitApi` its `initialize` receives. |
| [Worlds](/engines/structured-2d/apis/worlds/) | `LevelDefinition`, `ActorSpec`, `LoadApi`, the `World` object, its timers, and the transition sequence. |
| [Game Mode](/engines/structured-2d/apis/game-mode/) | `GameMode`, `GameState`, `PlayerState`, `MatchPhase`, and the player and bot calls. |
| [Actors](/engines/structured-2d/apis/actors/) | `Actor`, `Pawn`, `Transform`, the tag calls, and the deferred destroy. |
| [Components](/engines/structured-2d/apis/components/) | `Component` and the built-in render, sprite, shape, text, draw, and camera components. |
| [Controllers](/engines/structured-2d/apis/controllers/) | `Controller`, `PlayerController`, `AIController`, `InputReader`, and possession. |
| [Rendering](/engines/structured-2d/apis/rendering/) | `Renderer`, `RenderMode`, the collision overlay switch, and the pipeline's ordering. |
| [Collision](/engines/structured-2d/apis/collision/) | `ColliderComponent`, `CollisionResponse`, `CollisionWorld`, `Manifold`, and the queries. |
| [Camera](/engines/structured-2d/apis/camera/) | `Camera`, `CameraSnapshot`, `Viewport`, `fitViewport`, `applyViewport`, `syncCanvas`, and the three spaces. |
| [Clocks](/engines/structured-2d/apis/clocks/) | The `Clock` interface and the five clocks a run's deltas can come from. |
| [Input](/engines/structured-2d/apis/input/) | Action registration, `ActionBinding`, the read methods, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/structured-2d/apis/audio/) | `CueSpec`, `WorldAudio`, synthesized and file-backed cues, and the mute and unlock calls. |
| [Assets](/engines/structured-2d/apis/assets/) | `loadImage`, `loadAudio`, `load`, `resolve`, and the asset root. |
| [Diagnostics](/engines/structured-2d/apis/diagnostics/) | Source registration on the instance and the world, `FrameMetrics`, the overlay, and its toggle. |
| [Host](/engines/structured-2d/apis/host/) | `HOST_HANDLE`, `HOST_VERSION`, `installHost`, and the operations the published handle carries. |
