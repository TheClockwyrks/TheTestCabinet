---
title: Game
---

A game is three functions and a state type. The game is bound to the engine when
the engine is created; `initialize` runs once when the engine is initialized,
and `update` and `render` run once each per frame after that. Each function
receives only the part of the engine it is allowed to use.

## `Game`

```ts
interface Game<S> {
  initialize(api: InitApi): S | Promise<S>;
  update(state: S, api: UpdateApi, dt: number): void;
  render(state: S, api: RenderApi): void;
}
```

| Member | Called | Receives |
| --- | --- | --- |
| `initialize` | Once, from [`engine.initialize`](/engines/simple-2d/apis/engine/) | `InitApi` |
| `update` | Once per frame, first | The state, `UpdateApi`, and the frame's delta in seconds |
| `render` | Once per frame, after `update` | The state and `RenderApi` |

`S` is the game's own state, returned by `initialize` and handed back to every
`update` and `render`. It is the only channel between the three functions, so
everything a frame needs is reachable from a value the type system already
checked, and the engine exposes the same value as
[`engine.state`](/engines/simple-2d/apis/engine/).

`initialize` may return a promise, and the engine awaits it before running any
frame. A game that loads assets resolves them here and stores them in `S`, so
every field of the state is present by the time a frame can observe it and the
state type declares each of them as such.

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in `S`, and aborts it from `update`. Ending the game is then the game's own
state rather than an engine operation.

`dt` is seconds. Every quantity a 2D game writes down is per second, and seconds
are what the game multiplies by.

## `InitApi`

```ts
interface InitApi {
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
    register(name: string, source: () => unknown): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

Everything a game declares once belongs here: its action bindings, its cue
definitions, the assets it needs, and the values it wants on the overlay.

## `UpdateApi`

```ts
interface UpdateApi {
  readonly input: {
    value(name: string): number;
    pressed(name: string): boolean;
  };
  readonly audio: {
    play(cue: string): void;
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

A throw under `run` leaves the loop alive so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

## Exports

`Game`, `InitApi`, `UpdateApi`, `RenderApi`, `EngineEvents`, `EngineEventMap`,
and `FrameInfo` are exported as types from `@test-cabinet/simple-2d`.
