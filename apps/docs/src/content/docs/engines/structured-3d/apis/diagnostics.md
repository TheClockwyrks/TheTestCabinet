---
title: Diagnostics
---

The debug overlay draws three things: the engine's own line for the open world,
the named values a game registers, and the engine's frame metrics. A game
registers its sources into one of two registries; the engine owns everything
around them.

## Registration

Both registries expose the same member.

```ts
type DiagnosticValue = string | number | boolean;

readonly diagnostics: {
  register(name: string, source: () => DiagnosticValue): void;
};
```

`source` is a zero-argument function returning the value to display. It is
invoked on each read, never sampled at registration, so it reports whatever the
game holds at that instant.

A source reports one of the three types `DiagnosticValue` names. A framework
object such as an actor is reduced to one of the three inside the source, which
reports its position as a formatted string, its tag as a string, or its count as
a number. A source always returns a value, and where the thing it names is
absent it returns a short placeholder string in the game's own vocabulary, such
as `"none"` or `"-"`.

| Registry | Registered through                                                  | Lifetime                                                              |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Instance | [`InitApi.diagnostics`](/engines/structured-3d/apis/game-instance/) | The life of the engine. Its sources survive every level transition.   |
| World    | [`world.diagnostics`](/engines/structured-3d/apis/worlds/)          | The life of the world. Its sources are dropped when the world closes. |

Re-registering a name replaces its source and retains the name's original
position in its registry. A name registered in both registries keeps a line in
each.

## The registry

The engine holds both registries and drives the overlay over them.

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
| `read()`                   | `readonly DiagnosticReading[]` | Evaluates every source in both registries and returns what each one reports.                                                  |
| `metrics()`                | `FrameMetrics`                 | The frame-time metrics over the current window and the most recent frame's render counts.                                     |
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

Returns one reading per source, the instance registry's first and then the world
registry's, each in registration order, which is the order the panel draws them
in. Exactly one of `value` and `error` is present on each reading. Values are
returned unformatted; the formatting below applies to the overlay alone.

A source that throws yields a reading carrying `error` and no `value`: the
`message` of a thrown `Error`, otherwise the `String` form of what was thrown.
A failure is therefore distinguishable from a reading of any type, and `read`
itself always returns.

`read` evaluates the sources and changes nothing else, so the world, the frame
counter, and the overlay's visibility are the same after a read as before it.
`read` is independent of `enabled()`, so a hidden overlay is still readable.

[`engine.diagnostics()`](/engines/structured-3d/apis/engine/) is how a caller
holding the engine reaches this, and is what a case's checks read to assert the
sources a build registered.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in the
frame's ticks, its collision pass, its render, and the overlay itself. One
sample is recorded per frame that ran, and a build reports metrics without
registering anything. Beside the timings, the engine reads the renderer's
counts for the frame it most recently rendered.

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
| `triangles` | The triangles the renderer drew for the most recent frame.    |

Percentiles are nearest-rank over the window's samples sorted ascending, so
`p95Ms` is the sample at index `ceil(0.95 * samples) - 1`. An empty window
reports `0` for all three.

`drawCalls` and `triangles` are the renderer's own counts for the world pass,
read after the scene has been rendered, and they cover the frame most recently
rendered rather than the window. Before the first render both are `0`.

### The window

The window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples. A frame rate above 204 frames per second therefore
reports over the most recent 2048 frames, which keeps the window bounded at any
frame rate.

Age is measured against simulated time, so the window covers 10 seconds of the
time the world was stepped by rather than 10 seconds of real time. A sample
older than the window is dropped as each new frame arrives.

## `draw`

The overlay draws on the [screen layer](/engines/structured-3d/apis/rendering/)
in device space, after the recorder has captured the frame and before the
screen layer is composited over the 3D picture, so the overlay appears on the
canvas and outside every recording. `width` and `height` are the dimensions of
the screen layer's backing store, in device pixels, which match the stage
canvas's. The engine
resets the context transform to the identity before calling `draw`, and `draw`
saves and restores the context around all of its own work, including when
measuring or drawing throws.

The overlay's text is a column of lines, in order:

1. The engine's own world line, reading
   `` `level: ${level}  phase: ${phase}  actors: ${count}` `` from the open
   world's level name, its match phase, and its number of live actors.
2. The instance registry's lines, in the order the game registered them.
3. The world registry's lines, in the order the game registered them.
4. A metrics line reading
   `` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms · ${drawCalls} draws · ${triangles}
tris` ``.

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
from `@clockwyrks/structured-3d`.
