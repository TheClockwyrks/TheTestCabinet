---
title: Engine
---

`createEngine` is the only function the root entry point exposes. It builds the
engine over a canvas and wires the subsystems together. The game is bound here,
so an engine drives exactly one game for its lifetime.

## `createEngine`

```ts
function createEngine<S>(options: EngineOptions<S>): Engine<S>;
```

Construction performs no loading and runs no game code. An engine therefore
exists in a state where its clock can be replaced and its
[events](/engines/simple-2d/apis/game/) can be subscribed to before anything the
game does is observable, which is what lets a caller watch the game's own
initialization.

## `EngineOptions`

```ts
interface EngineOptions<S> {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  game: Game<S>;
  background?: string;
  layout?: string;
  clock?: Clock;
  surface?: SurfaceMetrics;
  assetRoot?: string;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The canvas the engine sizes, clears, and renders through. |
| `width` | — | The logical design width the game draws in. Finite and positive. |
| `height` | — | The logical design height the game draws in. Finite and positive. |
| `game` | — | The [game](/engines/simple-2d/apis/game/) this engine drives. |
| `background` | — | A CSS color cleared to before every frame. Absent, the frame is cleared to transparency. |
| `layout` | — | A touch layout from the [catalogue](/engines/simple-2d/apis/input/), whose vocabulary the game then registers. |
| `clock` | `new WallClock()` | The [clock](/engines/simple-2d/apis/clocks/) supplying each frame's delta. |
| `surface` | Read from the canvas | Where the engine reads its element size and device pixel ratio. |
| `assetRoot` | `"assets/"` | The root every [asset path](/engines/simple-2d/apis/assets/) resolves under. |

## `SurfaceMetrics`

```ts
interface SurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
}
```

The engine reads the canvas's laid-out size and device pixel ratio through this
seam every frame, and attaches its key listeners to the event target it returns.
Supplied, it replaces every measurement the engine would otherwise take from the
DOM, which is what lets the engine run over a canvas with no document behind it.

Absent, the engine reads `clientWidth`, `clientHeight`, and the owning window's
`devicePixelRatio`, and listens on the canvas's owning document.

## `Engine`

```ts
interface Engine<S> {
  readonly events: EngineEvents;
  readonly state: S;
  initialize(): Promise<S>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  destroy(): void;
}

interface RunOptions {
  signal?: AbortSignal;
}
```

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine [events](/engines/simple-2d/apis/game/). Available from construction. |
| `state` | The value `initialize` resolved to, live. |
| `initialize` | Run the game's `initialize` and resolve to the state it produced. |
| `run` | Drive the game off the host's frame callback until the supplied signal aborts. |
| `advance` | Run exactly `frames` frames and resolve. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `destroy` | Halt the loop, drop every listener, and unpublish the host interface. |

### `initialize`

`initialize` runs the game's own `initialize` and awaits its result, then holds
the state it produced. It resolves to that state, so a caller receives a value
that is complete rather than one it has to test before using.

Calling it a second time resolves to the state already built, so a caller that
cannot easily tell whether initialization has happened may ask again.

The engine runs no frame before this resolves. `update` and `render` therefore
never observe a partially built state, which is what allows the game's state
type to declare every field as present.

### `state`

The state is the game's own, and the reference is live rather than a copy, so a
reader observes the current frame's values. A caller that needs a value to
survive later frames copies what it read.

Reading it before `initialize` resolves throws, naming the ordering. That keeps
a contract violation loud at the point of the mistake.

### `run`

`run` drives frames off the host's frame callback, and the returned promise
resolves once the loop halts. A loop halts when the supplied signal aborts or
when the engine is destroyed.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

A signal is how one teardown path halts the loop alongside everything else it
already cancels. A game that ends itself creates a controller in its own
`initialize`, stores it in the state, and aborts it from `update`, so ending the
game needs nothing from the engine beyond what the game already holds.

Omitting the signal runs until the engine is destroyed. Calling `run` while the
loop is already running resolves against the same halt rather than starting a
second loop.

### `advance`

`advance` runs exactly `frames` frames and resolves. Frames run back to back
with no host frame callback between them, so the elapsed real time has no effect
on the result and there is nothing to wait for or poll.

`frames` must be a whole, non-negative number. `advance(0)` runs nothing.

A [clock](/engines/simple-2d/apis/clocks/) that reads `nowMs` reports near-zero
deltas here, because no real time passes between frames. Pair `advance` with a
clock that supplies its own deltas.

### `setClock`

The clock is replaced in place, and the frame counter and accumulated time carry
over. A clock installed mid-run takes effect on the next frame.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| A canvas that yields no 2D context | `Error` |
| A `layout` outside the catalogue | `Error` naming every valid layout |
| The game's `initialize` throws or rejects | `initialize` rejects with the cause |
| `state`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |

Each construction failure otherwise presents as a build that runs and draws
nothing, which is the most expensive kind to trace, so each is refused where it
happens.

## `engine.viewport()`

Returns a [`Viewport`](/engines/simple-2d/apis/viewport/) snapshot: the logical
design size, the device pixels per logical unit, and the two letterbox offsets.
The returned object is a copy, so holding one does not observe later frames.

## `engine.destroy()`

Halts the loop, detaches every listener, and removes the host interface handle
while it still belongs to this engine. Idempotent, because teardown races.

Destroying resolves any promise `run` returned. Aborting a run's signal halts
the loop and leaves the engine usable, so the two are separate acts.

## Exports

`createEngine` is the root entry point's only function. `EngineOptions`,
`SurfaceMetrics`, `Engine`, and `RunOptions` are exported as types from
`@test-cabinet/simple-2d`.
