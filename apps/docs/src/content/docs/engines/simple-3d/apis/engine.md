---
title: Engine
---

`createEngine` builds the engine over a canvas and wires the subsystems
together: the renderer, the scene and the camera it renders through, the screen
layer, and the rest. The game is bound here, so an engine drives exactly one
game for its lifetime.

## `createEngine`

```ts
function createEngine<S, D = unknown>(
  options: EngineOptions<S, D>,
): Engine<S, D>;
```

`S` is the game's state type and `D` is its
[debug surface](/engines/simple-3d/apis/game/). Both are inferred from the
`game` the options carry.

Construction performs no loading and runs no game code. An engine therefore
exists in a state where its clock can be replaced and its
[events](/engines/simple-3d/apis/game/) can be subscribed to before anything the
game does is observable, which is what lets a caller watch the game's own
initialization. The scene and the camera exist from construction as well, since
both are engine-owned objects.

## `EngineOptions`

```ts
interface EngineOptions<S, D = unknown> {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  game: Game<S, D>;
  background?: string;
  layout?: string;
  clock?: Clock;
  surface?: SurfaceMetrics;
  assetRoot?: string;
  screen?: HTMLCanvasElement;
  projection?: "perspective" | "orthographic";
  shadows?: boolean;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The canvas the engine sizes, clears, and renders the scene through. |
| `width` | — | The logical design width the game draws in. Finite and positive. |
| `height` | — | The logical design height the game draws in. Finite and positive. |
| `game` | — | The [game](/engines/simple-3d/apis/game/) this engine drives. |
| `background` | — | A CSS color the whole canvas is cleared to before every frame, letterbox bars included. Absent, the canvas is cleared to transparency. |
| `layout` | — | A touch layout from the [catalogue](/engines/simple-3d/apis/input/), whose vocabulary the game then registers. |
| `clock` | `new WallClock()` | The [clock](/engines/simple-3d/apis/clocks/) supplying each frame's delta. |
| `surface` | Read from the canvas | Where the engine reads its element size and device pixel ratio. |
| `assetRoot` | `"assets/"` | The root every [asset path](/engines/simple-3d/apis/assets/) resolves under. |
| `screen` | Created from the canvas's owning document | The canvas the [screen layer](/engines/simple-3d/apis/rendering/) draws on. |
| `projection` | `"perspective"` | Which kind of camera the engine creates and renders through. |
| `shadows` | `false` | `true` enables PCF soft shadow maps on the renderer. |

`background` paints the whole canvas, so the letterbox bars carry it. A game
may also set `scene.background`, which paints inside the viewport alone.

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

Absent entirely, the engine reads `clientWidth`, `clientHeight`, the owning
window's `devicePixelRatio`, and the canvas's bounding rectangle for the origin,
listens on the canvas's owning document, and claims and captures pointers on the
canvas element.

## `Engine`

```ts
import type * as THREE from "three";

type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

interface Engine<S, D = unknown> {
  readonly events: EngineEvents;
  readonly state: DeepReadonly<S>;
  readonly debug: D;
  readonly scene: THREE.Scene;
  readonly camera: SceneCamera;
  initialize(): Promise<DeepReadonly<S>>;
  apply(transition: Transition<S>): DeepReadonly<S>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
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

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine [events](/engines/simple-3d/apis/game/). Available from construction. |
| `state` | The current state, as a read-only view: the value the most recent transition left. |
| `debug` | The [debug surface](/engines/simple-3d/apis/game/) the game returned beside its state. |
| `scene` | The [scene](/engines/simple-3d/apis/rendering/) the engine renders, live. Available from construction. |
| `camera` | The camera the engine renders through, live. Available from construction. |
| `initialize` | Run the game's `initialize` and resolve to the state it produced. |
| `apply` | Replace the state with what a [`Transition<S>`](/engines/simple-3d/apis/game/) returns from the current one, and return the new state. |
| `run` | Drive the game off the host's frame callback until the supplied signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick the clock accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `view` | The [`View`](/engines/simple-3d/apis/view/): the camera as it stood at the most recent render, with picking and projection through it. |
| `diagnostics` | Every registered [diagnostic](/engines/simple-3d/apis/diagnostics/) source and what it reports now, in registration order. |
| `recording` | Whether the [recorder](/engines/simple-3d/apis/recording/) is capturing frames. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm the recorder, flush the encoder, and resolve with everything captured since `startRecording`. |
| `destroy` | Halt the loop, drop every listener, and dispose the renderer. |

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

The current state, as `DeepReadonly<S>`. It is the value rather than a live
reference: each frame replaces the state with what `update` returned, and each
`apply` replaces it with what the transition returned, so a read hands back the
state the most recent transition left and holds nothing a later frame writes
to. A caller that wants the state after further frames reads `engine.state`
again.

Reading it before `initialize` resolves throws, naming the ordering. That keeps
a contract violation loud at the point of the mistake.

### `apply`

```ts
const posed = engine.apply((state) => ({ ...state, ball: { ...state.ball, vx: 0 } }));
```

`apply` hands the current state to `transition`, holds the state it returns,
and returns that state as `DeepReadonly<S>`. It is how a caller poses a game
between frames: the next frame's `update` receives the state the transition
left, so the collision, the serve, or the spawn a scenario is about is still
computed by the game's own `update`. A debug surface's poses are transitions,
and a caller drives one as
`engine.apply((state) => engine.debug.setBallVelocity(state, 240, 0, 0))`.

Calling it before `initialize` resolves throws, naming the ordering, exactly as
reading `state` does. A transition that returns `undefined` is refused with an
error naming `must return the next state`, and the engine keeps the state it
had.

### `debug`

The second element of the pair the game's `initialize` returned, unchanged.
The engine holds it and reads no member of it, so its shape is whatever the
game declared as `D`.

Reading it before `initialize` resolves throws, naming the ordering and the
`[state, debug]` pair, exactly as `state` does. A game with no surface returns
`null` there, and `engine.debug` hands that `null` back.

### `scene` and `camera`

`scene` is the one `THREE.Scene` the engine renders, created empty at
construction and kept for the engine's life. `camera` is the
`THREE.PerspectiveCamera` or `THREE.OrthographicCamera` the `projection` option
selected, at the [camera defaults](/engines/simple-3d/apis/view/). Both are the
live objects rather than copies: what the game's `render` adds to the scene or
writes onto the camera is what a reader finds.

Both are readable before `initialize` resolves and after any number of frames,
which is what lets a validator inspect the scene a build populated, find an
object by name, read its world position, and read the camera's pose, with no
pixels involved.

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

`advance` ticks the clock `frames` times and resolves. Ticks run back to back
with no host frame callback between them, so the elapsed real time has no effect
on the result and there is nothing to wait for or poll.

A tick the clock declines runs no frame, so a clock supplying its own deltas
turns `frames` ticks into exactly that many frames.

`frames` must be a whole, non-negative number. `advance(0)` runs nothing.

A [clock](/engines/simple-3d/apis/clocks/) that reads `nowMs` reports near-zero
deltas here, because no real time passes between frames. Pair `advance` with a
clock that supplies its own deltas.

### `setClock`

The clock is replaced in place, and the frame counter and accumulated time carry
over. A clock installed mid-run takes effect on the next frame.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| The canvas yields no `webgl2` context | `Error` naming the canvas |
| No `screen` canvas supplied and the stage canvas has no owning document | `Error` naming `screen` |
| `projection` outside `"perspective"` / `"orthographic"` | `Error` naming both values |
| A `layout` outside the catalogue | `Error` naming every valid layout |
| The game's `initialize` throws or rejects | `initialize` rejects with the cause |
| `state`, `apply`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| A transition handed to `apply` returns `undefined` | `Error` naming `must return the next state`; the state is unchanged |
| `debug` read before `initialize` resolves | `Error` naming the ordering and the `[state, debug]` pair |
| The game's `initialize` returns anything but a two-element array | `initialize` rejects with an `Error` naming the `[state, debug]` pair |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `startRecording` while already recording, or `stopRecording` while not | `Error` naming the unbalanced call |
| `startRecording` where the host has no `VideoEncoder` | `Error` naming WebCodecs |

Each construction failure is raised by `createEngine`.

## `engine.viewport()`

Returns a [`Viewport`](/engines/simple-3d/apis/viewport/) snapshot: the logical
design size, the device pixels per logical unit, and the two letterbox offsets.
The returned object is a copy, so holding one does not observe later frames.

## `engine.view()`

Returns the [`View`](/engines/simple-3d/apis/view/): the camera as it stood at
the most recent render, and the ray and projection functions that answer
through it. The engine reads the camera's world and projection matrices after
each render, and every `view()` answers from that reading until the next
render. Before the first render it answers from the camera defaults.

## `engine.destroy()`

Halts the loop, detaches every listener, and disposes the renderer. Idempotent,
because teardown races.

Destroying resolves any promise `run` returned. Aborting a run's signal halts
the loop and leaves the engine usable, so the two are separate acts. Destroying
while the recorder is armed discards the capture and disarms the recorder.

## Exports

`createEngine` is exported as a function from `@test-cabinet/simple-3d`.
`EngineOptions`, `SurfaceMetrics`, `Engine`, `RunOptions`, `SceneCamera`,
`Transition`, and `DeepReadonly` are exported as types.
