# Simple 2D

`@test-cabinet/simple-2d` is the runtime a 2D browser game is built on. It owns
the frame loop, the canvas fit, input, audio, asset loading, the debug overlay,
and the debug surface a game exposes to its caller. The game writes its own
simulation and its own drawing, and nothing else.

## What each side owns

The engine owns:

- The frame loop and the clock that decides what each frame's delta time is.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- Clearing and transforming the drawing context before every frame.
- Keyboard listening, action binding, and edge detection.
- The Web Audio graph, cue synthesis, mute, and the first-gesture unlock.
- Asset URL resolution under the fixed `assets/` root.
- The diagnostics overlay and its toggle key.
- The draw-command recorder over the drawing context.
- The debug surface the game exposed, held for a caller to read back.

The game supplies:

- `initialize`, `update`, and `render`, plus the state type that joins them.
- Its action registrations, cue definitions, and diagnostic sources.
- Its debug surface, and the shape that surface has. See `debug.md`.
- Everything drawn inside `render`, in logical coordinates.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`:

```ts
import { createEngine } from "@test-cabinet/simple-2d";
```

The clock catalogue, the touch layout catalogue, and every type named in these
pages come from the same entry point:

```ts
import { createEngine, ConstantClock, TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";
import type { CueSpec, Engine, EngineOptions, Game } from "@test-cabinet/simple-2d";
```

## A game is three functions and a state type

```ts
interface Game<S, D = unknown> {
  initialize(api: InitApi<D>): S | Promise<S>;
  update(state: S, api: UpdateApi, dt: number): void;
  render(state: S, api: RenderApi): void;
}
```

`S` is the game's own state. `initialize` returns it and every `update` and
`render` receives it back, so it is the only channel between the three
functions. `initialize` may return a promise, and no frame runs until it
resolves, so every field of the state is present by the time a frame can read
it.

`D` is the game's debug surface, the value `initialize` hands to
`api.debug.expose` and the engine returns from `engine.debug`. A game that
exposes none leaves it at its default. See `debug.md`.

Everything a game declares once belongs to `InitApi`: its action bindings, its
cue definitions, the assets it needs, the values it wants on the overlay, and
its debug surface.

```ts
interface InitApi<D = unknown> {
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
  readonly debug: {
    expose(surface: D): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

Each function receives only the part of the engine it may use. `update` reads
input and plays cues but cannot draw; `render` draws but cannot read input or
play a cue. A frame's audible and observable behavior is therefore decided
entirely by `update`.

`dt` is **seconds**. Every speed a 2D game writes down is per second, and
seconds are what the game multiplies by.

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
| `canvas` | — | The canvas the engine sizes, clears, and renders through. |
| `width` | — | The logical design width the game draws in. Finite and positive. |
| `height` | — | The logical design height the game draws in. Finite and positive. |
| `game` | — | The game this engine drives, bound for the engine's lifetime. Both `S` and `D` are inferred from it. |
| `background` | — | A CSS color cleared to before every frame. Absent, the frame clears to transparency. |
| `layout` | — | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. See `input.md`. |
| `clock` | `new WallClock()` | The clock supplying each frame's delta. See `frame.md`. |
| `surface` | Read from the canvas | Where the engine reads element size and device pixel ratio. |
| `assetRoot` | `"assets/"` | The root every asset path resolves under. See `assets.md`. |

`width` and `height` are the coordinate system the game is written in, and they
stay fixed for the life of the build. State every speed, size, and distance in
those units; the engine fits that field onto whatever size the page gives the
canvas.

Construction runs no game code. It validates, builds the subsystems, and
returns, which is what lets a caller subscribe to `engine.events` before
anything the game does is observable.

## The engine

```ts
interface Engine<S, D = unknown> {
  readonly events: EngineEvents;
  readonly state: S;
  readonly debug: D;
  initialize(): Promise<S>;
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
| `state` | The value `initialize` resolved to, live. Reading it before then throws. |
| `debug` | The debug surface the game exposed. Reading it before then throws. See `debug.md`. |
| `initialize` | Run the game's `initialize` and resolve to the state it produced. |
| `run` | Drive frames off the host's frame callback until the signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick it accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `recording` | Whether draw-command recording is currently capturing. See `recording.md`. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm and return everything captured since `startRecording`. |
| `destroy` | Halt the loop and drop every listener. |

Calling `initialize` a second time resolves to the state already built, so a
caller that cannot tell whether initialization has happened may ask again.

## The shape of a build

```ts
import { createEngine } from "@test-cabinet/simple-2d";
import type { Game } from "@test-cabinet/simple-2d";

interface State {
  x: number;
  y: number;
  vx: number;
}

interface Debug {
  place(x: number): void;
  x(): number;
}

const game: Game<State, Debug> = {
  initialize(api) {
    const state: State = { x: 320, y: 180, vx: 0 };

    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.audio.define("bounce", { freq: 440, freqTo: 220, durationMs: 80 });
    api.diagnostics.register("x", () => state.x);
    api.debug.expose({
      place: (x) => {
        state.x = x;
      },
      x: () => state.x,
    });

    return state;
  },

  update(state, api, dt) {
    const dir = api.input.value("right") - api.input.value("left");
    state.vx = dir * 240;
    state.x += state.vx * dt;

    if (state.x < 0 || state.x > 640) {
      state.x = Math.max(0, Math.min(640, state.x));
      api.audio.play("bounce");
    }
  },

  render(state, api) {
    api.ctx.fillStyle = "#7fd1ff";
    api.ctx.fillRect(state.x - 12, state.y - 12, 24, 24);
  },
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  background: "#101018",
});

await engine.initialize();
await engine.run();
```

## Sizing the canvas

Give the canvas a CSS size and leave its `width` and `height` attributes alone:

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, so a window resize needs no
handler and no code in the game.

Drawing inside `render` is in logical coordinates. The engine applies the
letterbox and the device pixel ratio as a context transform before the game
draws, so scaling never appears in the game's own code.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| A canvas that yields no 2D context | `Error` |
| A `layout` outside the catalogue | `Error` naming every valid layout |
| The game's `initialize` throws or rejects | `initialize` rejects with the cause |
| `state`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `debug` read before the game exposed a surface | `Error` naming the ordering |
| `expose` called a second time | `Error` naming the duplicate |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |

## The rest of these pages

| Page | Covers |
| --- | --- |
| `frame.md` | The loop, the clocks, `run` and `advance`, and `FrameInfo`. |
| `input.md` | Actions, key bindings, edges, and the touch layout catalogue. |
| `audio.md` | Cue definition, file-backed cues, playback, mute, and the unlock. |
| `assets.md` | The asset root, the loaders, the path rules, and the load events. |
| `diagnostics.md` | The overlay, frame metrics, and the display formatting. |
| `debug.md` | Declaring a debug surface, exposing it, and reading it back. |
| `recording.md` | Arming the recorder, the recording format, and replaying a frame. |
