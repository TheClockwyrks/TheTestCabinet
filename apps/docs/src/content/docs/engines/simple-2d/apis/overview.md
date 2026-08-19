---
title: Overview
---

This section is the specification of the surface Simple 2D exposes: the types,
functions, and methods an implementation of the engine provides, with their
parameters, return values, defaults, and error conditions. An implementer
satisfies these pages; a build and a validation script read them as reference.

## Entry points

The package `@test-cabinet/simple-2d` has two entry points.

| Specifier | Provides |
| --- | --- |
| `@test-cabinet/simple-2d` | The game-facing API: `createEngine`, `TOUCH_LAYOUTS`, and every type a game names. |
| `@test-cabinet/simple-2d/host` | The host interface: `HOST_HANDLE`, `HOST_VERSION`, `installHost`, and the host types a driver calls. |

The host entry point depends only on the contract types and the schedule
validator, so it is importable for its types alone by a validation script or a
driver without pulling in the DOM-bound engine.

## Pages

| Page | Covers |
| --- | --- |
| [Engine](/engines/simple-2d/apis/engine/) | `createEngine`, `EngineOptions`, the `Engine` object, `viewport()`, and `destroy()`. |
| [Frame](/engines/simple-2d/apis/frame/) | `frame.run`, `stop`, `info`, `FrameCallbacks`, `FrameInfo`, `ClockMode`, and the schedule types. |
| [Input](/engines/simple-2d/apis/input/) | `InputRegistry`, `ActionBinding`, `RegisteredAction`, the read methods, and `TOUCH_LAYOUTS`. |
| [Audio](/engines/simple-2d/apis/audio/) | `AudioBus`, `CueSpec`, `CueEvent`, `AudioState`, and the mute and unlock calls. |
| [Assets](/engines/simple-2d/apis/assets/) | `AssetLoader`, `load`, `resolve`, and `AssetEvent`. |
| [Diagnostics](/engines/simple-2d/apis/diagnostics/) | `Diagnostics`, source registration, and the overlay toggle. |
| [Host](/engines/simple-2d/apis/host/) | `HOST_HANDLE`, `HOST_VERSION`, `EngineHost`, and each operation's arguments and rejections. |
