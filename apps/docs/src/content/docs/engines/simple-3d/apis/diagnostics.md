---
title: Diagnostics
---

The debug overlay draws two things: the named values a game registers, and the
engine's own frame metrics. A game registers its sources once, from
[`InitApi.diagnostics`](/engines/simple-3d/apis/game/); the engine owns
everything around them.

## Registration

```ts
type DiagnosticValue = string | number | boolean;

readonly diagnostics: {
  register(
    name: string,
    source: (state: DeepReadonly<S>) => DiagnosticValue,
  ): void;
};
```

`source` is a function from the game's state to the value to display. It is
invoked on each read with the state current at that read, never sampled at
registration. The overlay reads after `render`, so the state a source receives
is the one this frame's `update` returned. `S` is the `InitApi<S>` type
parameter, the game's own state type.

A source reports one of the three types `DiagnosticValue` names. A value the
game holds in some other shape is reduced to one of the three inside the source.

```ts
const game: Game<State, null> = {
  initialize(api) {
    api.diagnostics.register(
      "ship",
      (state) => `${state.ship.x}, ${state.ship.y}, ${state.ship.z}`,
    );
    api.diagnostics.register("score", (state) => state.score);
    api.diagnostics.register("landed", (state) => state.landed);
    return [initialState(), null];
  },
  update: (state, api, dt) => step(state, api, dt),
  render: (state, api) => draw(state, api.scene, api.camera, api.screen),
};
```

A source always returns a value. Where the thing it names is absent, it returns
a short placeholder string in the game's own vocabulary, such as `"-"` or
`"none"`.

Re-registering a name replaces its source and retains the name's original
position in the registry.

## The registry

The engine holds the registry and drives it.

```ts
setEnabled(enabled: boolean): void;
enabled(): boolean;
toggle(): void;
read(): readonly DiagnosticReading[];
metrics(): FrameMetrics;
draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
```

| Member                     | Returns                        | Behavior                                                                                                                      |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `setEnabled(enabled)`      | `void`                         | Shows the overlay when `true`, hides it when `false`.                                                                         |
| `enabled()`                | `boolean`                      | Whether the overlay is currently drawn.                                                                                       |
| `toggle()`                 | `void`                         | Inverts the enabled state.                                                                                                    |
| `read()`                   | `readonly DiagnosticReading[]` | Evaluates every registered source and returns what each one reports.                                                          |
| `metrics()`                | `FrameMetrics`                 | The frame metrics over the current window.                                                                                    |
| `draw(ctx, width, height)` | `void`                         | Draws the overlay onto `ctx`. Called by the engine with the screen layer's context after the recorder has captured the frame. |

The overlay is hidden when the engine is created.

## `read`

```ts
interface DiagnosticReading {
  readonly name: string;
  readonly value?: DiagnosticValue;
  readonly error?: string;
}
```

Returns one reading per registered source, in registration order, which is the
order the panel draws them in. Exactly one of `value` and `error` is present on
each reading. Values are returned unformatted; the formatting below applies to
the overlay alone.

A source that throws yields a reading carrying `error` and no `value`: the
`message` of a thrown `Error`, otherwise the `String` form of what was thrown.
A failure is therefore distinguishable from a reading of any type, and `read`
itself always returns.

`read` evaluates the sources and changes nothing else, so the state, the frame
counter, and the overlay's visibility are the same after a read as before it.
`read` is independent of `enabled()`, so a hidden overlay is still readable.

[`engine.diagnostics()`](/engines/simple-3d/apis/engine/) is how a caller
holding the engine reaches this, and is what a case's checks read to assert the
sources a build registered.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in `update`,
`render`, the engine's own render of the scene, and the overlay itself. One
sample is recorded per frame that ran. Beside the timings, the engine reads the
most recent frame's draw calls and triangles from the renderer.

```ts
interface FrameMetrics {
  samples: number;
  meanMs: number;
  p95Ms: number;
  p99Ms: number;
  drawCalls: number;
  triangles: number;
}
```

| Field       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `samples`   | How many frames the window holds.                             |
| `meanMs`    | The arithmetic mean of the window's samples, in milliseconds. |
| `p95Ms`     | The 95th percentile of the window's samples, in milliseconds. |
| `p99Ms`     | The 99th percentile of the window's samples, in milliseconds. |
| `drawCalls` | The draw calls the renderer issued for the most recent frame. |
| `triangles` | The triangles the renderer drew in the most recent frame.     |

Percentiles are nearest-rank over the window's samples sorted ascending, so
`p95Ms` is the sample at index `ceil(0.95 * samples) - 1`. An empty window
reports `0` for all three.

`drawCalls` and `triangles` describe one frame rather than the window: they are
the renderer's counts for the frame most recently rendered, and are `0` before
the first render.

### The window

The window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples. A frame rate above 204 frames per second therefore
reports over the most recent 2048 frames, which keeps the window bounded at any
frame rate.

Age is measured against the frame loop's simulated time, so the window covers 10
seconds of the time the game was stepped by rather than 10 seconds of real time.
A sample older than the window is dropped as each new frame arrives.

## `draw`

The overlay draws on the [screen layer](/engines/simple-3d/apis/rendering/),
in device space, over everything the game drew there that frame. `ctx` is the
screen layer's context, and `width` and `height` are the dimensions of the
screen canvas's backing store, in device pixels. The engine resets the context
transform to the identity before calling `draw`, and `draw` saves and restores
the context around all of its own work, including when measuring or drawing
throws.

The engine calls `draw` after the [recorder](/engines/simple-3d/apis/recording/)
has captured the frame, so the overlay is outside every recording, and before
the screen layer is composited over the 3D picture, so the overlay is on top of
the scene.

The overlay draws the registered lines first, then a metrics line reading
`` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms · ${drawCalls} draws · ${triangles} tris` ``,
then the frame-time graph. `draw` performs no drawing when the overlay is
hidden.

### The graph

The graph plots the window's samples oldest at the left and newest at the right,
one column per sample. The vertical scale runs from `0` to the largest sample in
the window, with a floor of `33.3` milliseconds so an even run reads as flat
rather than as amplified noise.

## Overlay toggle key

The engine listens for `keydown` on the event target
[`EngineOptions.surface`](/engines/simple-3d/apis/engine/) supplies, and on the
canvas's owning document when the engine was built without a surface. It calls
`toggle()` when `KeyboardEvent.code` is `"Backquote"` and `KeyboardEvent.repeat`
is `false`. The key is engine chrome rather than a registered
[input](/engines/simple-3d/apis/input/) action.

## Display formatting

One line per reading, formatted `` `${name}: ${value}` ``.

| Reading                    | Displayed as                               |
| -------------------------- | ------------------------------------------ |
| `string` value             | The string itself.                         |
| Integer `number` value     | `String(value)`.                           |
| Non-integer `number` value | `value.toFixed(3)`.                        |
| `boolean` value            | `"true"` or `"false"`.                     |
| A source that threw        | The `error` message, in the value's place. |

A number that is not finite displays as `NaN`, `Infinity`, or `-Infinity`.

## Exports

`DiagnosticValue`, `DiagnosticReading`, and `FrameMetrics` are exported as types
from `@clockwyrks/simple-3d`.
