---
title: Engine
---

`createEngine` is the factory the root entry point exposes. It builds the
engine over a canvas, wires the subsystems together, and binds one game
definition for the engine's lifetime.

A game's state lives in the framework objects the engine owns: the game
instance, the world currently open, that world's game mode and game state, and
the actors in it. `createEngine` therefore takes no state type parameter, and
the engine hands those objects back rather than a value the game returned.

## `createEngine`

```ts
function createEngine<D = unknown>(options: EngineOptions<D>): Engine<D>;
```

`D` is the game's [debug surface](/engines/structured-3d/apis/game-instance/),
the value the instance's `initialize` returns. It is inferred from the instance
class the `game` definition names.

Construction performs no loading and runs no game code. An engine therefore
exists in a state where its clock can be replaced and its events can be
subscribed to before anything the game does is observable, which is what lets a
caller watch the start level being built. Construction does obtain the
renderer's `webgl2` context and the screen layer's canvas, so a canvas that
cannot supply either is refused here.

## `EngineOptions`

```ts
interface EngineOptions<D = unknown> {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  game: GameDefinition<D>;
  background?: string;
  imageSmoothing?: boolean;
  layout?: string;
  clock?: Clock;
  surface?: SurfaceMetrics;
  assetRoot?: string;
  screen?: HTMLCanvasElement;
  shadows?: boolean;
}
```

| Field            | Default                                         | Meaning                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas`         | —                                               | The stage canvas the engine sizes, clears, and renders the scene through.                                                                                                                            |
| `width`          | —                                               | The logical design width the camera projects into. Finite and positive.                                                                                                                              |
| `height`         | —                                               | The logical design height the camera projects into. Finite and positive.                                                                                                                             |
| `game`           | —                                               | The [game definition](/engines/structured-3d/apis/game-instance/): the level registry, the start level, and the game instance class.                                                                 |
| `background`     | —                                               | A CSS color the whole canvas is cleared to before every frame, letterbox bars included. Absent, the frame clears to transparency.                                                                    |
| `imageSmoothing` | `true`                                          | Whether an image the fit scales on the screen layer is resampled bilinearly. `false` samples nearest-neighbor, which keeps pixel art crisp. See [rendering](/engines/structured-3d/apis/rendering/). |
| `layout`         | —                                               | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers.                                                                                                                       |
| `clock`          | `new WallClock()`                               | The [clock](/engines/structured-3d/apis/clocks/) supplying each frame's delta.                                                                                                                       |
| `surface`        | Read from the canvas                            | Where the engine reads element size and device pixel ratio, and attaches its key listeners.                                                                                                          |
| `assetRoot`      | `"assets/"`                                     | The root every [asset path](/engines/structured-3d/apis/assets/) resolves under.                                                                                                                     |
| `screen`         | Created from the stage canvas's owning document | The 2D canvas the screen layer draws on, sized to the stage canvas's backing store and composited over the picture at the end of every frame.                                                        |
| `shadows`        | `false`                                         | `true` enables shadow maps with soft (PCF) filtering, so a light declared with `castShadow` shadows a mesh declared with `receiveShadow`.                                                            |

The engine draws two things onto the stage canvas each frame: the scene, which
the pipeline populates from the world's render components and renders through
the camera, and the screen layer, a 2D canvas the engine owns whose context
carries the logical viewport transform. Screen-space components and the
diagnostics overlay draw on the screen layer.
The [rendering](/engines/structured-3d/apis/rendering/) page covers both
surfaces and the compositing.

A validator hands a canvas of its own as `screen`, or a recording proxy over
that canvas's context, so the screen layer's pixels and operations are readable
in the suite.

## `SurfaceMetrics`

```ts
interface SurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
  origin?(): { x: number; y: number };
  claimGestures?(): () => void;
  capturePointer?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}
```

The engine reads the canvas's laid-out size and device pixel ratio through this
seam every frame, and attaches its key and pointer listeners to the event target
it returns. Supplied, it replaces every measurement the engine would otherwise
take from the DOM, which is what lets the engine run over a canvas with no
document behind it.

`origin()` is the canvas's top-left corner in the client coordinate space
pointer events report their positions in, and it is what the engine subtracts
before mapping a pointer position onto the stage. Absent, the origin reads
`(0, 0)`, so a dispatched pointer event's client position is read as CSS pixels
from the canvas's corner.

`claimGestures()` takes the browser's own pointer gestures on the surface, and
returns the function that gives them back. Those gestures are panning,
pinch-zoom, double-tap zoom, text selection, the wheel's page scroll, and the
context menu, and while they are claimed a drag, a wheel, and a press of the
secondary button all reach the game instead. The engine calls it once as the
pointer attaches and calls the returned function when the pointer detaches.

`capturePointer(pointerId)` routes every later event for that pointer to the
surface until `releasePointerCapture(pointerId)`, so a drag that leaves the
canvas keeps delivering moves and its release is seen. The engine captures each
pointer as it comes into contact and releases it as it leaves.

The three are optional, and a surface with no element behind it supplies none of
them. The default surface implements all three against the canvas element.

Absent entirely, the engine reads the canvas's element size, the owning
window's device pixel ratio, and the canvas's bounding rectangle for the
origin, listens on the canvas's owning document, and claims and captures
pointers on the canvas element.

## `Engine`

```ts
interface Engine<D = unknown> {
  readonly events: EngineEvents;
  readonly instance: GameInstance<D>;
  readonly world: World;
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly debug: D;
  initialize(): Promise<GameInstance<D>>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  diagnostics(): readonly DiagnosticReading[];
  recording(): boolean;
  startRecording(): void;
  stopRecording(): Promise<Recording>;
  destroy(): void;
}

interface RunOptions {
  signal?: AbortSignal;
}
```

| Member           | Effect                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`         | Subscribe to engine events. Available from construction.                                                                                                    |
| `instance`       | The [game instance](/engines/structured-3d/apis/game-instance/), live.                                                                                      |
| `world`          | The world currently open, live.                                                                                                                             |
| `renderer`       | The [rendering pipeline](/engines/structured-3d/apis/rendering/): its mode and its collision overlay.                                                       |
| `scene`          | The `THREE.Scene` the pipeline maintains, live. Available from construction. The pipeline writes it; a caller reads it.                                     |
| `debug`          | The [debug surface](/engines/structured-3d/apis/game-instance/) the instance's `initialize` returned.                                                       |
| `initialize`     | Construct the game instance, run its `initialize`, open `startLevel`, and resolve to the instance.                                                          |
| `run`            | Drive the game off the host's frame callback until the supplied signal aborts.                                                                              |
| `advance`        | Tick the clock `frames` times, running a frame for each tick the clock accepts.                                                                             |
| `setClock`       | Replace the clock. The next frame takes its delta from the new one.                                                                                         |
| `frame`          | The frame counter, the accumulated simulated time, and the most recent delta.                                                                               |
| `viewport`       | The current logical-to-device fit, as a snapshot the caller owns.                                                                                           |
| `diagnostics`    | Every registered [diagnostic](/engines/structured-3d/apis/diagnostics/) source and what it reports now, the instance registry's first and then the world's. |
| `recording`      | Whether the [recorder](/engines/structured-3d/apis/recording/) is capturing frames.                                                                         |
| `startRecording` | Arm the recorder. Capture begins at the next frame.                                                                                                         |
| `stopRecording`  | Disarm the recorder, flush the encoder, and resolve with everything captured since `startRecording`.                                                        |
| `destroy`        | Close the world, halt the loop, drop every listener, discard an armed capture, and dispose the renderer.                                                    |

`instance` and `world` are live references rather than copies, so a reader
observes the current frame's values. `world` follows each transition, so a
caller that holds the reference across one reads the world that replaced it.

Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
naming the ordering.

### `initialize`

`initialize` resolving means the instance exists and has run its `initialize`,
the start level's `load` has resolved, its actors are spawned and have begun
play, and its game mode has begun play. A caller therefore receives a game that
is complete rather than one it has to test before using.

Calling it a second time resolves to the instance already built, so a caller
that cannot easily tell whether initialization has happened may ask again.

The engine runs no frame before this resolves, so no tick observes a
half-constructed world.

### `scene`

The one `THREE.Scene` the engine renders, created empty at construction and
kept for the engine's life. The pipeline owns its contents: it gives each
world-space render component one three object, places it at the component's
world transform every frame, and rebuilds the object when the component's
declaration changes. A caller reads the scene for what the pipeline placed,
which is how a validator finds an object by name or by traversal and reads its
world position, its visibility, its geometry, and its material.

### `debug`

The value the instance's `initialize` returned, unchanged. The engine holds it
and reads no member of it, so its shape is whatever the instance declared as
`D`. A game with no surface returns `null` there, and `engine.debug` hands that
`null` back.

A surface operation acts on the live world through the instance that holds the
engine, so a caller drives one directly: `engine.debug.startMatch("versus")`
poses the world, and `engine.debug.snapshot()` reads it back.

### `run`

`run` drives frames off the host's frame callback, and the returned promise
resolves once the loop halts. A loop halts when the supplied signal aborts or
when the engine is destroyed. Omitting the signal runs until the engine is
destroyed.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

A level transition is asynchronous, because a level's `load` is. The loop runs
no frame while one is in flight, and the canvas keeps the last frame it drew.

### `advance`

`advance` ticks the clock `frames` times and resolves. Ticks run back to back
with no host frame callback between them, so the elapsed real time has no effect
on the result and there is nothing to wait for or poll.

A tick the clock declines runs no frame, so a clock supplying its own deltas
turns `frames` ticks into exactly that many frames.

`frames` must be a whole, non-negative number. `advance(0)` runs nothing.

A level transition requested during a frame completes before the next frame
begins, and `advance` awaits it, so the frames it runs are frames of a settled
world.

A [clock](/engines/structured-3d/apis/clocks/) that reads `nowMs` reports
near-zero deltas here, because no real time passes between frames. Pair
`advance` with a clock that supplies its own deltas.

### `setClock`

The clock is replaced in place, and the frame counter and accumulated time carry
over. A clock installed mid-run takes effect on the next frame.

### `frame`

```ts
interface FrameInfo {
  count: number;
  timeMs: number;
  lastDeltaMs: number;
}
```

| Field         | Meaning                                         |
| ------------- | ----------------------------------------------- |
| `count`       | Frames delivered since the loop started.        |
| `timeMs`      | Accumulated simulated time, in milliseconds.    |
| `lastDeltaMs` | The most recent frame's delta, in milliseconds. |

`world.frame()` and a `DrawComponent`'s `api.frame()` return the same shape.
The counter and the accumulated time belong to the loop, so both carry across a
level transition.

### `viewport`

Returns a [`Viewport`](/engines/structured-3d/apis/camera/) snapshot: the
logical design size, the device pixels per logical unit, and the two letterbox
offsets. The returned object is a copy, so holding one does not observe later
frames.

### `destroy`

Closes the world, which ends play for its controllers, actors, and game mode,
then runs the instance's `shutdown`. It halts the loop, detaches every
listener, and disposes the renderer. `destroy` is idempotent.

Destroying resolves any promise `run` returned. Aborting a run's signal halts
the loop and leaves the engine usable, so the two are separate acts.

## `EngineEvents`

One broadcaster carries every engine event. It is reachable as `engine.events`,
as `world.events`, and as the `events` field on each API object the framework
hands a game, so a subscriber reaches the same stream from anywhere.

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
  "world:opening": { from: string | null; to: string };
  "world:closed": { level: string };
  "world:opened": { level: string };
  "actor:spawned": { actor: Actor };
  "actor:destroyed": { actor: Actor };
  "possession:changed": {
    controller: Controller;
    pawn: Pawn | null;
    previous: Pawn | null;
  };
  "match:phase": { phase: MatchPhase; previous: MatchPhase };
  "overlap:begin": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  "overlap:end": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  hit: {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
}
```

| Event                | Emitted                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset:loaded`       | A loader's value arrives.                                                                                                                                  |
| `asset:failed`       | A loader refuses the path, or the fetch, the status, or the decode fails.                                                                                  |
| `cue:played`         | `world.audio.play` runs, on a muted bus as well as an audible one. `at` is the world point a positional cue was placed at, `null` for an unpositioned one. |
| `cue:looped`         | `world.audio.loop` starts a cue looping, on a muted bus as well as an audible one. `at` as for `cue:played`.                                               |
| `cue:stopped`        | `world.audio.stop` ends a running loop, or a redeclaration replaces a looping cue.                                                                         |
| `audio:unlocked`     | The engine opens the audio context, on the first pointerdown or keydown event it sees.                                                                     |
| `world:opening`      | A transition begins, carrying the outgoing level name and the incoming one.                                                                                |
| `world:closed`       | The outgoing world's game mode has ended play.                                                                                                             |
| `world:opened`       | The incoming world is built and its game mode has begun play.                                                                                              |
| `actor:spawned`      | An actor is spawned into the world.                                                                                                                        |
| `actor:destroyed`    | An actor is destroyed.                                                                                                                                     |
| `possession:changed` | A controller takes a pawn or releases the one it held.                                                                                                     |
| `match:phase`        | `setPhase` sets a phase the game mode does not already hold.                                                                                               |
| `overlap:begin`      | On the first frame the collision pass finds an overlapping pair.                                                                                           |
| `overlap:end`        | On the first frame it stops finding it, and when either actor is destroyed or the world closes.                                                            |
| `hit`                | On every frame the pass finds a blocking pair. The [manifold](/engines/structured-3d/apis/collision/) carries a `Vec3` normal and contact point.           |

`on` returns the function that removes the handler. Handlers run synchronously
at the moment the event happens, so a subscriber sees the frame the event
belongs to. A handler that throws is contained: the error reaches the console
and the remaining handlers still run.

Subscriptions live on the engine, so one made before `engine.initialize`
observes the start level being built and every transition after it.

## Errors

| Condition                                                                              | Result                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A `width` or `height` that is not finite and positive                                  | `Error` naming the size                                       |
| The canvas yields no `webgl2` context                                                  | `Error` naming the canvas                                     |
| No `screen` canvas supplied and the stage canvas has no owning document                | `Error` naming `screen`                                       |
| The `screen` canvas yields no 2D context                                               | `Error` naming `screen`                                       |
| A `layout` outside `TOUCH_LAYOUTS`                                                     | `Error` naming every valid layout                             |
| `levels` with no entries                                                               | `Error`                                                       |
| `startLevel` naming no entry of `levels`                                               | `Error` naming every registered level                         |
| The instance's `initialize`, a level's `load`, or a `beginPlay` throws                 | `initialize` rejects with the cause                           |
| `world`, `instance`, `debug`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering                                   |
| The instance's `initialize` returns `undefined`                                        | `initialize` rejects with an `Error` naming the debug surface |
| `advance` with a count that is not a whole, non-negative number                        | `RangeError` naming the value                                 |
| `startRecording` while already recording, or `stopRecording` while not                 | `Error` naming the unbalanced call                            |
| `startRecording` where the host has no `VideoEncoder`                                  | `Error` naming WebCodecs                                      |

## Exports

`createEngine` is exported as a function from `@clockwyrks/structured-3d`.
`EngineOptions`, `SurfaceMetrics`, `Engine`, `RunOptions`, `FrameInfo`,
`EngineEvents`, and `EngineEventMap` are exported as types from the same
specifier, as are `Recording` and `RecordedFrame`, the
[recording](/engines/structured-3d/apis/recording/) types.
