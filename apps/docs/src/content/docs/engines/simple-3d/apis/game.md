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

| Member       | Called                                                            | Receives                                                                              | Returns                              |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| `initialize` | Once, from [`engine.initialize`](/engines/simple-3d/apis/engine/) | `InitApi<S>`                                                                          | `[state, debug]`, or a promise of it |
| `update`     | Once per frame, first                                             | The current state as `DeepReadonly<S>`, `UpdateApi`, and the frame's delta in seconds | The next state                       |
| `render`     | Once per frame, after `update`                                    | The state `update` returned, as `DeepReadonly<S>`, and `RenderApi`                    | Nothing                              |

`S` is the game's own state, the first element of the pair `initialize` returns.
The engine holds it by value: each frame is a transition over it, where `update`
is handed the current state as a read-only view and returns the next state, and
`render` is handed that next state as the same view. The value `update` returns
is what `render` draws, what [`engine.state`](/engines/simple-3d/apis/engine/)
reads, and what the next `update` receives.

`DeepReadonly<S>` is the `ts-essentials` type of that name, re-exported from
`@clockwyrks/simple-3d`. Every reader of the state is handed it, so `render`
cannot change the state and nothing but a transition advances it, and the
compiler is what says so. A game writes `update` as a pure function that builds
the next state from the current one, with spreads over the parts that changed:

```ts
update(state, api, dt) {
  return { ...state, ball: { ...state.ball, z: state.ball.z + state.ball.vz * dt } };
}
```

`update` returns the next state on every path. A return of `undefined` is
refused with an error naming `must return the next state`, and the engine keeps
the state it had.

The state carries the simulation alone and never a three object. The engine
hands out `DeepReadonly<S>` views, and a three object is mutated in place, so
the objects a game builds for its picture live on the render side, keyed by the
ids the state carries.

`D` is the game's [debug surface](#the-debug-surface), the second element of
that pair and the value the engine returns unchanged from
[`engine.debug`](/engines/simple-3d/apis/engine/). A game with no surface
writes `Game<State, null>` and returns `[state, null]`.

## `Transition`

```ts
type Transition<S> = (state: DeepReadonly<S>) => S;
```

A change to the state made from outside a frame: the shape `update` has, minus
the frame. It is what a caller hands
[`engine.apply`](/engines/simple-3d/apis/engine/) to pose the game between
frames, and what a debug surface's poses are written as. A transition that
returns `undefined` is refused the same way an `update` is.

`initialize` may return a promise of the pair, and the engine awaits it before
running any frame. A return that is anything but a two-element array rejects
`initialize` with an error naming the pair. A game that loads assets resolves
them here and stores what the state needs of them in `S`, so every field of the
state is present by the time a frame can observe it and the state type declares
each of them as such.

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in `S`, and aborts it from `update`. Ending the game is then the game's own
state rather than an engine operation.

`dt` is seconds. Every quantity a 3D game writes down is per second, and seconds
are what the game multiplies by.

## `InitApi`

```ts
import type * as THREE from "three";

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
    loadTexture(path: string): Promise<THREE.Texture>;
    loadModel(path: string): Promise<Model>;
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
  readonly scene: THREE.Scene;
  viewport(): Viewport;
}
```

Everything a game declares once belongs here: its action bindings, its cue
definitions, the assets it needs, and the values it wants on the overlay.
`loadTexture` and `loadModel` are the two [asset](/engines/simple-3d/apis/assets/)
loaders specific to 3D: a decoded image wrapped as a texture, and a glTF model
whose `scene` is a template a game clones to place.

`scene` is the engine's own [scene](/engines/simple-3d/apis/rendering/), the
same object `engine.scene` and `RenderApi.scene` hand out. A game that loads
models, builds its lights, or places its static geometry during initialization
adds them here, and they are still there when the first `render` runs.

`InitApi` is generic over the game's state so a
[diagnostic source](/engines/simple-3d/apis/diagnostics/) is typed against it.
A source is called with the state current at the read, because the state a
frame leaves behind is a new value rather than the object `initialize` built.

## The debug surface

The debug surface is the object a game returns beside its state from
`initialize`, and the engine returns that same value from
[`engine.debug`](/engines/simple-3d/apis/engine/). The engine holds it and
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
interface GantryDebug {
  readonly version: number;
  setCraneVelocity(
    state: DeepReadonly<State>,
    vx: number,
    vy: number,
    vz: number,
  ): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

engine.apply((state) => engine.debug.setCraneVelocity(state, 2, 0, 0));
const snapshot = engine.debug.snapshot(engine.state);
```

## `UpdateApi`

```ts
interface UpdateApi {
  readonly input: {
    value(name: string): number;
    pressed(name: string): boolean;
    pointer(): PointerSnapshot;
    pointerPressed(button?: PointerButton): boolean;
    pointerReleased(button?: PointerButton): boolean;
    pointerSamples(): PointerSample[];
    pointerContacts(): PointerContact[];
    wheel(): WheelDelta;
  };
  readonly audio: {
    play(cue: string, options?: PlayOptions): void;
    loop(cue: string, options?: PlayOptions): void;
    stop(cue: string): void;
    place(cue: string, at: Vec3): void;
    looping(cue: string): boolean;
    setMuted(muted: boolean): void;
    muted(): boolean;
  };
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
}
```

`update` reads input, plays cues, and advances the simulation. Nothing here
draws, so a simulation can be stepped and inspected with no drawing surface
involved in the result.

`play` and `loop` take a `PlayOptions` whose `at` places the cue in world
space, and `place` moves a running loop.

`view()` is the [`View`](/engines/simple-3d/apis/view/): the camera as it
stood at the most recent render. `update` picks against it, turning the pointer
position `input.pointer()` reports into a world-space ray with `view().ray`,
so a pick is resolved against the camera the player is looking through.

## `RenderApi`

```ts
import type * as THREE from "three";

interface RenderApi {
  readonly scene: THREE.Scene;
  readonly camera: SceneCamera;
  readonly screen: CanvasRenderingContext2D;
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
}
```

`scene` is the engine's retained scene, and `camera` is the camera the engine
renders through. `render` updates the scene's objects from the state, adds and
removes objects as the state changes, and poses the camera by writing its
position, its orientation, and its projection fields. The engine updates world
matrices, holds a perspective camera's `aspect` at the design aspect, and
renders after `render` returns, so the picture is what `render` left.

```ts
render(state, api) {
  api.camera.position.set(state.camera.x, state.camera.y, state.camera.z);
  api.camera.lookAt(0, 0, 0);
  api.screen.fillText(`score ${state.score}`, 16, 32);
}
```

`screen` is the [screen layer](/engines/simple-3d/apis/rendering/)'s 2D
context, cleared and already carrying the logical viewport transform, so HUD
drawing is in logical coordinates and is composited over the 3D picture at the
end of the frame. Nothing here reads input or plays a cue, so a frame's
audible and observable behavior is decided entirely by `update`.

`screen` is the screen canvas's own 2D context. A validator that wants the
drawing operations rather than the pixels substitutes its own object for the
context, and the engine passes through whatever the canvas returned.

`view()` here answers from the previous frame's render, since the engine reads
the camera after `render` returns. A `render` that projects a world point onto
the screen layer with `view().project` therefore draws it where the previous
frame's camera placed it.

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
  "cue:played": { cue: string; t: number; gain: number; at: Vec3 | null };
  "cue:looped": { cue: string; t: number; gain: number; at: Vec3 | null };
  "cue:stopped": { cue: string; t: number };
  "audio:unlocked": Record<string, never>;
}
```

`on` returns the function that removes the handler. A handler that throws is
contained: the error reaches the console and the remaining handlers still run.

`at` on `cue:played` and `cue:looped` is the world position the cue was played
at, or `null` for a cue played without one.

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

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `count`       | Frames run since the loop started.                                           |
| `timeMs`      | Accumulated simulated time in milliseconds: the sum of the deltas delivered. |
| `lastDeltaMs` | The delta the most recent frame was stepped by, in milliseconds.             |

`timeMs` and `lastDeltaMs` are milliseconds; the `dt` passed to `update` is
seconds.

## Errors

| Condition                                    | Result                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize` throws or rejects               | `engine.initialize` rejects with the cause, and no frame runs                                                                                   |
| `update` or `render` throws under `run`      | The error propagates to the host, and the loop schedules the next frame                                                                         |
| `update` or `render` throws under `advance`  | `advance` rejects with the cause, and the remaining frames do not run                                                                           |
| `update` returns `undefined` under `run`     | An `Error` naming `must return the next state` propagates to the host, the loop schedules the next frame, and the engine keeps the state it had |
| `update` returns `undefined` under `advance` | `advance` rejects with that `Error`, the remaining frames do not run, and the engine keeps the state it had                                     |

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
`@clockwyrks/simple-3d`, alongside `SceneCamera`, `View`, `PlayOptions`, and
`Model`. `DeepReadonly` is the `ts-essentials` type, re-exported so a game
names the view of its own state without a second import; game code may equally
import it from `ts-essentials` directly.
