# Diagnostics

The debug overlay draws two things: the named values a game registers, and the
engine's own frame-time metrics. A game registers its sources once, from
`InitApi.diagnostics` inside `initialize`; the engine owns everything around
them.

```ts
api.diagnostics.register(name: string, source: () => unknown): void;
```

## Registering sources

`source` is a zero-argument function returning the value to display. It is
invoked on each read rather than sampled at registration, so it reports whatever
the game holds at that instant.

```ts
initialize(api) {
  const state: State = { x: 320, y: 180, enemies: [], score: 0 };

  api.diagnostics.register("pos", () => `${state.x.toFixed(1)}, ${state.y.toFixed(1)}`);
  api.diagnostics.register("enemies", () => state.enemies.length);
  api.diagnostics.register("score", () => state.score);

  return [state, null];
}
```

Register the few values that explain what the simulation is doing. Re-registering
a name replaces its source and keeps the name's original position.

A source that throws contributes its error message as a string value rather than
failing the read, so one careless source costs nothing but its own line.

## The overlay

The overlay is hidden when the engine is created. The backtick key
(`Backquote`) toggles it, handled by a listener the engine owns rather than by a
registered input action.

It draws one line per source, formatted `` `${name}: ${value}` ``, then a
metrics line, then the frame-time graph. It is drawn after the game's `render`,
with the context transform reset to the identity, so debug text stays the same
physical size however far the game's own coordinates are being scaled.

| Value | Displayed as |
| --- | --- |
| `string` | The string itself. |
| Integer `number` | `String(value)`. |
| Non-integer `number` | `value.toFixed(3)`. |
| `null`, `undefined` | `"null"`, `"undefined"`. |
| `object`, array | `JSON.stringify(value)`, falling back to `String(value)`. |
| Any other type | `String(value)`. |

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

The metrics line reads `` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms` ``.
Percentiles are nearest-rank over the window's samples sorted ascending. An
empty window reports `0` for all three.

The window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples, so a run of any length at any frame rate holds the
same number of bytes. Age is measured against the frame loop's simulated time,
so the window covers 10 seconds of the time the game was stepped by rather than
10 seconds of real time.

The graph plots the window's samples oldest at the left and newest at the right,
one column per sample. The vertical scale runs from `0` to the largest sample in
the window, with a floor of `33.3` milliseconds so an even run reads as flat.
