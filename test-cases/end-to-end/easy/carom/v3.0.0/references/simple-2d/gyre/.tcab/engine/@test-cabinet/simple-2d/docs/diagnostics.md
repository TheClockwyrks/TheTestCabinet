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

  return state;
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

## The host interface

The engine publishes a read-mostly view of itself on the game's own window,
under `__tcabEngine`, from the moment it is constructed. It lets a post-run
check confirm that a built page booted and is running frames, and it lets a
person inspect a running build from a devtools console.

```ts
interface EngineHost {
  version: number;
  frame(): FrameInfo;
  diagnostics(): Record<string, unknown>;
  setOverlay(enabled: boolean): void;
}
```

| Member | Result |
| --- | --- |
| `version` | The interface version at the time the page was built. Currently `2`. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `diagnostics` | The build's registered sources, evaluated at the moment of the call, whether or not the overlay is visible. |
| `setOverlay` | Shows or hides the overlay without touching the toggle key. |

```js
__tcabEngine.frame();        // { count: 812, timeMs: 13533, lastDeltaMs: 16.7 }
__tcabEngine.diagnostics();  // { pos: "320.0, 180.0", enemies: 4, score: 120 }
__tcabEngine.setOverlay(true);
```

A handle that is present and a counter that has advanced between two reads is a
page that booted, wired its canvas, resolved initialization, and reached the
frame loop. A build needs no code for any of this: the engine installs the
handle itself.

Values cross into a page evaluation as plain data, so `diagnostics` reduces each
source's value through a JSON round trip. A plain value crosses unchanged, one
that cannot be encoded degrades to its string form, and one with no JSON
representation reads as `null`.

The handle and its types are also importable from
`@test-cabinet/simple-2d/host`, a module that depends only on the shared
contract types.

```ts
import { HOST_HANDLE, HOST_VERSION } from "@test-cabinet/simple-2d/host";
import type { EngineHost } from "@test-cabinet/simple-2d/host";
```

`engine.destroy()` removes the handle, but only while the installed host is
still the one that engine published.
