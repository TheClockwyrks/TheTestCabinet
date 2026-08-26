import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConstantClock,
  SequenceClock,
  createEngine,
  projectPoint,
  quatFromAxisAngle,
  type CameraState,
  type Clock,
  type DrawValue,
  type Engine,
  type Game,
  type InitApi,
  type LightState,
  type Quat,
  type Recording,
  type RenderApi,
  type SurfaceMetrics,
  type Transform,
  type UpdateApi,
  type Vec2,
  type Vec3,
  type Viewport,
} from "./index";
import type { DeepReadonly } from "ts-essentials";

/**
 * The documentation's worked example "Validating a Game", transcribed and run.
 *
 * The page prints the case's specification, the build's own debug surface, the
 * harness every validator constructs its engine through, and four validator
 * suites, and promises they work against the engine verbatim. All of it is
 * carried below as literally as one test module allows. Only what a test
 * environment forces is adapted:
 *
 * - The page fixes the case's figures but leaves the build's own source — the
 *   physics, the game module, and the debug implementation's caller — to the
 *   model under test. A reference build of that case is written below, from the
 *   page's table and its narration.
 * - The example is a seeded workspace of several modules under `src/` and
 *   `validation/`; here everything lives in this one module, so the types the
 *   page declares once in `src/game.ts` are declared once here, and imports
 *   name this package's own entry point rather than the published specifier.
 * - The harness defaults its element size to the design size. The rasterizer's
 *   cost is per device pixel, and only the drawing suite reads a pixel figure —
 *   and it names its own size, exactly as the page's `drawing.test.ts` does. So
 *   the default becomes a smaller element of the design aspect, which changes
 *   the scale of the fit and no figure any other check asserts.
 * - The suites' `beforeEach`/`afterEach` are shared by the four `describe`
 *   blocks below rather than repeated at four module scopes.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — the types, as a validator sees them                          */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* src/debug.ts — transcribed verbatim                                        */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* The build under test: the reference build of the case's table              */
/* -------------------------------------------------------------------------- */

// | Court  | A floor plane with walls at `x = ±8` and `z = ±4.5` in world
// |        | units, drawn in `#182231`
// | Ball   | A sphere of radius `0.5` rolling at height `0.5`, drawn in
// |        | `#f45b69`, reflected by every wall
// | Paddle | A `0.5 × 1 × 3` box at `x = -7`, drawn in `#e8e8e8`, moving at `3`
// |        | units per second along `z` and clamped to the court
// | Actions| `up` bound to `KeyW` and `ArrowUp`, `down` to `KeyS`/`ArrowDown`
// | Cues   | `bounce`, played on the frame a wall reflects the ball

const COURT_COLOR = "#182231";
const BALL_HEIGHT = 0.5;
const WALL_THICKNESS = 0.5;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const BUILD_LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.4 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.85,
    direction: { x: -0.3, y: -1, z: -0.2 },
  },
];

function place(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: IDENTITY, scale: ONE };
}

/** One axis of the ball, reflected off its wall with the overshoot folded back. */
function reflect(
  p: number,
  v: number,
  limit: number,
): { p: number; v: number; hit: boolean } {
  const edge = limit - BALL_RADIUS;
  if (p < -edge) return { p: -2 * edge - p, v: -v, hit: true };
  if (p > edge) return { p: 2 * edge - p, v: -v, hit: true };
  return { p, v, hit: false };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

const game: Game<State, Debug> = {
  initialize(api: InitApi<State>): [State, Debug] {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });
    api.audio.define("bounce", { freq: 520, freqTo: 320, durationMs: 90 });

    return [
      {
        ball: {
          position: { x: 0, y: BALL_HEIGHT, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
        paddle: { z: 0 },
      },
      debug,
    ];
  },

  update(state: DeepReadonly<State>, api: UpdateApi, dt: number): State {
    const steer = api.input.value("down") - api.input.value("up");
    const reach = WALL_Z - PADDLE_HALF_LENGTH;
    const z = clamp(state.paddle.z + steer * PADDLE_SPEED * dt, -reach, reach);

    const ball = state.ball;
    const x = reflect(
      ball.position.x + ball.velocity.x * dt,
      ball.velocity.x,
      WALL_X,
    );
    const depth = reflect(
      ball.position.z + ball.velocity.z * dt,
      ball.velocity.z,
      WALL_Z,
    );
    if (x.hit || depth.hit) api.audio.play("bounce");

    return {
      ball: {
        position: { x: x.p, y: ball.position.y, z: depth.p },
        velocity: { x: x.v, y: ball.velocity.y, z: depth.v },
      },
      paddle: { z },
    };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(BUILD_LIGHTS);

    scene.drawGeometry(
      scene.createPlane(2 * WALL_X, 2 * WALL_Z),
      COURT_COLOR,
      place(0, 0, 0),
    );

    const side = scene.createBox({ x: WALL_THICKNESS, y: 1, z: 2 * WALL_Z });
    scene.drawGeometry(
      side,
      COURT_COLOR,
      place(-WALL_X - WALL_THICKNESS / 2, 0.5, 0),
    );
    scene.drawGeometry(
      side,
      COURT_COLOR,
      place(WALL_X + WALL_THICKNESS / 2, 0.5, 0),
    );

    const end = scene.createBox({ x: 2 * WALL_X, y: 1, z: WALL_THICKNESS });
    scene.drawGeometry(
      end,
      COURT_COLOR,
      place(0, 0.5, -WALL_Z - WALL_THICKNESS / 2),
    );
    scene.drawGeometry(
      end,
      COURT_COLOR,
      place(0, 0.5, WALL_Z + WALL_THICKNESS / 2),
    );

    scene.drawGeometry(
      scene.createBox({ x: 0.5, y: 1, z: 3 }),
      PADDLE_COLOR,
      place(PADDLE_X, 0.5, state.paddle.z),
    );

    scene.drawGeometry(
      scene.createSphere(BALL_RADIUS),
      BALL_COLOR,
      place(
        state.ball.position.x,
        state.ball.position.y,
        state.ball.position.z,
      ),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — transcribed, with the forced adaptations           */
/* -------------------------------------------------------------------------- */

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

/**
 * The element size a check gets when it names none. The page's harness defaults
 * to the design size; the suites that do not read a device figure pay the
 * rasterizer per device pixel for a picture they never look at, so the default
 * is a smaller element of the same aspect. The design size below is untouched.
 */
const PROBE_WIDTH = 160;
const PROBE_HEIGHT = 90;

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

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
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
      return op?.op === "call" && op.method === method ? [op.args] : [];
    }),
  );
}

export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? PROBE_WIDTH;
  const cssHeight = options.cssHeight ?? PROBE_HEIGHT;
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

/* -------------------------------------------------------------------------- */
/* validation/simulation.test.ts                                              */
/* -------------------------------------------------------------------------- */

describe("stepping the simulation", () => {
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
});

/* -------------------------------------------------------------------------- */
/* validation/audio.test.ts                                                   */
/* -------------------------------------------------------------------------- */

describe("asserting a cue played", () => {
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
    const bounce = bounces[0];
    expect(bounce).toBeDefined();
    expect(Math.abs((bounce?.t ?? 0) - 1875)).toBeLessThanOrEqual(1000 / 60);
    expect(bounce?.gain).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/drawing.test.ts                                                 */
/* -------------------------------------------------------------------------- */

describe("asserting what was drawn", () => {
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
    expect(spheres[0]?.make.args).toEqual([BALL_RADIUS]);

    const draws = callsTo(recording, "drawGeometry");
    const ball = draws.find((args) => args[1] === BALL_COLOR);
    const paddle = draws.find((args) => args[1] === PADDLE_COLOR);
    expect(ball?.[2]).toMatchObject({ position: { x: 0, y: 0.5, z: 0 } });
    expect(paddle?.[2]).toMatchObject({
      position: { x: PADDLE_X, y: 0.5, z: 0 },
    });

    const cameras = callsTo(recording, "setCamera");
    expect(cameras.at(-1)?.[0]).toMatchObject({
      position: { x: 0, y: 14, z: 0 },
    });
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
});

/* -------------------------------------------------------------------------- */
/* validation/input.test.ts                                                   */
/* -------------------------------------------------------------------------- */

describe("asserting an action drives the game", () => {
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

    expect(engine.state.paddle.z).toBeCloseTo(
      -(WALL_Z - PADDLE_HALF_LENGTH),
      6,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

describe("examples/validating-a-game", () => {
  let harness: Harness;

  afterEach(() => {
    harness.dispose();
  });

  it("routes a pose through apply and a reading through state", async () => {
    harness = await createHarness();
    const { engine } = harness;

    // "A pose is `engine.apply((s) => engine.debug.setBall(s, ball))`: the
    // engine hands the current state to the transition, keeps the state it
    // returns, and the next frame's `update` receives it."
    harness.setBall({
      position: { x: 3, y: 0.5, z: -1 },
      velocity: { x: 4, y: 0, z: 0 },
    });
    expect(engine.state.ball.position).toEqual({ x: 3, y: 0.5, z: -1 });

    // "A reading is `engine.debug.snapshot(engine.state)`, a plain value taken
    // from the state the most recent frame left." It is a copy: writing to it
    // reaches nothing.
    const before = harness.snapshot();
    before.ball.position.x = 99;
    expect(engine.state.ball.position.x).toBe(3);

    // "Each snapshot is taken after the advance, so it reads the state that
    // frame left rather than the one the pose built."
    await engine.advance(30);
    expect(harness.snapshot().ball.position.x).toBeCloseTo(5, 3);
    expect(before.ball.position.z).toBe(-1);
  });

  it("subscribes before initialize, which is what makes an asset failure visible", async () => {
    // "Construction runs no game code, so the handler is attached in time to
    // observe the game's own initialization." The harness's own subscription is
    // the proof; this build loads nothing, so it reports nothing.
    harness = await createHarness();
    expect(harness.assetFailures).toEqual([]);
    expect(harness.engine.frame().count).toBe(0);
  });

  it("brackets a stretch of frames through the engine's own members", async () => {
    harness = await createHarness();
    const { engine } = harness;

    // "There is no recording proxy over the drawing surface. The scene context
    // is engine-owned and records itself." Arming begins capture at the *next*
    // frame, so the frames already run are not in the document.
    await engine.advance(2);
    expect(engine.recording()).toBe(false);

    const recording = await harness.record(3);
    expect(engine.recording()).toBe(false);
    expect(recording.frames.map((frame) => frame.count)).toEqual([3, 4, 5]);

    // The envelope is the design size and the background the case fixes, and
    // the document routes to the 3D drawer.
    expect(recording.space).toBe("3d");
    expect(recording.width).toBe(FIELD_WIDTH);
    expect(recording.height).toBe(FIELD_HEIGHT);
    expect(recording.background).toBe(BACKGROUND);

    // "`callsTo` then reads the operations out of the shared `ops` table by the
    // indices each frame carries" — every index a frame names is in the table.
    for (const frame of recording.frames) {
      for (const index of frame.ops) expect(recording.ops[index]).toBeDefined();
    }
  });

  it("carries a geometry argument as its $res reference, shared across frames", async () => {
    harness = await createHarness();

    harness.setBall({
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
    });
    const recording = await harness.record(4);

    // "The build creates its sphere through the scene context every frame, and
    // identical arguments share one resource entry" — four frames, four calls,
    // one entry. "A geometry argument appears as its `$res` reference, which is
    // why the checks name the color and the transform positions rather than the
    // whole args array."
    const index = recording.resources.findIndex(
      (resource) => resource.make.method === "createSphere",
    );
    expect(
      recording.resources.filter((r) => r.make.method === "createSphere"),
    ).toHaveLength(1);

    const balls = callsTo(recording, "drawGeometry").filter(
      (args) => args[1] === BALL_COLOR,
    );
    expect(balls).toHaveLength(4);
    expect(balls.map((args) => args[0])).toEqual(
      Array.from({ length: 4 }, () => ({ $res: index })),
    );
  });

  it("stamps a cue with the simulated time the clock delivered, not the wall time", async () => {
    // "`t` is the frame loop's simulated time, so the timestamp a check asserts
    // against is the time the clock delivered rather than the real time the
    // suite took to run." The same scenario under an uneven pattern lands the
    // bounce within one of *that* clock's steps of the same ideal instant.
    harness = await createHarness({
      clock: new SequenceClock([4, 4, 4, 4, 33, 16]),
    });
    const { engine } = harness;

    const bounces: number[] = [];
    engine.events.on("cue:played", ({ cue, t }) => {
      if (cue === "bounce") bounces.push(t);
    });

    harness.setBall({
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
    });
    while (engine.frame().timeMs < 2_500) await engine.advance(1);

    expect(bounces).toHaveLength(1);
    const bounce = bounces[0];
    expect(bounce).toBeDefined();
    expect(Math.abs((bounce ?? 0) - 1875)).toBeLessThanOrEqual(33);
    // Every step this clock delivers is a whole millisecond, so the stamp is a
    // sum of them — which no reading of the wall clock would be.
    expect(Number.isInteger(bounce)).toBe(true);
    expect(bounce).toBeLessThanOrEqual(engine.frame().timeMs);
  });

  it("puts the same picture in the same place whatever the element reports", async () => {
    // "The options the validator passes to `createEngine` are the ones the
    // case's specification fixes: the design size and the background." The
    // frustum's aspect is the design aspect, so the projected point is the same
    // logical point on every rig, and only the device mapping differs.
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
    const wide = harness.project({ x: 0, y: 0.5, z: 0 });
    const wideDevice = harness.device(320, 180);
    harness.dispose();

    harness = await createHarness({ cssWidth: 320, cssHeight: 180, dpr: 1 });
    expect(harness.project({ x: 0, y: 0.5, z: 0 })).toEqual(wide);
    // Half the scale, no bars: the same logical center, a different pixel.
    expect(harness.device(320, 180)).toEqual({ x: 160, y: 90 });
    expect(wideDevice).toEqual({ x: 800, y: 360 });
  });

  it("letterboxes the field rather than reshaping the picture", async () => {
    // "The canvas is 800 by 360 CSS pixels at a device pixel ratio of 2, so the
    // fit scales the 640 by 360 field by 2 and centres it in a 1600 by 720
    // backing store with a 160 device pixel bar on each side."
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
    const view = harness.engine.viewport();

    expect(view.width).toBe(FIELD_WIDTH);
    expect(view.height).toBe(FIELD_HEIGHT);
    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(160);
    expect(view.offsetY).toBe(0);
    expect(harness.device(FIELD_WIDTH, FIELD_HEIGHT)).toEqual({
      x: 1440,
      y: 720,
    });
  });
});
