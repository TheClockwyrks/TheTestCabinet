---
title: Overview
---

This section is the specification of the surface Simple 3D exposes: the types,
functions, and methods an implementation of the engine provides, with their
parameters, return values, defaults, and error conditions. An implementer
satisfies these pages; a game and a validator read them as reference.

## Entry point

The package `@clockwyrks/simple-3d` has one entry point.

| Specifier               | Provides                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@clockwyrks/simple-3d` | `createEngine`, `cloneModel`, the clocks, `TOUCH_LAYOUTS`, the viewport functions, and every type a game names. |

`three` is a peer dependency of the package. A build declares `three` itself
and imports it directly where it needs a three object, so the engine, the
build, and `@clockwyrks/voxel-runtime/three` share one instance. The engine
re-exports nothing from `three`.

A game and a validator both import it. A validator constructs the engine over the
game's own module, installs a scripted
[clock](/engines/simple-3d/apis/clocks/), and steps it with `engine.advance`, so
the surface a validator exercises is the surface the game was written against.

## Pages

| Page                                                | Covers                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Engine](/engines/simple-3d/apis/engine/)           | `createEngine`, `EngineOptions`, `SurfaceMetrics`, and the `Engine` object's lifecycle, state, scene, camera, and `apply`.                                                                               |
| [Game](/engines/simple-3d/apis/game/)               | `Game`, `Transition`, `DeepReadonly`, the scoped `InitApi`, `UpdateApi`, and `RenderApi`, the debug surface a game returns beside its state, `EngineEvents`, and `FrameInfo`.                            |
| [Clocks](/engines/simple-3d/apis/clocks/)           | The `Clock` interface and the five clocks a run's deltas can come from.                                                                                                                                  |
| [Viewport](/engines/simple-3d/apis/viewport/)       | `Viewport`, `fitViewport`, `applyViewport`, `syncCanvas`, the logical-to-device mapping, and the renderer's letterboxed viewport.                                                                        |
| [Rendering](/engines/simple-3d/apis/rendering/)     | The scene, the camera object, the screen layer, the renderer, shadows, and the order of one frame.                                                                                                       |
| [View](/engines/simple-3d/apis/view/)               | `View`, `CameraSnapshot`, `Ray`, `Projected`, the plain math types, the camera defaults, and the coordinate conventions.                                                                                 |
| [Input](/engines/simple-3d/apis/input/)             | Action registration, `ActionBinding`, the read methods, the pointer, and `TOUCH_LAYOUTS`.                                                                                                                |
| [Audio](/engines/simple-3d/apis/audio/)             | `CueSpec`, synthesized and file-based cues, looping, positional playback, and the mute and unlock calls.                                                                                                 |
| [Assets](/engines/simple-3d/apis/assets/)           | `loadImage`, `loadTexture`, `loadModel`, `loadAudio`, `load`, `resolve`, `cloneModel`, and the asset root.                                                                                               |
| [Diagnostics](/engines/simple-3d/apis/diagnostics/) | Source registration, the values a read returns, the frame metrics, the overlay, and its toggle.                                                                                                          |
| [Recording](/engines/simple-3d/apis/recording/)     | The recorder's engine members, `Recording` and `RecordedFrame`, the frame boundaries, how a frame is composed, the VP9 WebM encoding with its timestamps and keyframes, the frame bound, and the errors. |
