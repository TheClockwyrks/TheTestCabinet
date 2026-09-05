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

`D` is the game's [debug surface](/engines/structured-2d/apis/game-instance/),
the value the instance's `initialize` returns. It is inferred from the instance
class the `game` definition names.

Construction performs no loading and runs no game code. An engine therefore
exists in a state where its clock can be replaced and its events can be
subscribed to before anything the game does is observable, which is what lets a
caller watch the start level being built.

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
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The canvas the engine sizes, clears, and renders through. |
| `width` | — | The logical design width the camera projects into. Finite and positive. |
| `height` | — | The logical design height the camera projects into. Finite and positive. |
| `game` | — | The [game definition](/engines/structured-2d/apis/game-instance/): the level registry, the start level, and the game instance class. |
| `background` | — | A CSS color cleared to before every frame. Absent, the frame clears to transparency. |
| `imageSmoothing` | `true` | Whether an image the fit scales is resampled bilinearly. `false` samples nearest-neighbor, which keeps pixel art crisp. See [rendering](/engines/structured-2d/apis/rendering/). |
| `layout` | — | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. |
| `clock` | `new WallClock()` | The [clock](/engines/structured-2d/apis/clocks/) supplying each frame's delta. |
| `surface` | Read from the canvas | Where the engine reads element size and device pixel ratio, and attaches its key listeners. |
| `assetRoot` | `"assets/"` | The root every [asset path](/engines/structured-2d/apis/assets/) resolves under. |

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
  stopRecording(): Recording;
  destroy(): void;
}

interface RunOptions {
  signal?: AbortSignal;
}
```

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine events. Available from construction. |
| `instance` | The [game instance](/engines/structured-2d/apis/game-instance/), live. |
| `world` | The world currently open, live. |
| `renderer` | The [rendering pipeline](/engines/structured-2d/apis/rendering/): its mode and its collision overlay. |
| `debug` | The [debug surface](/engines/structured-2d/apis/game-instance/) the instance's `initialize` returned. |
| `initialize` | Construct the game instance, run its `initialize`, open `startLevel`, and resolve to the instance. |
| `run` | Drive the game off the host's frame callback until the supplied signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick the clock accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `diagnostics` | Every registered [diagnostic](/engines/structured-2d/apis/diagnostics/) source and what it reports now, the instance registry's first and then the world's. |
| `recording` | Whether draw-command [recording](/engines/structured-2d/apis/recording/) is currently capturing. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm the recorder and return everything captured since `startRecording`. |
| `destroy` | Close the world, halt the loop, and drop every listener. |

`instance` and `world` are live references rather than copies, so a reader
observes the current frame's values. `world` follows each transition, so a
caller that holds the reference across one reads the world that replaced it.

Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
naming the ordering. That keeps a contract violation loud at the point of the
mistake.

### `initialize`

`initialize` resolving means the instance exists and has run its `initialize`,
the start level's `load` has resolved, its actors are spawned and have begun
play, and its game mode has begun play. A caller therefore receives a game that
is complete rather than one it has to test before using.

Calling it a second time resolves to the instance already built, so a caller
that cannot easily tell whether initialization has happened may ask again.

The engine runs no frame before this resolves, so no tick observes a
half-constructed world.

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

A [clock](/engines/structured-2d/apis/clocks/) that reads `nowMs` reports
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

| Field | Meaning |
| --- | --- |
| `count` | Frames delivered since the loop started. |
| `timeMs` | Accumulated simulated time, in milliseconds. |
| `lastDeltaMs` | The most recent frame's delta, in milliseconds. |

`world.frame()` and a `DrawComponent`'s `api.frame()` return the same shape.
The counter and the accumulated time belong to the loop, so both carry across a
level transition.

### `viewport`

Returns a [`Viewport`](/engines/structured-2d/apis/camera/) snapshot: the
logical design size, the device pixels per logical unit, and the two letterbox
offsets. The returned object is a copy, so holding one does not observe later
frames.

### `destroy`

Closes the world, which ends play for its controllers, actors, and game mode,
then runs the instance's `shutdown`. It halts the loop and detaches every
listener. Idempotent, because teardown races.

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
  "cue:played": { cue: string; t: number; gain: number };
  "cue:looped": { cue: string; t: number; gain: number };
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
  "hit": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
}
```

| Event | Emitted |
| --- | --- |
| `asset:loaded` | A loader's value arrives. |
| `asset:failed` | A loader refuses the path, or the fetch, the status, or the decode fails. |
| `cue:played` | `world.audio.play` runs, on a muted bus as well as an audible one. |
| `cue:looped` | `world.audio.loop` starts a cue looping, on a muted bus as well as an audible one. |
| `cue:stopped` | `world.audio.stop` ends a running loop, or a redeclaration replaces a looping cue. |
| `audio:unlocked` | The engine opens the audio context, on the first pointerdown or keydown event it sees. |
| `world:opening` | A transition begins, carrying the outgoing level name and the incoming one. |
| `world:closed` | The outgoing world's game mode has ended play. |
| `world:opened` | The incoming world is built and its game mode has begun play. |
| `actor:spawned` | An actor is spawned into the world. |
| `actor:destroyed` | An actor is destroyed. |
| `possession:changed` | A controller takes a pawn or releases the one it held. |
| `match:phase` | `setPhase` sets a phase the game mode does not already hold. |
| `overlap:begin` | On the first frame the collision pass finds an overlapping pair. |
| `overlap:end` | On the first frame it stops finding it, and when either actor is destroyed or the world closes. |
| `hit` | On every frame the pass finds a blocking pair. |

`on` returns the function that removes the handler. Handlers run synchronously
at the moment the event happens, so a subscriber sees the frame the event
belongs to. A handler that throws is contained: the error reaches the console
and the remaining handlers still run.

Subscriptions live on the engine, so one made before `engine.initialize`
observes the start level being built and every transition after it.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| A canvas that yields no 2D context | `Error` |
| A `layout` outside `TOUCH_LAYOUTS` | `Error` naming every valid layout |
| `levels` with no entries | `Error` |
| `startLevel` naming no entry of `levels` | `Error` naming every registered level |
| The instance's `initialize`, a level's `load`, or a `beginPlay` throws | `initialize` rejects with the cause |
| `world`, `instance`, `debug`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| The instance's `initialize` returns `undefined` | `initialize` rejects with an `Error` naming the debug surface |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `startRecording` while already recording, or `stopRecording` while not | `Error` naming the unbalanced call |

Each construction failure otherwise presents as a build that runs and draws
nothing, which is the most expensive kind to trace, so each is refused where it
happens.

## Exports

`createEngine` is exported as a function from `@clockwyrks/structured-2d`.
`EngineOptions`, `SurfaceMetrics`, `Engine`, `RunOptions`, `FrameInfo`,
`EngineEvents`, and `EngineEventMap` are exported as types from the same
specifier, as is `Recording` with the rest of the
[recording](/engines/structured-2d/apis/recording/) format's types.
