# Simple 3D

`@clockwyrks/simple-3d` is the runtime a 3D browser game is built on. It owns
the frame loop, the canvas fit, the renderer with the scene and the camera it
draws through, the 2D screen layer composited over that picture, input, audio,
asset loading, the debug overlay, the recorder, and the debug surface a game
returns for its caller. The game writes its own simulation and its own picture,
and nothing else.

## What each side owns

The engine owns:

- The frame loop and the clock that decides what each frame's delta time is.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- The `THREE.WebGLRenderer` over the canvas, the retained `THREE.Scene`, and the
  perspective or orthographic camera it renders through.
- The screen layer: a second, engine-owned 2D canvas, cleared and given the
  logical viewport transform before every frame and composited over the 3D
  picture at the end of it.
- The `View`: the camera as it stood at the most recent render, with picking by
  ray and projection through it.
- Keyboard listening, action binding, and edge detection.
- Pointer tracking, mapped into the game's own logical coordinates.
- The Web Audio graph, cue synthesis, positional playback, looping, mute, and
  the first-gesture unlock.
- Asset URL resolution under the fixed `assets/` root, and the image, texture,
  glTF, and audio decoders.
- The diagnostics registry, the overlay it draws, and its toggle key.
- The recorder that captures the picture the game submitted, as video.
- The debug surface the game returned, held for a caller to read back.

The game supplies:

- `initialize`, `update`, and `render`, plus the state type that joins them.
- Every object it places in the scene, and the pose it writes onto the camera.
- Everything it draws on the screen layer, in logical coordinates.
- Its action registrations, cue definitions, and diagnostic sources.
- Its debug surface, and the shape that surface has. See `debug.md`.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`:

```ts
import { createEngine } from "@clockwyrks/simple-3d";
```

The clock catalogue, the touch layout catalogue, `cloneModel`, and every type
named in these pages come from the same entry point:

```ts
import {
  cloneModel,
  createEngine,
  ConstantClock,
  TOUCH_LAYOUTS,
} from "@clockwyrks/simple-3d";
import type {
  CueSpec,
  Engine,
  EngineOptions,
  Game,
  Model,
  Ray,
  Vec3,
  View,
} from "@clockwyrks/simple-3d";
```

`DeepReadonly`, the view every reader of a game's state is handed, is the
`ts-essentials` type of that name. A game imports it from `ts-essentials`
directly; the engine re-exports it as well.

```ts
import type { DeepReadonly } from "ts-essentials";
```

## `three` is the build's own

`three` is a **peer dependency** of the engine. The build declares it in its own
`package.json` beside the engine and imports it directly wherever it constructs
a mesh, a material, a light, or a color:

```ts
import * as THREE from "three";
```

The engine re-exports nothing from `three`, so the objects it hands the game —
`api.scene` and `api.camera` — are the build's own instance's `THREE.Scene` and
`THREE.PerspectiveCamera` or `THREE.OrthographicCamera`, and an `instanceof`
check against the build's import holds.

## A game is three functions and two types

```ts
interface Game<S, D = unknown> {
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  render(state: DeepReadonly<S>, api: RenderApi): void;
}
```

`S` is the game's own state, held by the engine as a value. `initialize` returns
the opening state as the first element of the pair. Every frame is a transition
over it: `update` receives the current state as a `DeepReadonly<S>` view and
returns the next state, and `render` receives that next state, as the same
read-only view, populates the scene, poses the camera, and draws the HUD from
it. The state is the only channel between the three functions. `initialize` may
return a promise, and no frame runs until it resolves, so every field of the
state is present by the time a frame can read it.

The value `update` returns is the state the frame leaves behind: what `render`
draws, what `engine.state` reads, and what the next `update` receives. Build it
as a new value, with spread, `map`, and small helpers, rather than by assigning
into the one handed over; the view is read-only, so the compiler refuses an
assignment. An `update` that returns `undefined` is refused with an `Error`, and
the engine keeps the state it had.

**The state never carries a three object.** A three object is mutated in place,
and a `DeepReadonly` view of one is a lie a game would cast its way out of on
every frame. The objects a game builds for its picture live on the render side,
keyed by the ids the state carries. See `rendering.md`.

`D` is the game's debug surface, the second element of the pair and the value
the engine returns from `engine.debug`. A game with no surface declares
`Game<State, null>` and returns `[state, null]`. See `debug.md`.

Everything a game declares once belongs to `InitApi`: its action bindings, its
cue definitions, the assets it needs, the values it wants on the overlay, and
the lights and standing geometry it places in the scene.

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

Each function receives only the part of the engine it may use. `update` reads
input and plays cues but cannot draw; `render` draws but cannot read input or
play a cue, and holds only a read-only view, so it cannot change the state
either. A frame's audible and observable behavior is therefore decided entirely
by `update`, and nothing but a transition advances the simulation.

```ts
interface UpdateApi {
  readonly input: {
    /* see input.md */
  };
  readonly audio: {
    /* see audio.md */
  };
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
}

interface RenderApi {
  readonly scene: THREE.Scene;
  readonly camera: SceneCamera;
  readonly screen: CanvasRenderingContext2D;
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
}
```

`view()` is the one thing about the picture `update` may read, because picking
is a question the simulation asks: what the player pointed at is decided against
the camera the player was looking through. See `camera.md`.

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
  screen?: HTMLCanvasElement;
  projection?: "perspective" | "orthographic";
  shadows?: boolean;
}
```

| Field        | Default                                   | Meaning                                                                                                                    |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `canvas`     | —                                         | The canvas the engine sizes, clears, and renders the scene through.                                                        |
| `width`      | —                                         | The logical design width the game draws in. Finite and positive.                                                           |
| `height`     | —                                         | The logical design height the game draws in. Finite and positive.                                                          |
| `game`       | —                                         | The game this engine drives, bound for the engine's lifetime. Both `S` and `D` are inferred from it.                       |
| `background` | —                                         | A CSS color the whole canvas is cleared to before every frame, letterbox bars included. Absent, it clears to transparency. |
| `layout`     | —                                         | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. See `input.md`.                             |
| `clock`      | `new WallClock()`                         | The clock supplying each frame's delta. See `frame.md`.                                                                    |
| `surface`    | Read from the canvas                      | Where the engine reads element size and device pixel ratio, and what it listens on.                                        |
| `assetRoot`  | `"assets/"`                               | The root every asset path resolves under. See `assets.md`.                                                                 |
| `screen`     | Created from the canvas's owning document | The canvas the screen layer draws on. See `rendering.md`.                                                                  |
| `projection` | `"perspective"`                           | Which camera class the engine creates and renders through. See `camera.md`.                                                |
| `shadows`    | `false`                                   | `true` enables PCF soft shadow maps on the renderer.                                                                       |

`width` and `height` are the coordinate system the **screen layer** is drawn in,
and they stay fixed for the life of the build. They also fix the picture's
aspect: the engine holds a perspective camera's `aspect` at `width / height` and
the letterbox bars absorb whatever difference the element's own shape has. State
every HUD coordinate in those units and every distance in the world in world
units. A landscape game is comfortable at `1280 × 720` or `640 × 360`.

Construction runs no game code. It validates, builds the subsystems, and
returns, which is what lets a caller subscribe to `engine.events` before
anything the game does is observable. The scene and the camera exist from
construction for the same reason.

## The engine

```ts
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
```

| Member           | Effect                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `events`         | Subscribe to engine events. Available from construction.                                                                           |
| `state`          | The current state, as a read-only view: the value the most recent transition left. Reading it before `initialize` resolves throws. |
| `debug`          | The debug surface the game returned beside its state. Reading it before `initialize` resolves throws. See `debug.md`.              |
| `scene`          | The scene the engine renders, live and retained. Available from construction and after `destroy`.                                  |
| `camera`         | The camera the engine renders through, live and posed by the game's `render`. Available from construction.                         |
| `initialize`     | Run the game's `initialize` and resolve to the state it produced.                                                                  |
| `apply`          | Replace the state with the one `transition` returns from the current one, and return the new state. See below.                     |
| `run`            | Drive frames off the host's frame callback until the signal aborts.                                                                |
| `advance`        | Tick the clock `frames` times, running a frame for each tick it accepts.                                                           |
| `setClock`       | Replace the clock. The next frame takes its delta from the new one.                                                                |
| `frame`          | The frame counter, the accumulated simulated time, and the most recent delta.                                                      |
| `viewport`       | The current logical-to-device fit, as a snapshot the caller owns.                                                                  |
| `view`           | The camera as it stood at the most recent render, with picking and projection through it. See `camera.md`.                         |
| `diagnostics`    | Every registered diagnostic source and what it reports now, in registration order. See `diagnostics.md`.                           |
| `recording`      | Whether the recorder is capturing frames. See `recording.md`.                                                                      |
| `startRecording` | Arm the recorder. Capture begins at the next frame.                                                                                |
| `stopRecording`  | Disarm, flush the encoder, and resolve with everything captured since `startRecording`.                                            |
| `destroy`        | Halt the loop, drop every listener, and dispose the renderer.                                                                      |

Calling `initialize` a second time resolves to the state already built, so a
caller that cannot tell whether initialization has happened may ask again.

`apply` is how a caller poses a game between frames. A `Transition<S>` has the
shape of `update` minus the frame: the current state in, the next state out.

```ts
type Transition<S> = (state: DeepReadonly<S>) => S;
```

The next frame's `update` receives the state `apply` left, and a transition that
returns `undefined` is refused exactly as `update` is. A debug surface's poses
are written as transitions, so a caller drives one with
`engine.apply((s) => engine.debug.setHook(s, 0, 4, 0))`. See `debug.md`.

## The shape of a build

```ts
import * as THREE from "three";
import { createEngine } from "@clockwyrks/simple-3d";
import type { Game, Vec3 } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const LIMIT = 8;

interface State {
  readonly x: number;
  readonly vx: number;
  readonly bounces: number;
}

interface Debug {
  setPosition(state: DeepReadonly<State>, x: number): State;
  bounces(state: DeepReadonly<State>): number;
}

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
);
cube.name = "drifter";

const game: Game<State, Debug> = {
  initialize(api) {
    api.scene.add(new THREE.HemisphereLight("#ffffff", "#223344", 1));
    api.scene.add(cube);

    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.audio.define("bounce", { freq: 440, freqTo: 220, durationMs: 80 });
    api.diagnostics.register("x", (s) => s.x);

    const debug: Debug = {
      setPosition: (s, x) => ({ ...s, x }),
      bounces: (s) => s.bounces,
    };

    return [{ x: 0, vx: 4, bounces: 0 }, debug];
  },

  update(state, api, dt) {
    const dir = api.input.value("right") - api.input.value("left");
    const vx = state.vx + dir * 8 * dt;
    const x = state.x + vx * dt;

    if (x < -LIMIT || x > LIMIT) {
      const at: Vec3 = { x: state.x, y: 0, z: 0 };
      api.audio.play("bounce", { at });
      return {
        x: Math.max(-LIMIT, Math.min(LIMIT, x)),
        vx: -vx,
        bounces: state.bounces + 1,
      };
    }
    return { ...state, x, vx };
  },

  render(state, api) {
    cube.position.x = state.x;
    api.camera.position.set(0, 4, 14);
    api.camera.lookAt(0, 0, 0);

    api.screen.fillStyle = "#e6edf6";
    api.screen.font = "16px monospace";
    api.screen.fillText(`x ${state.x.toFixed(2)}`, 16, 28);
  },
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  background: "#05060a",
});

await engine.initialize();
await engine.run();
```

## Sizing the canvas

Give the canvas a CSS size and leave its `width` and `height` attributes alone:

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine reads the laid-out size at the top of every frame and resizes both
backing stores — the stage canvas and the screen canvas — to match the device
pixel ratio, so a window resize needs no handler and no code in the game. The
screen canvas the engine creates stays off the page; the 3D picture and the HUD
reach the stage canvas together.

Drawing on the screen layer is in logical coordinates. The engine applies the
letterbox and the device pixel ratio as a context transform before the game
draws, so scaling never appears in the game's own code.

## Errors

| Condition                                                                  | Result                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A `width` or `height` that is not finite and positive                      | `Error` naming the size                                          |
| The canvas yields no `webgl2` context                                      | `Error` naming the canvas                                        |
| No `screen` canvas supplied and the stage canvas has no owning document    | `Error` naming `screen`                                          |
| A `projection` outside `"perspective"` / `"orthographic"`                  | `Error` naming both values                                       |
| A `layout` outside the catalogue                                           | `Error` naming every valid layout                                |
| The game's `initialize` throws or rejects                                  | `initialize` rejects with the cause                              |
| The game's `initialize` returns anything but `[state, debug]`              | `initialize` rejects with an `Error` naming the pair             |
| `state`, `apply`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering                                      |
| `debug` read before `initialize` resolves                                  | `Error` naming the ordering                                      |
| `advance` with a count that is not a whole, non-negative number            | `RangeError` naming the value                                    |
| `update`, or a transition handed to `apply`, returns `undefined`           | `Error` naming the transition; the engine keeps the state it had |

Each construction failure is raised by `createEngine`, so a build that would run
and draw nothing is refused where the mistake is.

## The rest of these pages

| Page             | Covers                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `frame.md`       | The loop, its eleven steps, the clocks, `run` and `advance`, and `FrameInfo`.                             |
| `rendering.md`   | The scene, the render cache, lights, shadows, the background, the screen layer, and compositing.          |
| `camera.md`      | The three spaces, posing the camera, `View`, picking with a ray, projection, and the letterbox rule.      |
| `input.md`       | Actions, key bindings, edges, the pointer, the wheel, and the touch layout catalogue.                     |
| `audio.md`       | Cue definition, file-backed cues, positional playback, looping, mute, and the unlock.                     |
| `assets.md`      | The asset root, the loaders, textures, glTF models and `cloneModel`, the path rules, and the load events. |
| `diagnostics.md` | Registering sources, reading them back, the overlay, and frame metrics.                                   |
| `debug.md`       | Declaring a debug surface, returning it beside the state, and driving it through `apply` and `state`.     |
| `recording.md`   | Arming the recorder and the video it hands back.                                                          |
