---
title: Overview
---

This section is the specification of the surface Simple 3D exposes: the types,
functions, and methods an implementation of the engine provides, with their
parameters, return values, defaults, and error conditions. An implementer
satisfies these pages; a game and a validator read them as reference.

## Entry point

The package `@test-cabinet/simple-3d` has one entry point.

| Specifier | Provides |
| --- | --- |
| `@test-cabinet/simple-3d` | `createEngine`, the clocks, `TOUCH_LAYOUTS`, the viewport functions, the math functions, `projectPoint` and `pointerRay`, `RECORDING_FORMAT`, and every type a game names. |

A game and a validator both import it. A validator constructs the engine over the
game's own module, installs a scripted
[clock](/engines/simple-3d/apis/clocks/), and steps it with `engine.advance`, so
the surface a validator exercises is the surface the game was written against.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/simple-3d/apis/engine/) | `createEngine`, `EngineOptions`, `SurfaceMetrics`, and the `Engine` object's lifecycle, state, and `apply`. |
| [Game](/engines/simple-3d/apis/game/) | `Game`, `Transition`, `DeepReadonly`, the scoped `InitApi`, `UpdateApi`, and `RenderApi`, the `SceneContext` a game draws through, the debug surface, `EngineEvents`, and `FrameInfo`. |
| [Clocks](/engines/simple-3d/apis/clocks/) | The `Clock` interface and the five clocks a run's deltas can come from. |
| [Viewport](/engines/simple-3d/apis/viewport/) | The 3D math types, `Viewport`, `fitViewport`, `syncCanvas`, `CameraState`, `projectPoint`, `pointerRay`, and the world-to-logical-to-device mapping. |
| [Input](/engines/simple-3d/apis/input/) | Action registration, `ActionBinding`, the read methods, the pointer, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/simple-3d/apis/audio/) | `CueSpec`, synthesized and file-based cues, looping, and the mute and unlock calls. |
| [Assets](/engines/simple-3d/apis/assets/) | `loadMesh`, `loadTexture`, `loadMaterial`, `loadAudio`, `load`, `resolve`, the handles, and the asset root. |
| [Diagnostics](/engines/simple-3d/apis/diagnostics/) | Source registration, the overlay, and its toggle. |
| [Recording](/engines/simple-3d/apis/recording/) | The recorder's engine members, `Recording`, `RecordedFrame`, `RenderState`, `DrawOp`, and `DrawValue`. |
