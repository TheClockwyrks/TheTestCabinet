---
title: Validating a Game
---

A case's validators are vitest suites that run in the same process as the build.
A suite imports the engine and the build's own game module, creates an engine
over a canvas it owns and a clock it chose, and steps the game with
`engine.advance`. A check poses its scenario through `engine.apply` and reads
the outcome back through `engine.state`, both routed through the build's debug
surface; everything else it reads is an engine surface: the frame counter, the
events the engine broadcast, and the recording of what the render drew.

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
import type { Game, Vec3 } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

export interface Ball {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface State {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
}

export interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
}

export interface Debug {
  setBall(state: DeepReadonly<State>, ball: Partial<Ball>): State;
  setPaddle(state: DeepReadonly<State>, z: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

export declare const game: Game<State, Debug>;
```

The build's own implementation of the surface is three pure functions.

```ts
// src/debug.ts, as the build writes it
import type { Debug } from "./game";

export const debug: Debug = {
  setBall: (state, ball) => ({ ...state, ball: { ...state.ball, ...ball } }),
  setPaddle: (state, z) => ({ ...state, paddle: { z } }),
  snapshot: (state) => ({
    ball: {
      position: { ...state.ball.position },
      velocity: { ...state.ball.velocity },
    },
    paddle: { ...state.paddle },
  }),
};
```

| Figure | Value |
| --- | --- |
| Logical design size | `640 × 360` |
| Background | `#101018` |
| Court | A floor plane with walls at `x = ±8` and `z = ±4.5` in world units, drawn in `#182231` |
| Ball | A sphere of radius `0.5` rolling at height `0.5`, drawn in `#f45b69`, reflected by every wall |
| Paddle | A `0.5 × 1 × 3` box at `x = -7`, drawn in `#e8e8e8`, moving at `3` units per second along `z` and clamped to the court |
| Camera | Position `(0, 14, 0)`, pitched straight down (`quatFromAxisAngle` about `+X` by `-π/2`), `fovY` `π/3`, `near` `0.1`, `far` `100` |
| Actions | `up` bound to `KeyW` and `ArrowUp`, `down` bound to `KeyS` and `ArrowDown` |
| Cues | `bounce`, played on the frame a wall reflects the ball |

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
`@test-cabinet/headless-webgl2` serves a canvas whose WebGL2 context is
implemented natively, which is what lets the engine construct in Node exactly
as `@napi-rs/canvas` serves the 2D engine's context.

```json
{
  "devDependencies": {
    "@test-cabinet/headless-webgl2": "^0.1",
    "vitest": "^3"
  }
}
```

## The harness

Every validator builds its engine through one helper. It creates a WebGL2
canvas, supplies a `SurfaceMetrics` so the engine takes every measurement from
the harness instead of from a document, subscribes to `asset:failed` before any
game code runs, and then initializes. It also wraps the build's pure surface
over the engine, so a check writes `harness.setBall(…)` and
`harness.snapshot()` and the harness routes the pose through `engine.apply` and
the reading through `engine.state`.

```ts
// validation/harness.ts
import { createCanvas } from "@test-cabinet/headless-webgl2";
import {
  ConstantClock,
  createEngine,
  projectPoint,
  quatFromAxisAngle,
  type CameraState,
  type Clock,
  type DrawValue,
  type Engine,
  type Recording,
  type SurfaceMetrics,
  type Vec2,
  type Vec3,
  type Viewport,
} from "@test-cabinet/simple-3d";
import { game, type Ball, type Debug, type Snapshot, type State } from "../src/game";

// The figures the case's specification fixes.
export const FIELD_WIDTH = 640;
export const FIELD_HEIGHT = 360;
export const BACKGROUND = "#101018";
export const BALL_RADIUS = 0.5;
export const BALL_COLOR = "#f45b69";
export const WALL_X = 8;
export const WALL_Z = 4.5;
export const PADDLE_X = -7;
export const PADDLE_COLOR = "#e8e8e8";
export const PADDLE_HALF_LENGTH = 1.5;
export const PADDLE_SPEED = 3;

export const CAMERA: CameraState = {
  position: { x: 0, y: 14, z: 0 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

export interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

export interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly assetFailures: string[];
  setBall(ball: Partial<Ball>): void;
  setPaddle(z: number): void;
  snapshot(): Snapshot;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  record(frames: number): Promise<Recording>;
  project(point: Vec3): Vec2 | null;
  device(x: number, y: number): { x: number; y: number };
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

export function callsTo(
  recording: Recording,
  method: string,
): readonly (readonly DrawValue[])[] {
  return recording.frames.flatMap((frame) =>
    frame.ops.flatMap((index) => {
      const op = recording.ops[index];
      return op.op === "call" && op.method === method ? [op.args] : [];
    }),
  );
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_WIDTH;
  const cssHeight = options.cssHeight ?? FIELD_HEIGHT;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<State, Debug>({
    canvas: canvas as unknown as HTMLCanvasElement,
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
    assetFailures,
    setBall: (ball) => engine.apply((s) => engine.debug.setBall(s, ball)),
    setPaddle: (z) => engine.apply((s) => engine.debug.setPaddle(s, z)),
    snapshot: () => engine.debug.snapshot(engine.state),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    record: async (frames) => {
      engine.startRecording();
      await engine.advance(frames);
      return engine.stopRecording();
    },
    project: (point) => projectPoint(CAMERA, engine.viewport(), point),
    device: (x, y) => toDevice(engine.viewport(), x, y),
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

There is no recording proxy over the drawing surface. The scene context is
engine-owned and records itself, so `record` brackets a stretch of frames
through the engine's own members: arming begins capture at the next frame, the
advance runs exactly the frames the recording holds, and `stopRecording` hands
back the document. `callsTo` then reads the operations out of the shared `ops`
table by the indices each frame carries.

`setBall`, `setPaddle`, and `snapshot` are the surface wrapped over the engine.
A pose is `engine.apply((s) => engine.debug.setBall(s, ball))`: the engine hands
the current state to the transition, keeps the state it returns, and the next
frame's `update` receives it. A reading is
`engine.debug.snapshot(engine.state)`, a plain value taken from the state the
most recent frame left. A check that wants the state itself reads
`engine.state`, which is a `DeepReadonly` view of the same value.

Subscribing before `engine.initialize()` is what makes an asset failure
visible. Construction runs no game code, so the handler is attached in time to
observe the game's own initialization, and a build whose assets never arrive
reports that directly rather than as a wrong-drawing failure. A suite whose
build loads assets installs a `fetch` that serves the seeded asset directory
from disk, so every path resolving under `assetRoot` arrives in process.

## Stepping the simulation

A [`ConstantClock`](/engines/simple-3d/apis/clocks/) makes each frame worth a
known step, so a duration is a frame count and the arithmetic a check asserts is
the arithmetic the specification states. The validator poses the scenario
through the surface, advances, and reads a snapshot back.

```ts
// validation/simulation.test.ts
import { ConstantClock } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_RADIUS, WALL_X, createHarness, type Harness } from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("carries the ball at 4 units per second", async () => {
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(30);

  const { ball } = harness.snapshot();
  expect(engine.frame().count).toBe(30);
  expect(engine.frame().timeMs).toBeCloseTo(500, 6);
  expect(ball.position.x).toBeCloseTo(2, 3);
  expect(ball.position.z).toBeCloseTo(0, 6);
});

it("reflects the ball off the far wall", async () => {
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(120);

  const { ball } = harness.snapshot();
  expect(ball.velocity.x).toBe(-4);
  expect(ball.position.x).toBeLessThanOrEqual(WALL_X - BALL_RADIUS);
  expect(harness.assetFailures).toEqual([]);
});
```

Thirty frames of `1000 / 60` milliseconds are half a second exactly, so the
ball travels 2 world units and the frame counter reads 30. Two seconds is 120
frames, and the ball has 7.5 units to cover before its edge meets the wall at
`8 - 0.5`, so the reflection has happened and the horizontal velocity has
turned over. Each snapshot is taken after the advance, so it reads the state
that frame left rather than the one the pose built.

## Asserting a cue played

`engine.events.on` returns the function that removes the handler. A check
subscribes, runs the scenario, and asserts against what the handler collected.

```ts
// validation/audio.test.ts
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

it("plays the bounce cue when the ball meets a wall", async () => {
  const { engine } = harness;
  const bounces: { t: number; gain: number }[] = [];
  const off = engine.events.on("cue:played", ({ cue, t, gain }) => {
    if (cue === "bounce") bounces.push({ t, gain });
  });

  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });
  await engine.advance(150);
  off();

  expect(bounces).toHaveLength(1);
  expect(Math.abs(bounces[0].t - 1875)).toBeLessThanOrEqual(1000 / 60);
  expect(bounces[0].gain).toBeGreaterThan(0);
});
```

The bounce is due at 1875 milliseconds, from 7.5 units at 4 units per second,
and it lands on the first frame whose step carries the ball to the wall. The
check therefore allows one step either side of the ideal instant and asserts
the count exactly, which is the part a step size cannot move.

`t` is the frame loop's simulated time, so the timestamp a check asserts against
is the time the clock delivered rather than the real time the suite took to run.

## Asserting what was drawn

Two readings of one frame answer two different questions. The recording says
what the render asked for, and `projectPoint` composed with the viewport
equations says which device pixel a world point landed on. Both are values a
check states exactly, with no pixel sampling and no anti-aliasing allowance.

The canvas is 800 by 360 CSS pixels at a device pixel ratio of 2, so the fit
scales the 640 by 360 field by 2 and centres it in a 1600 by 720 backing store
with a 160 device pixel bar on each side. The camera looks straight down from
`(0, 14, 0)`, so the world origin projects to the middle of the logical field
and `harness.device` carries that point on into the backing store.

```ts
// validation/drawing.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BALL_COLOR,
  BALL_RADIUS,
  PADDLE_COLOR,
  PADDLE_X,
  callsTo,
  createHarness,
  type Harness,
} from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
});

afterEach(() => {
  harness.dispose();
});

it("draws the ball as one sphere and the paddle at its post", async () => {
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  });
  harness.setPaddle(0);

  const recording = await harness.record(1);

  const spheres = recording.resources.filter(
    (resource) => resource.make.method === "createSphere",
  );
  expect(spheres).toHaveLength(1);
  expect(spheres[0].make.args).toEqual([BALL_RADIUS]);

  const draws = callsTo(recording, "drawGeometry");
  const ball = draws.find((args) => args[1] === BALL_COLOR);
  const paddle = draws.find((args) => args[1] === PADDLE_COLOR);
  expect(ball?.[2]).toMatchObject({ position: { x: 0, y: 0.5, z: 0 } });
  expect(paddle?.[2]).toMatchObject({ position: { x: PADDLE_X, y: 0.5, z: 0 } });

  const cameras = callsTo(recording, "setCamera");
  expect(cameras.at(-1)?.[0]).toMatchObject({ position: { x: 0, y: 14, z: 0 } });
});

it("projects the ball's center to the middle of the field", async () => {
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  });

  await harness.engine.advance(1);

  const center = harness.project({ x: 0, y: 0.5, z: 0 });
  expect(center?.x).toBeCloseTo(320, 6);
  expect(center?.y).toBeCloseTo(180, 6);
  expect(harness.device(0, 0)).toEqual({ x: 160, y: 0 });
  expect(harness.device(320, 180)).toEqual({ x: 800, y: 360 });
});
```

The first check reads the recording alone. The build creates its sphere through
the scene context every frame, and identical arguments share one resource
entry, so one recorded frame holds exactly one `createSphere` recipe; the
`drawGeometry` operations carry the material and the full world transform each
draw named, and the `setCamera` operation carries the camera the specification
fixes. A geometry argument appears as its `$res` reference, which is why the
checks name the color and the transform positions rather than the whole args
array.

The second check is the two-stage pixel composition: `projectPoint` maps a
world point into logical coordinates under the case's camera and the engine's
viewport, and the viewport equations map logical to device. A check that needs
the device pixel a draw landed on composes the two, and the recording is also
what a suite hands the reviewer as
[replay media](/engines/simple-3d/apis/recording/).

## Asserting an action drives the game

Dispatching a key event on the surface's event target sets the action the game
bound that key to, and the game reads it through `api.input` on the next frame.
The check holds the key, advances a known duration, and asserts the distance the
specification states.

```ts
// validation/input.test.ts
import { ConstantClock } from "@test-cabinet/simple-3d";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  PADDLE_HALF_LENGTH,
  WALL_Z,
  createHarness,
  type Harness,
} from "./harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
});

afterEach(() => {
  harness.dispose();
});

it("slides the paddle while the up action is held", async () => {
  const { engine } = harness;
  harness.setPaddle(0);

  harness.hold("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.z).toBeCloseTo(-1.5, 3);

  harness.release("KeyW");
  await engine.advance(30);
  expect(engine.state.paddle.z).toBeCloseTo(-1.5, 3);
});

it("clamps the paddle at the edge of the court", async () => {
  const { engine } = harness;
  harness.setPaddle(0);

  harness.hold("ArrowUp");
  await engine.advance(120);

  expect(engine.state.paddle.z).toBeCloseTo(-(WALL_Z - PADDLE_HALF_LENGTH), 6);
});
```

Under the straight-down camera, up the screen is `-Z` in the world, so the `up`
action lowers `z`. Half a second at 3 units per second is 1.5 units, and
releasing the key leaves the paddle where it stopped. These checks read
`engine.state` directly, which is the route for a field the specification fixes
on the state itself; each read is of the value the latest frame left, so the
two reads in the first check are two different values. Holding for two seconds
asks for 6 units of travel against a court that allows 3, so the second check
reads the clamp rather than the speed.

`harness.tap` presses and releases between frames, which arms the action's edge
for the next frame. That is what a check of an edge-triggered action uses, since
the engine discards an edge nothing consumed at the end of the frame.
