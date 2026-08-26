# Simple 3D

`@test-cabinet/simple-3d` is the runtime a 3D browser game is built on. It owns
the frame loop, the WebGL2 renderer behind the scene context, the canvas fit,
input, audio, asset loading, the debug overlay, and the debug surface a game
returns for its caller. The game writes its own simulation and its own drawing,
and nothing else.

## What each side owns

The engine owns:

- The frame loop and the clock that decides what each frame's delta time is.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- The renderer: the clear, the depth reset, the projection, the lighting, and
  the letterbox bars.
- Keyboard listening, action binding, and edge detection.
- Pointer tracking, mapped into the game's own logical coordinates.
- The Web Audio graph, cue synthesis, looping, mute, and the first-gesture unlock.
- Asset URL resolution under the fixed `assets/` root, and the decoding of the
  files it loads.
- The diagnostics overlay and its toggle key.
- The draw-command recorder over the scene context.
- The debug surface the game returned, held for a caller to read back.

The game supplies:

- `initialize`, `update`, and `render`, plus the state type that joins them.
- Its action registrations, cue definitions, and diagnostic sources.
- Its debug surface, and the shape that surface has. See `debug.md`.
- Its camera, its lights, and everything drawn inside `render`, in world units
  and logical HUD units.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`:

```ts
import { createEngine } from "@test-cabinet/simple-3d";
```

The clock catalogue, the touch layout catalogue, the math functions, and every
type named in these pages come from the same entry point. There is one entry
point and no subpath.

```ts
import {
  createEngine,
  ConstantClock,
  TOUCH_LAYOUTS,
  quatFromAxisAngle,
  projectPoint,
  pointerRay,
} from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Engine,
  EngineOptions,
  Game,
  LightState,
  Transform,
  Vec3,
} from "@test-cabinet/simple-3d";
```

`DeepReadonly`, the view every reader of a game's state is handed, is the
`ts-essentials` type of that name. A game imports it from `ts-essentials`
directly; the engine re-exports it as well.

```ts
import type { DeepReadonly } from "ts-essentials";
```

## A game is three functions and two types

```ts
interface Game<S, D = unknown> {
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  render(state: DeepReadonly<S>, api: RenderApi): void;
}
```

`S` is the game's own state, held by the engine as a value. `initialize`
returns the opening state as the first element of the pair. Every frame is a
transition over it: `update` receives the current state as a `DeepReadonly<S>`
view and returns the next state, and `render` receives that next state, as the
same read-only view, and draws it. The state is the only channel between the
three functions. `initialize` may return a promise, and no frame runs until it
resolves, so every field of the state is present by the time a frame can read
it.

The value `update` returns is the state the frame leaves behind: what `render`
draws, what `engine.state` reads, and what the next `update` receives. Build it
as a new value, with spread, `map`, and small helpers, rather than by assigning
into the one handed over; the view is read-only, so the compiler refuses an
assignment. An `update` that returns `undefined` is refused with an `Error`, and
the engine keeps the state it had.

`D` is the game's debug surface, the second element of the pair and the value
the engine returns from `engine.debug`. A game with no surface declares
`Game<State, null>` and returns `[state, null]`. See `debug.md`.

Everything a game declares once belongs to `InitApi`: its action bindings, its
cue definitions, the assets it needs, and the values it wants on the overlay.

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
    loadMesh(path: string): Promise<MeshHandle>;
    loadTexture(path: string): Promise<TextureHandle>;
    loadMaterial(path: string): Promise<MaterialHandle>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  readonly diagnostics: {
    register(name: string, source: (state: DeepReadonly<S>) => unknown): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

Each function receives only the part of the engine it may use. `update` reads
input and plays cues but cannot draw; `render` draws but cannot read input or
play a cue, and holds only a read-only view, so it cannot change the state
either. A frame's audible and observable behavior is therefore decided entirely
by `update`, and nothing but a transition advances the simulation.

`dt` is **seconds**. Every speed a game writes down is per second, and seconds
are what the game multiplies by.

## Creating the engine

```ts
function createEngine<S, D = unknown>(
  options: EngineOptions<S, D>,
): Engine<S, D>;

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
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The canvas the engine sizes, clears, and renders through, via its WebGL2 context. |
| `width` | — | The logical design width the picture is projected into. Finite and positive. |
| `height` | — | The logical design height the picture is projected into. Finite and positive. |
| `game` | — | The game this engine drives, bound for the engine's lifetime. Both `S` and `D` are inferred from it. |
| `background` | — | A CSS color cleared to before every frame. Absent, the frame clears to transparency. |
| `layout` | — | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. See `input.md`. |
| `clock` | `new WallClock()` | The clock supplying each frame's delta. See `frame.md`. |
| `surface` | Read from the canvas | Where the engine reads element size, device pixel ratio, and its event target. |
| `assetRoot` | `"assets/"` | The root every asset path resolves under. See `assets.md`. |

`width` and `height` are not the world. The world is the game's own: right-handed,
+Y up, in whatever units the game decided. `width` and `height` are the logical
field the camera projects that world into, and the frustum's aspect ratio is
always `width / height`, so the picture is identical on every canvas and the
engine letterboxes it onto whatever size the page gives the element. See
`viewport.md`.

Construction runs no game code. It validates, compiles the engine's shaders,
builds the subsystems, and returns, which is what lets a caller subscribe to
`engine.events` before anything the game does is observable.

## The engine

```ts
interface Engine<S, D = unknown> {
  readonly events: EngineEvents;
  readonly state: DeepReadonly<S>;
  readonly debug: D;
  initialize(): Promise<DeepReadonly<S>>;
  apply(transition: Transition<S>): DeepReadonly<S>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  recording(): boolean;
  startRecording(): void;
  stopRecording(): Recording;
  destroy(): void;
}
```

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine events. Available from construction. |
| `state` | The current state, as a read-only view: the value the most recent transition left. Reading it before `initialize` resolves throws. |
| `debug` | The debug surface the game returned beside its state. Reading it before `initialize` resolves throws. See `debug.md`. |
| `initialize` | Run the game's `initialize` and resolve to the state it produced. |
| `apply` | Replace the state with the one `transition` returns from the current one, and return the new state. See below. |
| `run` | Drive frames off the host's frame callback until the signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick it accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `recording` | Whether draw-command recording is currently capturing. See `recording.md`. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm and return everything captured since `startRecording`. |
| `destroy` | Halt the loop and drop every listener. Idempotent. |

Calling `initialize` a second time resolves to the state already built, so a
caller that cannot tell whether initialization has happened may ask again.

`apply` is how a caller poses a game between frames. A `Transition<S>` has the
shape of `update` minus the frame: the current state in, the next state out.

```ts
type Transition<S> = (state: DeepReadonly<S>) => S;
```

The next frame's `update` receives the state `apply` left, and a transition
that returns `undefined` is refused exactly as `update` is. A debug surface's
poses are written as transitions, so a caller drives one with
`engine.apply((s) => engine.debug.serve(s))`. See `debug.md`.

## The shape of a build

```ts
import { createEngine, quatFromAxisAngle } from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Game,
  LightState,
  Quat,
  Transform,
  Vec3,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };
const at = (x: number, y: number, z: number): Transform => ({
  position: { x, y, z },
  rotation: IDENTITY,
  scale: ONE,
});

const CAMERA: CameraState = {
  position: { x: 0, y: 5, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.3),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.35 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.9,
    direction: { x: -0.5, y: -1, z: -0.5 },
  },
];

interface State {
  readonly x: number;
  readonly vx: number;
}

interface Debug {
  place(state: DeepReadonly<State>, x: number, vx: number): State;
  x(state: DeepReadonly<State>): number;
}

const game: Game<State, Debug> = {
  initialize(api) {
    const state: State = { x: -6, vx: 4 };

    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.audio.define("bounce", { freq: 440, freqTo: 220, durationMs: 80 });
    api.diagnostics.register("x", (s) => s.x);

    const debug: Debug = {
      place: (s, x, vx) => ({ ...s, x, vx }),
      x: (s) => s.x,
    };

    return [state, debug];
  },

  update(state, api, dt) {
    const dir = api.input.value("right") - api.input.value("left");
    const x = state.x + (state.vx + dir * 6) * dt;

    if (x < -6 || x > 6) {
      api.audio.play("bounce");
      return { x: Math.max(-6, Math.min(6, x)), vx: -state.vx };
    }
    return { ...state, x };
  },

  render(state, api) {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(16, 8), "#182231", at(0, 0, 0));
    scene.drawGeometry(
      scene.createBox({ x: 1, y: 1, z: 1 }),
      "#7fd1ff",
      at(state.x, 0.5, 0),
    );
    scene.drawHudText(`X ${state.x.toFixed(1)}`, { x: 16, y: 16 });
  },
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  background: "#05060a",
});

await engine.initialize();
await engine.run();
```

The camera and the lights are re-applied at the top of every `render` because
both are retained renderer state and re-applying costs nothing: the picture
stays a function of the state alone. With an empty light list the standard mode
lights nothing, so a scene that sets none renders black. See `drawing.md`.

## Sizing the canvas

Give the canvas a CSS size and leave its `width` and `height` attributes alone:

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, so a window resize needs no
handler and no code in the game.

Drawing inside `render` is in world units and, for the HUD, in logical design
units. There is no transform to apply: the renderer maps the logical field onto
the letterboxed device rectangle itself and clears the bars outside the picture,
so scaling never appears in the game's own code.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| A canvas that yields no WebGL2 context | `Error` |
| A `layout` outside the catalogue | `Error` naming every valid layout |
| The game's `initialize` throws or rejects | `initialize` rejects with the cause |
| `state`, `apply`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `debug` read before `initialize` resolves | `Error` naming the ordering and the `[state, debug]` pair |
| The game's `initialize` returns anything but `[state, debug]` | `initialize` rejects with an `Error` naming the pair |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `update`, or a transition handed to `apply`, returns `undefined` | `Error` naming `must return the next state`; the engine keeps the state it had |
| `startRecording` while already recording, or `stopRecording` while not | `Error` naming the unbalanced call |

Each construction failure otherwise presents as a build that runs and draws
nothing, which is the most expensive kind to trace, so each is refused where it
happens.

## The rest of these pages

| Page | Covers |
| --- | --- |
| `frame.md` | The loop, the clocks, `run` and `advance`, and `FrameInfo`. |
| `viewport.md` | The three spaces, the math types and functions, the camera, the fit, and `projectPoint` and `pointerRay`. |
| `drawing.md` | The scene context: the camera, the lights, the modes, the draw calls, the producers, materials, and the HUD. |
| `input.md` | Actions, key bindings, edges, the pointer, and the touch layout catalogue. |
| `audio.md` | Cue definition, file-backed cues, playback, looping, mute, and the unlock. |
| `assets.md` | The asset root, the loaders, the handles, the path rules, and the load events. |
| `diagnostics.md` | The overlay, frame metrics, and the display formatting. |
| `debug.md` | Declaring a debug surface, returning it beside the state, and driving it through `apply` and `state`. |
| `recording.md` | Arming the recorder, the recording format, and replaying a frame. |
