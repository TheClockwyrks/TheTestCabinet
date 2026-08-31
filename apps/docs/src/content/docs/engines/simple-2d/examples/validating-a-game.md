---
title: Validating a Game
---

A case's validators are vitest suites that run in the same process as the build.
A suite imports the engine and the build's own game module, creates an engine
over a canvas it owns and a clock it chose, and steps the game with
`engine.advance`. A check poses its scenario through `engine.apply` and reads
the outcome back through `engine.state`, both routed through the build's debug
surface; everything else it reads is an engine surface: the frame counter, the
events the engine broadcast, and the pixels or the draw calls the render
produced.

This page is one complete suite for a small game, written the way a case ships
its validators.

## The build under test

The case's specification fixes the module the build exports its game from, the
fields of the state that game holds, and the debug surface its `initialize`
returns beside the state. The surface is written in the shape of `update`: each
pose takes the current state and returns the next, and `snapshot` takes the
state and returns a plain view of it.

```ts
// src/game.ts, as a validator sees it
import type { Game } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

export interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface State {
  readonly ball: Ball;
  readonly paddle: { readonly y: number };
}

export interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly y: number };
}

export interface Debug {
  setBallPosition(state: DeepReadonly<State>, x: number, y: number): State;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vy: number): State;
  setPaddle(state: DeepReadonly<State>, y: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

export declare const game: Game<State, Debug>;
```

Each operation sets one element of the world and takes scalars, so a check
arranges only what its requirement concerns and the build stays free to store
that element however it likes. The build's own implementation of the surface is
four pure functions.

```ts
// src/debug.ts, as the build writes it
import type { Debug } from "./game";

export const debug: Debug = {
  setBallPosition: (state, x, y) => ({
    ...state,
    ball: { ...state.ball, x, y },
  }),
  setBallVelocity: (state, vx, vy) => ({
    ...state,
    ball: { ...state.ball, vx, vy },
  }),
  setPaddle: (state, y) => ({ ...state, paddle: { y } }),
  snapshot: (state) => ({ ball: { ...state.ball }, paddle: { ...state.paddle } }),
};
```

| Figure | Value |
| --- | --- |
| Logical design size | `640 × 360` |
| Background | `#101018` |
| Ball | Radius `8`, drawn in `#f45b69`, reflected by every wall |
| Paddle | `12 × 60` at `x = 24`, drawn in `#e8e8e8`, moving at `240` units per second and clamped to the field |
| Actions | `up` bound to `KeyW` and `ArrowUp`, `down` bound to `KeyS` and `ArrowDown` |
| Cues | `bounce`, played on the frame a wall reflects the ball |
| Diagnostics | `ball`, reporting `` `${x}, ${y}` `` in whole units, and `paddle`, reporting the paddle's `y` |

## Layout

The build owns `src/`, and the case's validators live beside it in
`validation/`. Each side has its own vitest config, so the build's tests are
counted and coverage-measured on their own and the case's validators run as a
separate suite.

```
package.json
tsconfig.json
vitest.config.ts
src/
  game.ts
  debug.ts
  main.ts
  physics.ts
  physics.test.ts
validation/
  vitest.config.ts
  tsconfig.json
  harness.ts
  simulation.test.ts
  audio.test.ts
  drawing.test.ts
  input.test.ts
```

The build's config names `src/`, so its suite is exactly the tests the build
wrote and its coverage is exactly the code the build shipped.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "build",
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
```

The case's config names `validation/` and roots itself at the repository, so a
validator resolves the build's modules by the same relative paths the build
uses.

```ts
// validation/vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    coverage: { enabled: false },
  },
});
```

```json
// validation/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "moduleResolution": "bundler"
  },
  "include": ["."]
}
```

The two suites run as two commands.

```sh
npx vitest run                                       # the build's own tests
npx vitest run --config validation/vitest.config.ts  # the case's validators
```

The canvas and the runner are devDependencies of the seeded workspace.

```json
{
  "devDependencies": {
    "@napi-rs/canvas": "^0.1",
    "vitest": "^3"
  }
}
```

## The harness

Every validator builds its engine through one helper. It creates a canvas with
`@napi-rs/canvas`, supplies a `SurfaceMetrics` so the engine takes every
measurement from the harness instead of from a document, wraps the 2D context in
a recording proxy, subscribes to `asset:failed` before any game code runs, and
then initializes. It also wraps the build's pure surface over the engine, so a
check writes `harness.setBallPosition(…)` and `harness.snapshot()` and the
harness routes the pose through `engine.apply` and the reading through
`engine.state`.

```ts
// validation/harness.ts
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { game, type Debug, type Snapshot, type State } from "../src/game";

// The figures the case's specification fixes.
export const FIELD_WIDTH = 640;
export const FIELD_HEIGHT = 360;
export const BACKGROUND = "#101018";
export const BALL_RADIUS = 8;
export const BALL_COLOR = "#f45b69";
export const PADDLE_X = 24;
export const PADDLE_WIDTH = 12;
export const PADDLE_HEIGHT = 60;
export const PADDLE_COLOR = "#e8e8e8";

export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

export interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

export interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  setBallPosition(x: number, y: number): void;
  setBallVelocity(vx: number, vy: number): void;
  setPaddle(y: number): void;
  snapshot(): Snapshot;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  device(x: number, y: number): { x: number; y: number };
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function toDevice(view: Viewport, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

export function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

export function setsOf(calls: readonly DrawCall[], property: string): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_WIDTH;
  const cssHeight = options.cssHeight ?? FIELD_HEIGHT;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(Math.round(cssWidth * dpr), Math.round(cssHeight * dpr));
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<State, Debug>({
    canvas: element,
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    game,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface,
  });

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  return {
    engine,
    ctx,
    calls,
    assetFailures,
    setBallPosition: (x, y) =>
      engine.apply((s) => engine.debug.setBallPosition(s, x, y)),
    setBallVelocity: (vx, vy) =>
      engine.apply((s) => engine.debug.setBallVelocity(s, vx, vy)),
    setPaddle: (y) => engine.apply((s) => engine.debug.setPaddle(s, y)),
    snapshot: () => engine.debug.snapshot(engine.state),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => engine.destroy(),
  };
}
```

Five details carry the harness.

The options the validator passes to `createEngine` are the ones the case's
specification fixes: the design size and the background. Everything else the
build decided is inside the game module, which is what makes one validator
suite serve every build of the case.

`SurfaceMetrics` supplies the element size, the device pixel ratio, and the
event target the engine attaches its key listeners to. Handing it a plain
`EventTarget` gives the validator the same seam a player's keyboard uses, so
`hold` and `release` drive actions through the bindings the game registered.

`Object.assign` puts a `style` object and a `getContext` that returns the
recording proxy onto the canvas. The engine sizes the backing store and reads
pixels through the real canvas, and every drawing operation lands in `calls` on
its way to it.

`setBallPosition`, `setBallVelocity`, `setPaddle`, and `snapshot` are the
surface wrapped over the engine. A pose is
`engine.apply((s) => engine.debug.setBallPosition(s, x, y))`: the engine hands
the current state to the transition, keeps the state it returns, and the next
frame's `update` receives it. A reading is
`engine.debug.snapshot(engine.state)`, a plain value taken from the state the
most recent frame left. A check that wants the state itself reads
`engine.state`, which is a `DeepReadonly` view of the same value.

Subscribing before `engine.initialize()` is what makes an asset failure
visible. Construction runs no game code, so the handler is attached in time to
observe the game's own initialization, and a build whose assets never arrive
reports that directly rather than as a wrong-pixels failure. A suite whose build
loads assets installs a `fetch` that serves the seeded asset directory from
disk, so every path resolving under `assetRoot` arrives in process.

## Stepping the simulation

A [`ConstantClock`](/engines/simple-2d/apis/clocks/) makes each frame worth a
known step, so a duration is a frame count and the arithmetic a check asserts is
the arithmetic the specification states. The validator poses the scenario
through the surface, advances, and reads a snapshot back.

```ts
// validation/simulation.test.ts
import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_RADIUS, FIELD_WIDTH, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("carries the ball at 200 units per second", async () => {
  const { engine } = harness;
  harness.setBallPosition(320, 180);
  harness.setBallVelocity(200, 0);

  await engine.advance(30);

  const { ball } = harness.snapshot();
  expect(engine.frame().count).toBe(30);
  expect(engine.frame().timeMs).toBeCloseTo(500, 6);
  expect(ball.x).toBeCloseTo(420, 3);
  expect(ball.y).toBeCloseTo(180, 6);
});

it("reflects the ball off the right wall", async () => {
  const { engine } = harness;
  harness.setBallPosition(320, 180);
  harness.setBallVelocity(200, 0);

  await engine.advance(120);

  const { ball } = harness.snapshot();
  expect(ball.vx).toBe(-200);
  expect(ball.x).toBeLessThanOrEqual(FIELD_WIDTH - BALL_RADIUS);
  expect(harness.assetFailures).toEqual([]);
});
```

Thirty frames of `1000 / 60` milliseconds are half a second exactly, so the ball
travels 100 units and the frame counter reads 30. Two seconds is 120 frames, and
the ball has 312 units to cover before its edge meets the wall at
`640 - 8`, so the reflection has happened and the horizontal velocity has turned
over. Each snapshot is taken after the advance, so it reads the state that
frame left rather than the one the pose built.

## Asserting a cue played

`engine.events.on` returns the function that removes the handler. A check
subscribes, runs the scenario, and asserts against what the handler collected.

```ts
// validation/audio.test.ts
import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("plays the bounce cue when the ball meets a wall", async () => {
  const { engine } = harness;
  const bounces: { t: number; gain: number }[] = [];
  const off = engine.events.on("cue:played", ({ cue, t, gain }) => {
    if (cue === "bounce") bounces.push({ t, gain });
  });

  harness.setBallPosition(320, 180);
  harness.setBallVelocity(200, 0);
  await engine.advance(120);
  off();

  expect(bounces).toHaveLength(1);
  expect(Math.abs(bounces[0].t - 1560)).toBeLessThanOrEqual(1000 / 60);
  expect(bounces[0].gain).toBeGreaterThan(0);
});
```

The bounce is due at 1560 milliseconds, from 312 units at 200 units per second,
and it lands on the first frame whose step carries the ball to the wall. The
check therefore allows one step either side of the ideal instant and asserts the
count exactly, which is the part a step size cannot move.

`t` is the frame loop's simulated time, so the timestamp a check asserts against
is the time the clock delivered rather than the real time the suite took to run.

## Asserting the diagnostics a build registered

Registering the values the case names is the build's part. Drawing the panel,
toggling it, and keeping it read-only are the engine's, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed state.

```ts
// validation/diagnostics.test.ts
import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("registers the diagnostics the case names", () => {
  const { engine } = harness;
  harness.setBall({ x: 320, y: 180, vx: 0, vy: 0 });
  harness.setPaddle(120);

  expect(engine.diagnostics()).toEqual([
    { name: "ball", value: "320, 180" },
    { name: "paddle", value: 120 },
  ]);
});
```

The readings arrive in registration order, so one comparison covers the names,
their order, and what each source reports. Reading evaluates the sources and
changes nothing else, so a check reads them at any point in a scenario, and the
overlay stays hidden throughout.

## Asserting what was drawn

Two readings of one frame answer two different questions. The pixels say what
ended up on the canvas, and the draw-call stream says what the render asked for.

The canvas is 800 by 360 CSS pixels at a device pixel ratio of 2, so the fit
scales the 640 by 360 field by 2 and centres it in a 1600 by 720 backing store
with a 160 device pixel bar on each side. `getImageData` reads device pixels and
ignores the context transform, so the validator maps logical coordinates through
`engine.viewport()` itself, which `harness.pixel` does.

Sample at least two logical units inside a shape. Curved edges are
anti-aliased, so a pixel on the rim of the ball is a blend of the ball color and
whatever is behind it, while a pixel two units in is the fill color exactly.

```ts
// validation/drawing.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BACKGROUND,
  BALL_COLOR,
  BALL_RADIUS,
  PADDLE_COLOR,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_X,
  callsTo,
  createHarness,
  setsOf,
  type Harness,
} from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
});

afterEach(() => {
  harness.dispose();
});

it("fills the ball and the paddle in their own colors", async () => {
  const { engine } = harness;
  harness.setBallPosition(320, 180);
  harness.setBallVelocity(0, 0);
  harness.setPaddle(180);

  await engine.advance(1);

  expect(harness.device(0, 0)).toEqual({ x: 160, y: 0 });
  expect(harness.pixel(320, 180)).toEqual([244, 91, 105, 255]);
  expect(harness.pixel(320 + BALL_RADIUS - 2, 180)).toEqual([244, 91, 105, 255]);
  expect(harness.pixel(320, 180 - BALL_RADIUS - 4)).toEqual([16, 16, 24, 255]);
  expect(harness.pixel(PADDLE_X + 6, 180)).toEqual([232, 232, 232, 255]);
});

it("draws the paddle as one rect and the ball as one arc", async () => {
  const { engine, calls } = harness;
  harness.setBallPosition(320, 180);
  harness.setBallVelocity(0, 0);
  harness.setPaddle(180);

  calls.length = 0;
  await engine.advance(1);

  expect(callsTo(calls, "fillRect")).toContainEqual([
    PADDLE_X,
    180 - PADDLE_HEIGHT / 2,
    PADDLE_WIDTH,
    PADDLE_HEIGHT,
  ]);

  const arcs = callsTo(calls, "arc");
  expect(arcs).toHaveLength(1);
  expect(arcs[0].slice(0, 3)).toEqual([320, 180, BALL_RADIUS]);

  const colors = setsOf(calls, "fillStyle").filter((color) => color !== BACKGROUND);
  expect(colors).toEqual([PADDLE_COLOR, BALL_COLOR]);
});
```

Clearing `calls` immediately before the frame keeps the stream to that one
frame. The stream also carries the engine's own clear and transform, so a check
names the calls the game made and filters the engine's background color out of
the fill colors it compares.

Both readings come from the same frame, because the recording proxy forwards
every call to the real context. One advance therefore produces a pixel buffer to
sample and a call list to inspect.

## Asserting an action drives the game

Dispatching a key event on the surface's event target sets the action the game
bound that key to, and the game reads it through `api.input` on the next frame.
The check holds the key, advances a known duration, and asserts the distance the
specification states.

```ts
// validation/input.test.ts
import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_HEIGHT, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("raises the paddle while the up action is held", async () => {
  const { engine } = harness;
  harness.setPaddle(180);

  harness.hold("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.y).toBeCloseTo(60, 3);

  harness.release("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.y).toBeCloseTo(60, 3);
});

it("clamps the paddle at the top of the field", async () => {
  const { engine } = harness;
  harness.setPaddle(180);

  harness.hold("ArrowUp");
  await engine.advance(120);

  expect(engine.state.paddle.y).toBeCloseTo(PADDLE_HEIGHT / 2, 6);
});
```

Half a second at 240 units per second is 120 units, and releasing the key leaves
the paddle where it stopped. These checks read `engine.state` directly, which
is the route for a field the specification fixes on the state itself; each read
is of the value the latest frame left, so the two reads in the first check are
two different values. Holding for two seconds asks for 480 units of
travel against a field that allows 150, so the second check reads the clamp
rather than the speed.

`harness.tap` presses and releases between frames, which arms the action's edge
for the next frame. That is what a check of an edge-triggered action uses, since
the engine discards an edge nothing consumed at the end of the frame.
