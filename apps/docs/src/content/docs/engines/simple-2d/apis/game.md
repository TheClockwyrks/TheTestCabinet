---
title: Game
---

A game is three functions and two types: its state, and the debug surface
returned beside it. The game is bound to the engine when the engine is created;
`initialize` runs once when the engine is initialized, and `update` and `render`
run once each per frame after that. Each function receives only the part of the
engine it is allowed to use.

## `Game`

```ts
import type { DeepReadonly } from "ts-essentials";

interface Game<S, D = unknown> {
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  render(state: DeepReadonly<S>, api: RenderApi): void;
}
```

| Member | Called | Receives | Returns |
| --- | --- | --- | --- |
| `initialize` | Once, from [`engine.initialize`](/engines/simple-2d/apis/engine/) | `InitApi<S>` | `[state, debug]`, or a promise of it |
| `update` | Once per frame, first | The current state as `DeepReadonly<S>`, `UpdateApi`, and the frame's delta in seconds | The next state |
| `render` | Once per frame, after `update` | The state `update` returned, as `DeepReadonly<S>`, and `RenderApi` | Nothing |

`S` is the game's own state, the first element of the pair `initialize` returns.
The engine holds it by value: each frame is a transition over it, where `update`
is handed the current state as a read-only view and returns the next state, and
`render` is handed that next state as the same view. The value `update` returns
is what `render` draws, what [`engine.state`](/engines/simple-2d/apis/engine/)
reads, and what the next `update` receives.

`DeepReadonly<S>` is the `ts-essentials` type of that name, re-exported from
`@clockwyrks/simple-2d`. Every reader of the state is handed it, so `render`
cannot change the state and nothing but a transition advances it, and the
compiler is what says so. A game writes `update` as a pure function that builds
the next state from the current one, with spreads over the parts that changed:

```ts
update(state, api, dt) {
  return { ...state, ball: { ...state.ball, x: state.ball.x + state.ball.vx * dt } };
}
```

`update` returns the next state on every path. A return of `undefined` is
refused with an error naming `must return the next state`, and the engine keeps
the state it had.

`D` is the game's [debug surface](#the-debug-surface), the second element of
that pair and the value the engine returns unchanged from
[`engine.debug`](/engines/simple-2d/apis/engine/). A game with no surface
writes `Game<State, null>` and returns `[state, null]`.

## `Transition`

```ts
type Transition<S> = (state: DeepReadonly<S>) => S;
```

A change to the state made from outside a frame: the shape `update` has, minus
the frame. It is what a caller hands
[`engine.apply`](/engines/simple-2d/apis/engine/) to pose the game between
frames, and what a debug surface's poses are written as. A transition that
returns `undefined` is refused the same way an `update` is.

`initialize` may return a promise of the pair, and the engine awaits it before
running any frame. A return that is anything but a two-element array rejects
`initialize` with an error naming the pair. A game that loads assets resolves
them here and stores them in `S`, so every field of the state is present by the
time a frame can observe it and the state type declares each of them as such.

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in `S`, and aborts it from `update`. Ending the game is then the game's own
state rather than an engine operation.

`dt` is seconds. Every quantity a 2D game writes down is per second, and seconds
are what the game multiplies by.

## `InitApi`

```ts
interface InitApi<S = unknown> {
  readonly input: {
    register(name: string, binding: ActionBinding): void;
    layout(): TouchLayout | null;
  };
  readonly audio: {
    define(cue: string, spec: CueSpec): void;
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    loadImage(path: string): Promise<ImageBitmap>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  readonly diagnostics: {
    register(
      name: string,
      source: (state: DeepReadonly<S>) => DiagnosticValue,
    ): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

Everything a game declares once belongs here: its action bindings, its cue
definitions, the assets it needs, and the values it wants on the overlay.

`InitApi` is generic over the game's state so a
[diagnostic source](/engines/simple-2d/apis/diagnostics/) is typed against it.
A source is called with the state current at the read, because the state a
frame leaves behind is a new value rather than the object `initialize` built.

## The debug surface

The debug surface is the object a game returns beside its state from
`initialize`, and the engine returns that same value from
[`engine.debug`](/engines/simple-2d/apis/engine/). The engine holds it and
nothing more: the shape is the game's own, and the engine reads no member of
it.

Because the surface arrives with the state, it is in place before any frame
runs, a caller holding the engine finds it as soon as `initialize` resolves,
and every caller that reads `engine.debug` holds the same object.

The surface holds no state of its own, because nothing holds a writable state.
Its operations are written in the shape of `update`: a pose is a
[`Transition<S>`](#transition) that takes the current state and returns the
next, and a reading takes the current state and returns what it read. A caller
drives a pose through `engine.apply` and a reading against `engine.state`.

```ts
interface CaromDebug {
  readonly version: number;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vy: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

engine.apply((state) => engine.debug.setBallVelocity(state, 240, 0));
const snapshot = engine.debug.snapshot(engine.state);
```

## `UpdateApi`

```ts
interface UpdateApi {
  readonly input: {
    value(name: string): number;
    pressed(name: string): boolean;
  };
  readonly audio: {
    play(cue: string): void;
    loop(cue: string): void;
    stop(cue: string): void;
    looping(cue: string): boolean;
    setMuted(muted: boolean): void;
    muted(): boolean;
  };
  frame(): FrameInfo;
  viewport(): Viewport;
}
```

`update` reads input, plays cues, and advances the simulation. Nothing here
draws, so a simulation can be stepped and inspected with no drawing surface
involved in the result.

## `RenderApi`

```ts
interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
  frame(): FrameInfo;
  viewport(): Viewport;
}
```

`ctx` is cleared and already carries the logical viewport transform, so drawing
is in logical coordinates. Nothing here reads input or plays a cue, so a frame's
audible and observable behavior is decided entirely by `update`.

`ctx` is the canvas's own 2D context. A validator that wants the drawing
operations rather than the pixels substitutes its own object for the context,
and the engine passes through whatever the canvas returned.

## `EngineEvents`

```ts
interface EngineEvents {
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

interface EngineEventMap {
  "asset:loaded": { path: string; url: string };
  "asset:failed": { path: string; url: string; reason: string };
  "cue:played": { cue: string; t: number; gain: number };
  "cue:looped": { cue: string; t: number; gain: number };
  "cue:stopped": { cue: string; t: number };
  "audio:unlocked": Record<string, never>;
}
```

`on` returns the function that removes the handler. A handler that throws is
contained: the error reaches the console and the remaining handlers still run.

Subscription is what a caller uses to observe the engine as it works, in place
of accumulating a record and reading it afterwards. Handlers are called
synchronously at the moment the event happens, so a subscriber sees the frame
the event belongs to.

## `FrameInfo`

```ts
interface FrameInfo {
  count: number;
  timeMs: number;
  lastDeltaMs: number;
}
```

| Field | Meaning |
| --- | --- |
| `count` | Frames run since the loop started. |
| `timeMs` | Accumulated simulated time in milliseconds: the sum of the deltas delivered. |
| `lastDeltaMs` | The delta the most recent frame was stepped by, in milliseconds. |

`timeMs` and `lastDeltaMs` are milliseconds; the `dt` passed to `update` is
seconds.

## Errors

| Condition | Result |
| --- | --- |
| `initialize` throws or rejects | `engine.initialize` rejects with the cause, and no frame runs |
| `update` or `render` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| `update` or `render` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| `update` returns `undefined` under `run` | An `Error` naming `must return the next state` propagates to the host, the loop schedules the next frame, and the engine keeps the state it had |
| `update` returns `undefined` under `advance` | `advance` rejects with that `Error`, the remaining frames do not run, and the engine keeps the state it had |

A throw under `run` leaves the loop alive so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

An `update` that returns nothing is refused rather than held, because a game
that mutated the view it was handed and returned nothing has advanced nothing
the engine will read again, and holding `undefined` would turn that one mistake
into a crash on an unrelated line of the next frame.

## Exports

`Game`, `Transition`, `DeepReadonly`, `InitApi`, `UpdateApi`, `RenderApi`,
`EngineEvents`, `EngineEventMap`, and `FrameInfo` are exported as types from
`@clockwyrks/simple-2d`. `DeepReadonly` is the `ts-essentials` type, re-exported
so a game names the view of its own state without a second import; game code may
equally import it from `ts-essentials` directly.
