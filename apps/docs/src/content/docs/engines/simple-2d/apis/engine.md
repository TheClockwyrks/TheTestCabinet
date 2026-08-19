---
title: Engine
---

The package's root entry point exposes one function. It builds an engine over a
canvas, wires the subsystems together, and installs the host interface.

```ts
function createEngine(options: EngineOptions): Engine;
```

## `EngineOptions`

```ts
interface EngineOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  background?: string;
  layout?: string;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | The canvas the engine sizes, clears, and renders through. |
| `width` | `number` | The logical design width the game draws in. |
| `height` | `number` | The logical design height the game draws in. |
| `background` | `string` | A CSS colour filled over the whole canvas before every frame. Omitted, the frame is cleared to transparency and the page shows through. |
| `layout` | `string` | A touch layout name from the catalogue, selected as `engine.input.useLayout(name)` would select it. |

The engine listens on, and installs its host interface on, the canvas's own
document and window.

## Errors

`createEngine` throws when either condition holds.

| Condition | Message |
| --- | --- |
| `width` or `height` is not a finite number greater than zero | `createEngine needs a positive logical design size, got <width>x<height>` |
| The canvas returns no `2d` context | `createEngine could not get a 2D context from the canvas; the engine renders through it` |

An unknown `layout` name is rejected by the input registry, whose contract is at
[Input](/engines/simple-2d/apis/input/).

## `Engine`

```ts
interface Engine {
  readonly frame: {
    run(cb: FrameCallbacks): void;
    stop(): void;
    info(): FrameInfo;
  };
  readonly input: InputRegistry;
  readonly audio: AudioBus;
  readonly assets: AssetLoader;
  readonly diagnostics: Diagnostics;
  readonly viewport: () => Viewport;
  destroy(): void;
}
```

| Member | Type | Meaning |
| --- | --- | --- |
| `frame.run` | `(cb: FrameCallbacks) => void` | Start driving `cb`. Calling it again swaps the callbacks in place. |
| `frame.stop` | `() => void` | Stop the loop, dropping any frame already scheduled. |
| `frame.info` | `() => FrameInfo` | The frame counter, simulated time, and the most recent step. |
| `input` | `InputRegistry` | Named actions over their keyboard bindings and touch layouts, read once per frame. |
| `audio` | `AudioBus` | Named cues, the mute control, the unlock, and the log of every cue played. |
| `assets` | `AssetLoader` | Path resolution under the fixed asset root, loading, and the log of every request. |
| `diagnostics` | `Diagnostics` | The named debug sources a game registers and the overlay they are drawn in. |
| `viewport` | `() => Viewport` | The current logical-to-device fit, as a snapshot. |
| `destroy` | `() => void` | Tear the engine down. |

`FrameCallbacks` and `FrameInfo` are specified at
[Frame](/engines/simple-2d/apis/frame/).

## `engine.viewport()`

```ts
function viewport(): Viewport;
```

Returns the current logical-to-device fit as a fresh snapshot the caller owns.
Mutating the returned object has no effect on the engine, and the object does
not track later frames.

```ts
interface Viewport {
  readonly width: number;
  readonly height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

| Field | Units | Meaning |
| --- | --- | --- |
| `width` | logical pixels | The logical design width; a game draws in `0..width`. |
| `height` | logical pixels | The logical design height; a game draws in `0..height`. |
| `scale` | device pixels per logical unit | The uniform fit ratio with the device pixel ratio folded in. |
| `offsetX` | device pixels | The left letterbox bar. |
| `offsetY` | device pixels | The top letterbox bar. |

A canvas element with no laid-out size yields `scale: 0`.

## `engine.destroy()`

```ts
function destroy(): void;
```

Tears the engine down: stops the frame loop, detaches the input registry's
listeners, removes the overlay toggle listener and the audio unlock listeners,
and deletes the host interface from the window it was installed on. Idempotent:
every call after the first returns without effect.

## Exports

`createEngine` is exported from `@test-cabinet/simple-2d`, as are the types
`EngineOptions`, `Engine`, and `Viewport`.
