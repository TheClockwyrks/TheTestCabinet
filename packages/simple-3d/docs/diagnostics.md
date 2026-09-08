# Diagnostics

The debug overlay draws two things: the named values a game registers, and the
engine's own frame metrics. A game registers its sources once, from
`InitApi.diagnostics` inside `initialize`; the engine owns everything around
them.

```ts
type DiagnosticValue = string | number | boolean;

api.diagnostics.register(
  name: string,
  source: (state: DeepReadonly<S>) => DiagnosticValue,
): void;
```

## Registering sources

`source` is handed the state and returns the value to display. It is invoked on
each read, with the state current at that read, so it reports what the engine
holds at that instant. The overlay is drawn after `render`, so that is the state
this frame's `update` returned.

A source reports one of three types: a `string` where the presentation matters,
a `number` where the magnitude is the point, and a `boolean` for a flag. A value
the game holds in some other shape is reduced to one of the three inside the
source, so a world position is reported as a formatted string and a population
as its count.

```ts
initialize(api) {
  api.diagnostics.register(
    "hook",
    (s) => `${s.hook.x.toFixed(1)}, ${s.hook.y.toFixed(1)}, ${s.hook.z.toFixed(1)}`,
  );
  api.diagnostics.register("crates", (s) => s.crates.length);
  api.diagnostics.register("distance", (s) => s.orbit.distance);
  api.diagnostics.register("landed", (s) => s.landed);

  return [openingState(), null];
}
```

Read the state the source is handed rather than the value `initialize` built.
Each frame replaces the state, so a source that closed over the opening object
would report the opening state forever.

A source always returns a value. Where the thing it names is absent, it returns
a short placeholder string in the game's own vocabulary, such as `"-"` or
`"none"`, so the name keeps its line and the reader sees a word the game chose.

Register the few values that explain what the simulation is doing.
Re-registering a name replaces its source and keeps the name's original
position.

The camera's pose is worth reporting from the state's own orbit rather than from
`view().camera()`, because the state is what a check poses and what `update`
reads.

## Reading the values back

```ts
interface DiagnosticReading {
  readonly name: string;
  readonly value?: DiagnosticValue;
  readonly error?: string;
}

engine.diagnostics(): readonly DiagnosticReading[];
```

`engine.diagnostics()` evaluates every registered source against the current
state and returns one reading per source, in registration order, which is the
order the panel draws them in. Exactly one of `value` and `error` is present on
each reading.

Reading is pure. It evaluates the sources and changes nothing else: the state,
the frame counter, and the overlay's visibility are the same after a read as
before it, so a hidden overlay reads exactly as a visible one does.

A source that throws yields a reading carrying `error` and no `value`. The
message is the `message` of a thrown `Error`, and the `String` form of anything
else thrown. A failure therefore stays distinguishable from a reading of any
type, and `engine.diagnostics()` itself always returns.

Registering the values a case names is the game's part, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed state. Drawing the panel and toggling it belong to the
engine.

## The overlay

The overlay is hidden when the engine is created. The backtick key
(`Backquote`) toggles it, handled by a listener the engine owns rather than by a
registered input action.

It draws on the **screen layer**, in device pixels, after the recorder has
captured the frame and before the layer is composited over the 3D picture. Two
consequences: the overlay sits on top of the scene and of everything the game
drew on the layer that frame, and it is outside every recording, so debug chrome
never appears in the video a reviewer watches.

The engine resets the context transform to the identity before drawing, so debug
text stays the same physical size however far the game's own coordinates are
being scaled. The panel draws one line per source, formatted
`` `${name}: ${value}` ``, then a metrics line, then the frame-time graph.

| Reading                    | Drawn as                                   |
| -------------------------- | ------------------------------------------ |
| `string` value             | The string itself.                         |
| Integer `number` value     | `String(value)`.                           |
| Non-integer `number` value | `value.toFixed(3)`.                        |
| `boolean` value            | `"true"` or `"false"`.                     |
| A source that threw        | The `error` message, in the value's place. |

A number that is not finite draws as `NaN`, `Infinity`, or `-Infinity`.

## Frame metrics

The engine times each frame it runs, measuring the wall time spent in `update`,
`render`, its own render of the scene, and the overlay itself. One sample is
recorded per frame that ran. Beside the timings, it reads the most recent
frame's draw calls and triangles off the renderer.

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

The metrics line reads
`` `frame: ${meanMs} / ${p95Ms} / ${p99Ms} ms · ${drawCalls} draws · ${triangles} tris` ``.
Percentiles are nearest-rank over the window's samples sorted ascending. An
empty window reports `0` for all three.

`drawCalls` and `triangles` describe one frame rather than the window, because a
draw-call total averaged over ten seconds answers no question a reader of a 3D
overlay is asking. Both are `0` before the first render. They are the figure to
watch while deciding whether a hundred crates want one shared geometry and one
shared material.

The timing window is the last 10 seconds of frames, held in a ring buffer whose
capacity is 2048 samples, so a run of any length at any frame rate holds the
same number of bytes. Age is measured against the frame loop's simulated time,
so the window covers 10 seconds of the time the game was stepped by rather than
10 seconds of real time.

The graph plots the window's samples oldest at the left and newest at the right,
one column per sample. The vertical scale runs from `0` to the largest sample in
the window, with a floor of `33.3` milliseconds so an even run reads as flat.
