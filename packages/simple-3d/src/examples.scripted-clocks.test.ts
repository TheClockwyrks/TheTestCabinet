import { createCanvas } from "@test-cabinet/headless-webgl2";
import { describe, expect, it } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  createEngine,
  quatFromAxisAngle,
  type CameraState,
  type Clock,
  type Engine,
  type Game,
  type InitApi,
  type LightState,
  type Quat,
  type RenderApi,
  type SurfaceMetrics,
  type Transform,
  type UpdateApi,
  type Vec3,
} from "./index";
import type { DeepReadonly } from "ts-essentials";

/**
 * The documentation's worked example "Scripted Clocks", transcribed and run.
 *
 * Every example on the page is a validator suite over the case the "Validating
 * a Game" page builds, constructed through that page's harness, and both pages
 * promise their code works against the engine verbatim. So this file carries all
 * of it: the case's types and debug surface as that page prints them, a
 * reference build of the case's figures table, the harness, and then the
 * scripted-clocks suites exactly as this page writes them. Only what a test
 * environment forces is adapted:
 *
 * - The page's suites import the harness across modules — `./harness`,
 *   `./advance-ms`, `../src/game` — and name the published specifier
 *   `@test-cabinet/simple-3d`. Here everything is one module, so the shared
 *   pieces are declared once in their own sections below and imports name this
 *   package's own entry point.
 * - The harness keeps only the members this page's checks call. Nothing here
 *   reads a pixel, a recording, or an action, so `record`, `project`, `device`,
 *   and the key dispatchers are dropped rather than carried unused, and the
 *   element size defaults to a smaller element of the design aspect: the
 *   rasterizer's cost is per device pixel, these checks step thousands of
 *   frames, and the fit's scale is not a figure any of them assert. The design
 *   size handed to `createEngine` is untouched.
 * - The heavy checks carry an explicit vitest timeout, as the sibling suite's
 *   do and for the same reason only: a check that steps a full scenario runs
 *   for seconds against a software rasterizer, and the whole workspace's
 *   suites run at once. The timeout bounds how long a check may take; it
 *   changes nothing a check asserts.
 * - The build's own source is the model's under test on the page, which fixes
 *   only the case's figures; the reference build below is written from that
 *   table and is the same one the "Validating a Game" transcription runs.
 *
 * The assertions beyond the page's own are the outcomes it narrates: that a
 * frame count fixes a duration only under a constant step, that `advanceMs`
 * overshoots its target by less than one step, that `setClock` swaps the clock
 * in place while the frame counter and the accumulated time carry over, and that
 * the three clocks reach positions inside the band the page allows for rather
 * than the same number.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — the types, as a validator sees them                          */
/* -------------------------------------------------------------------------- */

interface Ball {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

interface State {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
}

interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
}

interface Debug {
  setBall(state: DeepReadonly<State>, ball: Partial<Ball>): State;
  setPaddle(state: DeepReadonly<State>, z: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

/* -------------------------------------------------------------------------- */
/* src/debug.ts — transcribed verbatim                                        */
/* -------------------------------------------------------------------------- */

const debug: Debug = {
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
const FIELD_WIDTH = 640;
const FIELD_HEIGHT = 360;
const BACKGROUND = "#101018";
const BALL_RADIUS = 0.5;
const BALL_COLOR = "#f45b69";
const WALL_X = 8;
const WALL_Z = 4.5;
const PADDLE_X = -7;
const PADDLE_COLOR = "#e8e8e8";
const PADDLE_HALF_LENGTH = 1.5;
const PADDLE_SPEED = 3;

const CAMERA: CameraState = {
  position: { x: 0, y: 14, z: 0 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

/**
 * The element size a check gets when it names none. The page's harness defaults
 * to the design size; every check on this page steps its scenario for seconds of
 * simulated time — thousands of frames across the file — and none of them looks
 * at the picture. The rasterizer's cost is per device pixel, so the default is a
 * small element of the same aspect and the whole suite is paid for at a fraction
 * of the fill. The design size handed to `createEngine` is untouched, so every
 * figure these checks assert — a world distance, a delta, a frame count — is the
 * figure the page states.
 */
const PROBE_WIDTH = 64;
const PROBE_HEIGHT = 36;

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly assetFailures: string[];
  setBall(ball: Partial<Ball>): void;
  setPaddle(z: number): void;
  snapshot(): Snapshot;
  dispose(): void;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
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

  return {
    engine,
    assetFailures,
    setBall: (ball) => engine.apply((s) => engine.debug.setBall(s, ball)),
    setPaddle: (z) => engine.apply((s) => engine.debug.setPaddle(s, z)),
    snapshot: () => engine.debug.snapshot(engine.state),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/constant.test.ts — transcribed verbatim                         */
/* -------------------------------------------------------------------------- */

const framesFor = (ms: number, stepMs: number): number =>
  Math.round(ms / stepMs);

it("advances simulated time by the step it was given", async () => {
  const stepMs = 1000 / 240;
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(framesFor(1500, stepMs));

  expect(engine.frame().count).toBe(360);
  expect(engine.frame().timeMs).toBeCloseTo(1500, 6);
  expect(engine.frame().lastDeltaMs).toBeCloseTo(stepMs, 9);
  expect(harness.snapshot().ball.position.x).toBeCloseTo(6, 3);

  harness.dispose();
}, 30_000);

/* -------------------------------------------------------------------------- */
/* validation/sequence.test.ts — transcribed verbatim                         */
/* -------------------------------------------------------------------------- */

const PATTERN = [4, 4, 4, 4, 33, 16];

it("delivers the pattern in order and repeats it", async () => {
  const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
  const { engine } = harness;

  const deltas: number[] = [];
  for (let i = 0; i < PATTERN.length * 2; i += 1) {
    await engine.advance(1);
    deltas.push(engine.frame().lastDeltaMs);
  }

  expect(deltas).toEqual([...PATTERN, ...PATTERN]);
  expect(engine.frame().timeMs).toBeCloseTo(130, 6);

  harness.dispose();
});

it("keeps the ball inside the court across a stutter", async () => {
  const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
  const { engine } = harness;
  harness.setBall({
    position: { x: 6.9, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(PATTERN.length * 4);

  const { ball } = harness.snapshot();
  expect(ball.velocity.x).toBe(-4);
  expect(ball.position.x).toBeLessThanOrEqual(WALL_X - BALL_RADIUS);

  harness.dispose();
});

/* -------------------------------------------------------------------------- */
/* validation/jitter.test.ts — transcribed verbatim                           */
/* -------------------------------------------------------------------------- */

interface Sampled {
  readonly x: number;
  readonly deltas: readonly number[];
}

async function runFor(clock: Clock, frames: number): Promise<Sampled> {
  const harness = await createHarness({ clock });
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  const deltas: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    await engine.advance(1);
    deltas.push(engine.frame().lastDeltaMs);
  }

  const x = harness.snapshot().ball.position.x;
  harness.dispose();
  return { x, deltas };
}

it("replays exactly under the same seed", async () => {
  const first = await runFor(new JitterClock(4, 40, 20260819), 200);
  const second = await runFor(new JitterClock(4, 40, 20260819), 200);

  expect(second.deltas).toEqual(first.deltas);
  expect(second.x).toBe(first.x);
}, 30_000);

it("draws every delta from its range", async () => {
  const { deltas } = await runFor(new JitterClock(4, 40, 20260819), 200);

  expect(Math.min(...deltas)).toBeGreaterThanOrEqual(4);
  expect(Math.max(...deltas)).toBeLessThanOrEqual(40);
  expect(new Set(deltas).size).toBeGreaterThan(1);
}, 30_000);

/* -------------------------------------------------------------------------- */
/* validation/advance-ms.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

async function advanceMs(engine: Engine<State>, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}

/* -------------------------------------------------------------------------- */
/* validation/delta-independence.test.ts — transcribed verbatim               */
/* -------------------------------------------------------------------------- */

interface Outcome {
  readonly bounces: number;
  readonly vx: number;
  readonly x: number;
  readonly elapsedMs: number;
}

async function runScenario(clock: Clock): Promise<Outcome> {
  const harness = await createHarness({ clock });
  const { engine } = harness;

  const played: string[] = [];
  engine.events.on("cue:played", ({ cue }) => {
    played.push(cue);
  });

  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });
  await advanceMs(engine, 3000);

  const { ball } = harness.snapshot();
  const outcome: Outcome = {
    bounces: played.filter((cue) => cue === "bounce").length,
    vx: ball.velocity.x,
    x: ball.position.x,
    elapsedMs: engine.frame().timeMs,
  };
  harness.dispose();
  return outcome;
}

it("reaches the same outcome under every step size", async () => {
  const clocks: Clock[] = [
    new ConstantClock(1000 / 240),
    new SequenceClock([4, 4, 4, 4, 33, 16]),
    new JitterClock(4, 40, 20260819),
  ];

  const outcomes: Outcome[] = [];
  for (const clock of clocks) {
    outcomes.push(await runScenario(clock));
  }

  for (const outcome of outcomes) {
    expect(outcome.bounces).toBe(1);
    expect(outcome.vx).toBe(-4);
    expect(Math.abs(outcome.x)).toBeLessThanOrEqual(WALL_X - BALL_RADIUS);
    expect(Math.abs(outcome.x - 3)).toBeLessThan(0.4);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(outcome.elapsedMs).toBeLessThan(3040);
  }
}, 60_000);

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

describe("examples/scripted-clocks", () => {
  it("costs a frame exactly what the clock says, whatever the host clock did", async () => {
    // "The three scripted clocks ignore the host timestamp and supply their
    // deltas from a constant, a repeating list, or a seeded draw. Under
    // `engine.advance` a frame therefore costs exactly what the clock says and
    // no real time is involved." Two engines under the same clock, one advanced
    // straight through and one with real time passing in the middle, are the
    // same engine at the end.
    const stepMs = 1000 / 240;
    const posed = {
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
    };

    const straight = await createHarness({ clock: new ConstantClock(stepMs) });
    straight.setBall(posed);
    await straight.engine.advance(120);

    const interrupted = await createHarness({
      clock: new ConstantClock(stepMs),
    });
    interrupted.setBall(posed);
    await interrupted.engine.advance(60);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await interrupted.engine.advance(60);

    expect(interrupted.engine.frame()).toEqual(straight.engine.frame());
    expect(interrupted.snapshot()).toEqual(straight.snapshot());
    expect(straight.engine.frame().timeMs).toBeCloseTo(120 * stepMs, 6);

    straight.dispose();
    interrupted.dispose();
  }, 30_000);

  it("fixes a duration by a frame count only under a constant step", async () => {
    // "A frame count fixes a duration only under a constant step. Where the
    // step varies, a validator advances one frame at a time until the simulated
    // clock reaches the target." The same count of frames is a different
    // duration under each of the other two clocks.
    const durations: number[] = [];
    for (const clock of [
      new ConstantClock(1000 / 240),
      new SequenceClock(PATTERN),
      new JitterClock(4, 40, 20260819),
    ]) {
      const harness = await createHarness({ clock });
      await harness.engine.advance(120);
      durations.push(harness.engine.frame().timeMs);
      harness.dispose();
    }

    expect(durations[0]).toBeCloseTo(500, 6);
    expect(new Set(durations).size).toBe(3);
  }, 30_000);

  it("overshoots an advanceMs target by less than one step", async () => {
    // "The loop overshoots the target by at most one step, which is the figure a
    // check allows for when it asserts against elapsed simulated time." The
    // frame before the last left the clock short of the target, so the overshoot
    // is under whatever that last frame was worth — including the 33 millisecond
    // stutter, which is where the figure is largest.
    const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
    const { engine } = harness;

    for (const target of [1000, 1500, 2000, 2500]) {
      await advanceMs(engine, target - engine.frame().timeMs);

      const overshoot = engine.frame().timeMs - target;
      expect(overshoot).toBeGreaterThanOrEqual(0);
      expect(overshoot).toBeLessThan(engine.frame().lastDeltaMs);
      expect(overshoot).toBeLessThan(Math.max(...PATTERN));
    }

    harness.dispose();
  });

  it("swaps the clock in place, carrying the frame counter and the time over", async () => {
    // The page's snippet, with assertions for what its prose narrates:
    // "`engine.setClock` swaps the clock in place, and the frame counter and the
    // accumulated time carry over. Posing a scenario under an exact step and
    // then running it under jitter is one scenario rather than two."
    const harness = await createHarness({
      clock: new ConstantClock(1000 / 120),
    });
    const { engine } = harness;
    harness.setBall({
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 4, y: 0, z: 0 },
    });
    await engine.advance(60);

    // Half a second of exact steps: the pose is where the arithmetic says.
    const posed = engine.frame();
    expect(posed.count).toBe(60);
    expect(posed.timeMs).toBeCloseTo(500, 6);
    expect(harness.snapshot().ball.position.x).toBeCloseTo(2, 6);

    engine.setClock(new JitterClock(4, 40, 20260819));
    await advanceMs(engine, 2500);

    // "The next frame takes its delta from the new one" — every step since the
    // swap is a draw from the jitter clock's range, and the counter and the
    // clock both continued from where the exact half left them.
    const after = engine.frame();
    expect(after.count).toBeGreaterThan(posed.count);
    expect(after.lastDeltaMs).toBeGreaterThanOrEqual(4);
    expect(after.lastDeltaMs).toBeLessThanOrEqual(40);
    expect(after.timeMs).toBeGreaterThanOrEqual(posed.timeMs + 2_500);
    expect(after.timeMs).toBeLessThan(posed.timeMs + 2_500 + 40);

    // One scenario rather than two: three seconds of travel from the origin at 4
    // units per second is 12 units, reflected once at 7.5, which lands the ball
    // near 3 whatever carried it there.
    const { ball } = harness.snapshot();
    expect(ball.velocity.x).toBe(-4);
    expect(Math.abs(ball.position.x - 3)).toBeLessThan(0.4);

    harness.dispose();
  });

  it("lands the three clocks inside the band rather than on one number", async () => {
    // "The position is compared as a band rather than for equality. A reflection
    // lands at a different sub-step instant under each clock, and the final
    // frame overshoots the target by up to one step, so two correct runs
    // legitimately differ by roughly one step of travel at either end: 40
    // milliseconds at 4 units per second is 0.16 units." So the three positions
    // are genuinely three, and the spread is inside the two ends the page allows.
    const xs: number[] = [];
    for (const clock of [
      new ConstantClock(1000 / 240),
      new SequenceClock(PATTERN),
      new JitterClock(4, 40, 20260819),
    ]) {
      xs.push((await runScenario(clock)).x);
    }

    expect(new Set(xs).size).toBe(3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(2 * 0.16);
  }, 60_000);
});
