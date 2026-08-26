---
title: Diagnostics
---

The debug overlay draws two things: the named values a game registers, and the
engine's own frame-time metrics. A game registers its sources once, from
[`InitApi.diagnostics`](/engines/simple-3d/apis/game/); the engine owns
everything around them.

## Registration

```ts
readonly diagnostics: {
  register(name: string, source: (state: DeepReadonly<S>) => unknown): void;
};
```

`source` is a function from the game's state to the value to display. It is
invoked on each read with the state current at that read, never sampled at
registration. The overlay reads after `render`, so the state a source receives
is the one this frame's `update` returned. `S` is the `InitApi<S>` type
parameter, the game's own state type.

```ts
const game: Game<State, null> = {
  initialize(api) {
    api.diagnostics.register("ship", (state) => state.ship.position);
    api.diagnostics.register("score", (state) => `${state.score.left}-${state.score.right}`);
    return [initialState(), null];
  },
  update: (state, api, dt) => step(state, api, dt),
  render: (state, api) => draw(state, api.scene),
};
```

Re-registering a name replaces its source and retains the name's original
position in the registry.

## The registry

The engine holds the registry and drives it.

```ts
setEnabled(enabled: boolean): void;
enabled(): boolean;
toggle(): void;
read(): Record<string, unknown>;
metrics(): FrameMetrics;
draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
```

| Member | Returns | Behavior |
| --- | --- | --- |
| `setEnabled(enabled)` | `void` | Shows the overlay when `true`, hides it when `false`. |
| `enabled()` | `boolean` | Whether the overlay is currently drawn. |
| `toggle()` | `void` | Inverts the enabled state. |
| `read()` | `Record<string, unknown>` | Evaluates every registered source and returns the values. |
| `metrics()` | `FrameMetrics` | The frame-time metrics over the current window. |
| `draw(ctx, width, height)` | `void` | Draws the overlay onto `ctx`. Called by the engine after the game's `render`. |

The overlay is hidden when the engine is created.

## `read`

Returns a plain object keyed by registered name, in registration order, whose
values are whatever the sources returned. Values are returned unformatted; the
formatting below applies to the overlay only.

A source that throws contributes its error message as a `string` value: the
`message` of a thrown `Error`, otherwise the `String` form of what was thrown.
`read` itself never throws.

`read` is independent of `enabled()`, so a hidden overlay is still readable.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in `update`,
`render`, and the overlay itself. One sample is recorded per frame that ran.

```ts
interface FrameMetrics {
  samples: number;
  meanMs: number;
  p95Ms: number;
  p99Ms: number;
}
```

| Field | Meaning |
| --- | --- |
| `samples` | How many frames the window holds. |
| `meanMs` | The arithmetic mean of the window's samples, in milliseconds. |
| `p95Ms` | The 95th percentile of the window's samples, in milliseconds. |
| `p99Ms` | The 99th percentile of the window's samples, in milliseconds. |

Percentiles are nearest-rank over the window's samples sorted ascending, so
`p95Ms` is the sample at index `ceil(0.95 * samples) - 1`. An empty window
reports `0` for all three.

### The window

The window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples. A frame rate above 204 frames per second therefore
reports over the most recent 2048 frames, which keeps the window bounded at any
frame rate.

Age is measured against the frame loop's simulated time, so the window covers 10
seconds of the time the game was stepped by rather than 10 seconds of real time.
A sample older than the window is dropped as each new frame arrives.

## `draw`

The overlay draws onto an engine-owned 2D overlay surface composited above the
rendering canvas, because the 3D canvas yields no 2D context, and `draw`
receives that overlay surface's 2D context. The overlay surface tracks the
canvas's backing-store size. With a document behind the canvas the engine
positions it over the canvas; over a supplied surface with no document it is an
offscreen canvas reached through `draw`. Everything observable about the
overlay is unchanged from the surface's placement.

`width` and `height` are the dimensions of the surface being drawn on, in device
pixels. The engine resets the context transform to the identity before calling
`draw`, and `draw` saves and restores the context around all of its own work,
including when measuring or drawing throws.

The overlay draws the registered lines first, then a metrics line reading
`` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms` ``, then the frame-time graph.
`draw` performs no drawing when the overlay is hidden.

The overlay never enters a [recording](/engines/simple-3d/apis/recording/): it
draws on its own surface, outside the frame bracket.

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

One line per source, formatted `` `${name}: ${value}` ``.

| Value | Displayed as |
| --- | --- |
| `string` | The string itself. |
| Integer `number` | `String(value)`. |
| Non-integer `number` | `value.toFixed(3)`. |
| `null`, `undefined` | `"null"`, `"undefined"`. |
| `object`, array | `JSON.stringify(value)`, falling back to `String(value)` when it throws or yields `undefined`. |
| Any other type | `String(value)`. |

## Exports

`FrameMetrics` is exported as a type from `@test-cabinet/simple-3d`.
