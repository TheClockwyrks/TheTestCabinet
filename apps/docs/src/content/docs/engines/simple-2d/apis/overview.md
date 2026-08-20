---
title: Overview
---

This section is the specification of the surface Simple 2D exposes: the types,
functions, and methods an implementation of the engine provides, with their
parameters, return values, defaults, and error conditions. An implementer
satisfies these pages; a game and a validator read them as reference.

## Entry points

The package `@test-cabinet/simple-2d` has two entry points.

| Specifier | Provides |
| --- | --- |
| `@test-cabinet/simple-2d` | `createEngine`, the clocks, `TOUCH_LAYOUTS`, the viewport functions, and every type a game names. |
| `@test-cabinet/simple-2d/host` | The host interface: `HOST_HANDLE`, `HOST_VERSION`, `installHost`, and the types the published handle exposes. |

A game and a validator both import the root entry point. A validator constructs
the engine over the game's own module, installs a scripted
[clock](/engines/simple-2d/apis/clocks/), and steps it with `engine.advance`, so
the surface a validator exercises is the surface the game was written against.

The host entry point depends on the contract types alone, so a build check may
import it for its constants and types without pulling in the engine.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/simple-2d/apis/engine/) | `createEngine`, `EngineOptions`, `SurfaceMetrics`, and the `Engine` object's lifecycle. |
| [Game](/engines/simple-2d/apis/game/) | `Game`, the scoped `InitApi`, `UpdateApi`, and `RenderApi`, `EngineEvents`, and `FrameInfo`. |
| [Clocks](/engines/simple-2d/apis/clocks/) | The `Clock` interface and the five clocks a run's deltas can come from. |
| [Viewport](/engines/simple-2d/apis/viewport/) | `Viewport`, `fitViewport`, `applyViewport`, `syncCanvas`, and the logical-to-device mapping. |
| [Input](/engines/simple-2d/apis/input/) | Action registration, `ActionBinding`, the read methods, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/simple-2d/apis/audio/) | `CueSpec`, synthesized and file-based cues, and the mute and unlock calls. |
| [Assets](/engines/simple-2d/apis/assets/) | `loadImage`, `loadAudio`, `load`, `resolve`, and the asset root. |
| [Diagnostics](/engines/simple-2d/apis/diagnostics/) | Source registration, the overlay, and its toggle. |
| [Host](/engines/simple-2d/apis/host/) | `HOST_HANDLE`, `HOST_VERSION`, and the operations the published handle carries. |
