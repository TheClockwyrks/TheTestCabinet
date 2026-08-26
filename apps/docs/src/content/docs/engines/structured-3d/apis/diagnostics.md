---
title: Diagnostics
---

The debug overlay draws three things: the engine's own line for the open world,
the named values a game registers, and the engine's frame-time metrics. A game
registers its sources into one of two registries; the engine owns everything
around them.

## Registration

Both registries expose the same member.

```ts
readonly diagnostics: {
  register(name: string, source: () => unknown): void;
};
```

`source` is a zero-argument function returning the value to display. It is
invoked on each read, never sampled at registration, so it reports whatever the
game holds at that instant.

| Registry | Registered through | Lifetime |
| --- | --- | --- |
| Instance | [`InitApi.diagnostics`](/engines/structured-3d/apis/game-instance/) | The life of the engine. Its sources survive every level transition. |
| World | [`world.diagnostics`](/engines/structured-3d/apis/worlds/) | The life of the world. Its sources are dropped when the world closes. |

Re-registering a name replaces its source and retains the name's original
position in its registry.

## The registry

The engine holds both registries and drives the overlay over them.

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
| `read()` | `Record<string, unknown>` | Evaluates every source in both registries and returns the values. |
| `metrics()` | `FrameMetrics` | The frame-time metrics over the current window. |
| `draw(ctx, width, height)` | `void` | Draws the overlay onto `ctx`. Called by the engine after the pipeline renders. |

The overlay is hidden when the engine is created.

## `read`

Returns a plain object keyed by registered name, the instance registry's sources
first and then the world registry's, each in registration order. Values are
returned unformatted; the formatting below applies to the overlay alone.

A source that throws contributes its error message as a `string` value: the
`message` of a thrown `Error`, otherwise the `String` form of what was thrown.
`read` itself never throws.

`read` is independent of `enabled()`, so a hidden overlay is still readable.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in the
frame's ticks, its collision pass, its render, and the overlay itself. One
sample is recorded per frame that ran, and a build reports metrics without
registering anything.

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

Age is measured against simulated time, so the window covers 10 seconds of the
time the world was stepped by rather than 10 seconds of real time. A sample
older than the window is dropped as each new frame arrives.

## `draw`

The overlay draws onto an engine-owned 2D overlay surface composited above the
rendering canvas, because the 3D canvas yields no 2D context. `draw` receives
that overlay surface's `CanvasRenderingContext2D`, with `width` and `height`
the overlay surface's dimensions in device pixels. The overlay surface tracks
the canvas's backing-store size. With a document behind the canvas the engine
positions it over the canvas; over a supplied surface with no document it is an
offscreen canvas reached through `draw`. The engine resets the context
transform to the identity before calling `draw`, and `draw` saves and restores
the context around all of its own work, including when measuring or drawing
throws. The overlay draws on its own surface and never enters a
[recording](/engines/structured-3d/apis/recording/).

The overlay's text is a column of lines, in order:

1. The engine's own world line, reading
   `` `level: ${level}  phase: ${phase}  actors: ${count}` `` from the open
   world's level name, its match phase, and its number of live actors.
2. The instance registry's lines, in the order the game registered them.
3. The world registry's lines, in the order the game registered them.
4. A metrics line reading `` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms` ``.

The frame-time graph sits beside the text, to its right.

`draw` performs no drawing when the overlay is hidden.

### The graph

The graph plots the window's samples oldest at the left and newest at the right,
one column per sample. The vertical scale runs from `0` to the largest sample in
the window, with a floor of `33.3` milliseconds so an even run reads as flat
rather than as amplified noise.

## Overlay toggle key

The engine listens for `keydown` on the event target
[`EngineOptions.surface`](/engines/structured-3d/apis/engine/) supplies, and on
the canvas's owning document when the engine was built without a surface. It
calls `toggle()` when `KeyboardEvent.code` is `"Backquote"` and
`KeyboardEvent.repeat` is `false`. The key is engine chrome rather than a
registered [input](/engines/structured-3d/apis/input/) action.

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

`FrameMetrics` is exported as a type from `@test-cabinet/structured-3d`.
