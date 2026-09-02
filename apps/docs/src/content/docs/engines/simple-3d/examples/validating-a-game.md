---
title: Validating a Game
---

A case's validators are vitest suites that run in the same process as the build.
A suite imports the engine and the build's own game module, creates an engine
under the headless backend over two canvases it owns and a clock it chose, and
steps the game with `engine.advance`. A check poses its scenario through
`engine.apply` and reads the outcome back through `engine.state`, both routed
through the build's debug surface; everything else it reads is an engine
surface: the frame counter, the events the engine broadcast, the scene the
build populated, the camera's projection, the pixels or the draw calls of the
screen layer, and the recording the engine captured.

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
import type { Game } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

export interface Ball {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

export interface State {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

export interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

export interface Debug {
  setBallPosition(state: DeepReadonly<State>, x: number, z: number): State;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vz: number): State;
  setPaddle(state: DeepReadonly<State>, z: number): State;
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
  setBallPosition: (state, x, z) => ({
    ...state,
    ball: { ...state.ball, x, z },
  }),
  setBallVelocity: (state, vx, vz) => ({
    ...state,
    ball: { ...state.ball, vx, vz },
  }),
  setPaddle: (state, z) => ({ ...state, paddle: { z } }),
  snapshot: (state) => ({
    ball: { ...state.ball },
    paddle: { ...state.paddle },
    score: state.score,
  }),
};
```

| Figure | Value |
| --- | --- |
| Logical design size | `640 × 360` |
| Background | `#101018` |
| Court | `16 × 10` world units on the `y = 0` plane, centred on the origin with `x` across and `z` along, drawn as one plane named `court` |
| Ball | Radius `0.4`, a sphere named `ball` in `#f45b69`, resting on the court and reflected by the two side walls at `z = ±5` |
| Paddle | A `0.5 × 1 × 3` box named `paddle` at `x = -7`, in `#e8e8e8`, moving along `z` at `6` units per second and clamped to the court |
| Camera | Perspective, at `(0, 14, 10)`, looking at the origin |
| Actions | `up` bound to `KeyW` and `ArrowUp`, moving the paddle toward `-z`; `down` bound to `KeyS` and `ArrowDown` |
| Cues | `bounce`, played at the ball's position on the frame a wall reflects the ball |
| Diagnostics | `ball`, reporting `` `${x}, ${z}` `` to one decimal place, and `paddle`, reporting the paddle's `z` |
| HUD | A `120 × 40` panel at `(8, 8)` filled `#1c2033`, with `` `score ${score}` `` over it at `(16, 32)` in `#ffffff` |

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
  replay.ts
  simulation.test.ts
  audio.test.ts
  diagnostics.test.ts
  scene.test.ts
  projection.test.ts
  hud.test.ts
  input.test.ts
  recording.test.ts
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

The canvas and the runner are devDependencies of the seeded workspace. `three`
is a dependency the build declares, since the engine takes it as a peer, and
the suite imports the same copy for its scene checks.

```json
{
  "dependencies": {
    "three": "~0.182.0"
  },
  "devDependencies": {
    "@napi-rs/canvas": "^0.1",
    "@types/three": "~0.182.0",
    "vitest": "^3"
  }
}
```

## The harness

Every validator builds its engine through one helper. It creates two canvases
with `@napi-rs/canvas`, one as the stage and one as the screen layer, selects
the `headless` backend, supplies a `SurfaceMetrics` so the engine takes every
measurement from the harness instead of from a document, wraps the screen
canvas's 2D context in a recording proxy, subscribes to `asset:failed` before
any game code runs, and then initializes. It also wraps the build's pure
surface over the engine, so a check writes `harness.setBallPosition(…)` and
`harness.snapshot()` and the harness routes the pose through `engine.apply` and
the reading through `engine.state`.

```ts
// validation/harness.ts
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Projected,
  type SurfaceMetrics,
  type Vec3,
  type Viewport,
} from "@test-cabinet/simple-3d";
import { game, type Debug, type Snapshot, type State } from "../src/game";

// The figures the case's specification fixes.
export const FIELD_WIDTH = 640;
export const FIELD_HEIGHT = 360;
export const BACKGROUND = "#101018";
export const COURT_WIDTH = 16;
export const COURT_DEPTH = 10;
export const BALL_RADIUS = 0.4;
export const BALL_COLOR = "#f45b69";
export const PADDLE_X = -7;
export const PADDLE_LENGTH = 3;
export const PADDLE_COLOR = "#e8e8e8";
export const PANEL_COLOR = "#1c2033";
export const TEXT_COLOR = "#ffffff";

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
  setBallPosition(x: number, z: number): void;
  setBallVelocity(vx: number, vz: number): void;
  setPaddle(z: number): void;
  snapshot(): Snapshot;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  device(x: number, y: number): { x: number; y: number };
  pixel(x: number, y: number): [number, number, number, number];
  project(point: Vec3): Projected;
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
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(cssHeight * dpr);

  const stage = Object.assign(createCanvas(width, height), {
    style: {} as CSSStyleDeclaration,
  }) as unknown as HTMLCanvasElement;

  const screen = createCanvas(width, height);
  const ctx = screen.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const layer = Object.assign(screen, {
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
    canvas: stage,
    screen: layer,
    backend: "headless",
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
    setBallPosition: (x, z) =>
      engine.apply((s) => engine.debug.setBallPosition(s, x, z)),
    setBallVelocity: (vx, vz) =>
      engine.apply((s) => engine.debug.setBallVelocity(s, vx, vz)),
    setPaddle: (z) => engine.apply((s) => engine.debug.setPaddle(s, z)),
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
    project: (point) => engine.view().project(point),
    dispose: () => engine.destroy(),
  };
}
```

Six details carry the harness.

The options the validator passes to `createEngine` are the ones the case's
specification fixes: the design size and the background. Everything else the
build decided is inside the game module, which is what makes one validator
suite serve every build of the case.

`backend: "headless"` is what lets the suite run with no GPU and no document.
No renderer exists, so the stage canvas is asked for no context and any
canvas-like object serves there; the scene is still maintained, world matrices
are still updated, the screen layer still draws, and the recorder still
captures every frame. The pixels of the 3D picture are the one thing a headless
engine does not produce, so a claim about the scene is stated against the scene
and the projection rather than against pixels.

`screen` is the second `@napi-rs/canvas` canvas, handed over as the screen
layer. The engine draws the HUD through that canvas's own 2D context, so
`getImageData` reads the layer's pixels and `Object.assign` puts a `getContext`
onto the canvas that returns the recording proxy instead, so every drawing
operation lands in `calls` on its way to the real context.

`SurfaceMetrics` supplies the element size, the device pixel ratio, and the
event target the engine attaches its key listeners to. Handing it a plain
`EventTarget` gives the validator the same seam a player's keyboard uses, so
`hold` and `release` drive actions through the bindings the game registered.

`setBallPosition`, `setBallVelocity`, `setPaddle`, and `snapshot` are the
surface wrapped over the engine. A pose is
`engine.apply((s) => engine.debug.setBallPosition(s, x, z))`: the engine hands
the current state to the transition, keeps the state it returns, and the next
frame's `update` receives it. A reading is
`engine.debug.snapshot(engine.state)`, a plain value taken from the state the
most recent frame left. A check that wants the state itself reads
`engine.state`, which is a `DeepReadonly` view of the same value.

Subscribing before `engine.initialize()` is what makes an asset failure
visible. Construction runs no game code, so the handler is attached in time to
observe the game's own initialization, and a build whose assets never arrive
reports that directly rather than as a wrong-scene failure. A suite whose build
loads assets installs a `fetch` that serves the seeded asset directory from
disk, so every path resolving under `assetRoot` arrives in process.

## Stepping the simulation

A [`ConstantClock`](/engines/simple-3d/apis/clocks/) makes each frame worth a
known step, so a duration is a frame count and the arithmetic a check asserts is
the arithmetic the specification states. The validator poses the scenario
through the surface, advances, and reads a snapshot back.

```ts
// validation/simulation.test.ts
import { ConstantClock } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_RADIUS, COURT_DEPTH, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("carries the ball at 4 units per second", async () => {
  const { engine } = harness;
  harness.setBallPosition(0, 0);
  harness.setBallVelocity(4, 0);

  await engine.advance(30);

  const { ball } = harness.snapshot();
  expect(engine.frame().count).toBe(30);
  expect(engine.frame().timeMs).toBeCloseTo(500, 6);
  expect(ball.x).toBeCloseTo(2, 3);
  expect(ball.z).toBeCloseTo(0, 6);
});

it("reflects the ball off the far side wall", async () => {
  const { engine } = harness;
  harness.setBallPosition(0, 0);
  harness.setBallVelocity(0, 4);

  await engine.advance(120);

  const { ball } = harness.snapshot();
  expect(ball.vz).toBe(-4);
  expect(ball.z).toBeLessThanOrEqual(COURT_DEPTH / 2 - BALL_RADIUS);
  expect(harness.assetFailures).toEqual([]);
});
```

Thirty frames of `1000 / 60` milliseconds are half a second exactly, so the ball
travels 2 units and the frame counter reads 30. Two seconds is 120 frames, and
the ball has 4.6 units to cover before its edge meets the wall at `5 - 0.4`, so
the reflection has happened and the velocity along `z` has turned over. Each
snapshot is taken after the advance, so it reads the state that frame left
rather than the one the pose built.

## Asserting a cue played

`engine.events.on` returns the function that removes the handler. A check
subscribes, runs the scenario, and asserts against what the handler collected.
The payload carries `at`, the world point the cue was placed at, so a cue the
case fixes as positional is checked for where it sounded beside when.

```ts
// validation/audio.test.ts
import { ConstantClock, type Vec3 } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_RADIUS, COURT_DEPTH, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("plays the bounce cue at the ball when it meets a wall", async () => {
  const { engine } = harness;
  const bounces: { t: number; gain: number; at: Vec3 | null }[] = [];
  const off = engine.events.on("cue:played", ({ cue, t, gain, at }) => {
    if (cue === "bounce") bounces.push({ t, gain, at });
  });

  harness.setBallPosition(0, 0);
  harness.setBallVelocity(0, 4);
  await engine.advance(120);
  off();

  expect(bounces).toHaveLength(1);
  expect(Math.abs(bounces[0].t - 1150)).toBeLessThanOrEqual(1000 / 60);
  expect(bounces[0].gain).toBeGreaterThan(0);

  const at = bounces[0].at;
  expect(at).not.toBeNull();
  const wall = COURT_DEPTH / 2 - BALL_RADIUS;
  expect(Math.abs((at as Vec3).z - wall)).toBeLessThanOrEqual(4 / 60);
  expect((at as Vec3).x).toBeCloseTo(0, 6);
});
```

The bounce is due at 1150 milliseconds, from 4.6 units at 4 units per second,
and it lands on the first frame whose step carries the ball to the wall. The
check therefore allows one step either side of the ideal instant and asserts the
count exactly, which is the part a step size cannot move. The same step bounds
the point: the ball is within one frame's travel of the wall when the cue
plays, so `at.z` is asserted within `4 / 60` of the wall's face.

`t` is the frame loop's simulated time, so the timestamp a check asserts against
is the time the clock delivered rather than the real time the suite took to run.

## Asserting the diagnostics a build registered

Registering the values the case names is the build's part. Drawing the panel,
toggling it, and keeping it read-only are the engine's, so a check reads
`engine.diagnostics()` and asserts the names the build registered and what each
one reports for a posed state.

```ts
// validation/diagnostics.test.ts
import { ConstantClock } from "@test-cabinet/simple-3d";
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
  harness.setBallPosition(3, -2);
  harness.setPaddle(1);

  expect(engine.diagnostics()).toEqual([
    { name: "ball", value: "3.0, -2.0" },
    { name: "paddle", value: 1 },
  ]);
});
```

The readings arrive in registration order, so one comparison covers the names,
their order, and what each source reports. Reading evaluates the sources and
changes nothing else, so a check reads them at any point in a scenario, and the
overlay stays hidden throughout.

## Asserting on the scene

`engine.scene` is the retained scene the build populates from `render`, live
and readable after any number of frames. A check finds an object by the name
the case fixes, reads its world position, and reads its material, which is how
a claim about what the build placed in the world is stated without a renderer.
`engine.view().camera()` is the camera's pose as it stood at the most recent
render, so the same check reads where the build put the camera.

```ts
// validation/scene.test.ts
import * as THREE from "three";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BALL_COLOR,
  BALL_RADIUS,
  PADDLE_COLOR,
  PADDLE_X,
  createHarness,
  type Harness,
} from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

type StandardMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function mesh(harness: Harness, name: string): StandardMesh {
  const object = harness.engine.scene.getObjectByName(name);
  expect(object).toBeInstanceOf(THREE.Mesh);
  return object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

it("places the ball and the paddle where the state says", async () => {
  const { engine } = harness;
  harness.setBallPosition(3, -2);
  harness.setBallVelocity(0, 0);
  harness.setPaddle(1);

  await engine.advance(1);

  const ball = mesh(harness, "ball").getWorldPosition(new THREE.Vector3());
  expect(ball.x).toBeCloseTo(3, 6);
  expect(ball.y).toBeCloseTo(BALL_RADIUS, 6);
  expect(ball.z).toBeCloseTo(-2, 6);

  const paddle = mesh(harness, "paddle").getWorldPosition(new THREE.Vector3());
  expect(paddle.x).toBeCloseTo(PADDLE_X, 6);
  expect(paddle.z).toBeCloseTo(1, 6);
});

it("colors the ball and the paddle as the case fixes", async () => {
  await harness.engine.advance(1);

  expect(`#${mesh(harness, "ball").material.color.getHexString()}`).toBe(BALL_COLOR);
  expect(`#${mesh(harness, "paddle").material.color.getHexString()}`).toBe(PADDLE_COLOR);
  expect(mesh(harness, "ball").geometry.getAttribute("position").count).toBeGreaterThan(0);
});

it("looks at the origin from where the case fixes", async () => {
  await harness.engine.advance(1);

  const camera = harness.engine.view().camera();
  expect(camera.projection).toBe("perspective");
  expect(camera.position.x).toBeCloseTo(0, 6);
  expect(camera.position.y).toBeCloseTo(14, 6);
  expect(camera.position.z).toBeCloseTo(10, 6);
});
```

The scene is read after one advance, because `render` is what places the
objects from the state and the pose alone changes nothing in the scene. The
engine updates world matrices after `render` returns, so `getWorldPosition`
answers with the position the frame drew whatever hierarchy the build hung the
mesh under. The material's color is read as the hex string three reports, which
is byte-exact against the color the case fixes.

The suite imports `three` for `Vector3` and the `Mesh` check, the same copy the
build and the engine share, so `instanceof` holds across the three.

## Asserting where something appears

`engine.view().project(point)` gives the logical stage point a world point
draws at, through the camera as it stood at the most recent render. A claim
about where something appears on screen is therefore checked without pixels,
against the same logical coordinates the screen layer draws in.

```ts
// validation/projection.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_RADIUS, FIELD_HEIGHT, FIELD_WIDTH, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("projects the origin to the centre of the stage", async () => {
  await harness.engine.advance(1);

  const origin = harness.project({ x: 0, y: 0, z: 0 });
  expect(origin.visible).toBe(true);
  expect(origin.x).toBeCloseTo(FIELD_WIDTH / 2, 3);
  expect(origin.y).toBeCloseTo(FIELD_HEIGHT / 2, 3);
  expect(origin.depth).toBeGreaterThan(-1);
  expect(origin.depth).toBeLessThan(1);
});

it("draws a ball on the right of the court on the right of the stage", async () => {
  const { engine } = harness;
  harness.setBallPosition(3, 0);
  harness.setBallVelocity(0, 0);
  await engine.advance(1);

  const ball = harness.project({ x: 3, y: BALL_RADIUS, z: 0 });
  expect(ball.visible).toBe(true);
  expect(ball.x).toBeGreaterThan(FIELD_WIDTH / 2);

  const behind = harness.project({ x: 0, y: 0, z: 40 });
  expect(behind.visible).toBe(false);
});
```

The camera looks at the origin, so the origin lies on the view axis and lands
at the exact centre of the design field, which is the one point a projection
check asserts to the digit. A ball at `x = 3` is to the camera's right and
projects right of centre, and a point at `z = 40` is behind a camera standing
at `z = 10`, which `visible` reports. The reading is taken after an advance,
because the view answers from the camera the most recent render posed, and
before the first render it answers from the camera defaults.

## Asserting what was drawn on the screen layer

Two readings of one frame answer two different questions. The pixels say what
ended up on the screen layer, and the draw-call stream says what the render
asked for. Both are about the HUD: the 3D picture has no pixels under
`headless`, and a claim about it is stated against the scene and the
projection above.

The canvas is 800 by 360 CSS pixels at a device pixel ratio of 2, so the fit
scales the 640 by 360 field by 2 and centres it in a 1600 by 720 backing store
with a 160 device pixel bar on each side. `getImageData` reads device pixels and
ignores the context transform, so the validator maps logical coordinates through
`engine.viewport()` itself, which `harness.pixel` does. The screen layer is
cleared to transparency at the top of every frame, so a pixel where the HUD
drew nothing reads as fully transparent and the scene shows through it.

Sample at least two logical units inside a shape, away from any text. Glyphs
depend on the font the machine resolved, so the panel's fill is what a pixel
asserts and the text is what the stream asserts.

```ts
// validation/hud.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  PANEL_COLOR,
  TEXT_COLOR,
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

it("fills the score panel and leaves the rest of the layer clear", async () => {
  const { engine } = harness;
  harness.setBallVelocity(0, 0);

  await engine.advance(1);

  expect(harness.device(0, 0)).toEqual({ x: 160, y: 0 });
  expect(harness.pixel(12, 12)).toEqual([28, 32, 51, 255]);
  expect(harness.pixel(124, 44)).toEqual([28, 32, 51, 255]);
  expect(harness.pixel(320, 180)).toEqual([0, 0, 0, 0]);
});

it("draws the panel as one rect and the score as one text", async () => {
  const { engine, calls } = harness;
  harness.setBallVelocity(0, 0);

  calls.length = 0;
  await engine.advance(1);

  expect(callsTo(calls, "fillRect")).toContainEqual([8, 8, 120, 40]);

  const texts = callsTo(calls, "fillText");
  expect(texts).toHaveLength(1);
  expect(texts[0]).toEqual(["score 0", 16, 32]);

  const colors = setsOf(calls, "fillStyle").filter(
    (color) => color === PANEL_COLOR || color === TEXT_COLOR,
  );
  expect(colors).toEqual([PANEL_COLOR, TEXT_COLOR]);
});
```

Clearing `calls` immediately before the frame keeps the stream to that one
frame. The stream also carries the engine's own clear and transform of the
screen layer, so a check names the calls the game made and keeps to the colors
the case fixes when it compares fill styles.

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
import { ConstantClock } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { COURT_DEPTH, PADDLE_LENGTH, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("moves the paddle toward the far wall while the up action is held", async () => {
  const { engine } = harness;
  harness.setPaddle(0);

  harness.hold("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.z).toBeCloseTo(-3, 3);

  harness.release("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.z).toBeCloseTo(-3, 3);
});

it("clamps the paddle at the far wall", async () => {
  const { engine } = harness;
  harness.setPaddle(0);

  harness.hold("ArrowUp");
  await engine.advance(120);

  expect(engine.state.paddle.z).toBeCloseTo(-(COURT_DEPTH / 2 - PADDLE_LENGTH / 2), 6);
});
```

Half a second at 6 units per second is 3 units, and releasing the key leaves
the paddle where it stopped. These checks read `engine.state` directly, which
is the route for a field the specification fixes on the state itself; each read
is of the value the latest frame left, so the two reads in the first check are
two different values. Holding for two seconds asks for 12 units of travel
against a court that allows 3.5, so the second check reads the clamp rather
than the speed.

`harness.tap` presses and releases between frames, which arms the action's edge
for the next frame. That is what a check of an edge-triggered action uses, since
the engine discards an edge nothing consumed at the end of the frame.

## Emitting a recording

A suite holds the engine, so it captures the stretch of a scenario its check is
about and hands the frames to the reviewer as the verdict's media. The
[recorder](/engines/simple-3d/apis/recording/) keeps the scene as the build
submitted it, as draws, lights, scene settings, and a camera, together with the
screen layer's operations, and it captures identically under `headless`, so the
recording a validator emits is the one the same frames would have produced in a
browser. `stopRecording` returns a `Recording` holding the document, the buffers
the frames name by span, the embedded maps, and every asset the recorded frames
reference, and `packRecording` builds the `.replay` archive from it. The verdict
unit declares the output as `kind = "replay"` in the case
[manifest](/testing/end-to-end/manifests/), and the suite writes it where the
[validators](/engines/simple-3d/validators/recording/) page specifies.

```ts
// validation/replay.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { packRecording, type Recording } from "@test-cabinet/simple-3d";

const WORKSPACE = fileURLToPath(new URL("..", import.meta.url));

export function emitReplay(
  suite: string,
  output: string,
  recording: Recording,
): void {
  const dir = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (dir === undefined) return;
  if (recording.document.frames.length === 0) return;

  const staged = relative(WORKSPACE, fileURLToPath(suite));
  const target = join(dir, staged, `${output}.replay`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, packRecording(recording));
}
```

The check arms the recorder once the scenario is posed and disarms it once the
behavior has happened, so the evidence opens on the situation the requirement
describes. The recording is emitted before the assertions run, and the same
document is asserted on, since a frame's `draws`, `lights`, and `camera` are
the scene as submitted.

```ts
// validation/recording.test.ts
import { ConstantClock, RECORDING_FORMAT } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_COLOR, FIELD_HEIGHT, FIELD_WIDTH, createHarness, type Harness } from "./harness";
import { emitReplay } from "./replay";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("records the frames around a wall reflection", async () => {
  const { engine } = harness;
  harness.setBallPosition(0, 3);
  harness.setBallVelocity(0, 4);
  await engine.advance(12);

  engine.startRecording();
  await engine.advance(24);
  const recording = engine.stopRecording();
  emitReplay(import.meta.url, "bounce", recording);

  const { document } = recording;
  expect(document.format).toBe(RECORDING_FORMAT);
  expect(document.width).toBe(FIELD_WIDTH);
  expect(document.height).toBe(FIELD_HEIGHT);
  expect(document.frames).toHaveLength(24);
  expect(document.frames[0].count).toBe(13);
  expect(document.ended).toBeUndefined();

  for (const frame of document.frames) {
    expect(frame.draws).toHaveLength(3);
    expect(frame.lights).toHaveLength(1);
    expect(document.cameras[frame.camera].projection).toBe("perspective");
    expect(frame.screen.ops.length).toBeGreaterThan(0);
  }
  expect(document.materials.map((material) => material.color)).toContain(BALL_COLOR);
  expect(harness.snapshot().ball.vz).toBe(-4);
});
```

The ball starts 1.6 units from the wall at 4 units per second, so the
reflection falls 0.4 seconds in, which is the twenty-fourth frame from the pose
and the twelfth of the recording. Capture begins at the frame after
`startRecording`, so twenty-four advances are twenty-four frames, counted from
13, and an absent `ended` mark states that every one of them was held within
the archive's budgets. Every frame submits the court, the ball, and the paddle
as three draws under one light through a perspective camera, and the ball's
material is in the material table under the color the case fixes.

The recording is written only when `TCAB_VALIDATION_MEDIA_DIR` is set, which
the runner does and a local `vitest run` does not, so the suite's assertions
are the whole of a run by hand. Call `stopRecording` on every path that armed
the recorder, because the engine refuses an unbalanced call rather than
discarding the frames the check was about.
