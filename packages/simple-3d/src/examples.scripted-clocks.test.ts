import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { ConstantClock, JitterClock, SequenceClock } from "./clocks";
import type {
  Clock,
  DeepReadonly,
  Engine,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "./contract";
import { createEngine } from "./index";
import { createStage } from "./testing/canvas";

/**
 * The documentation's "Scripted Clocks" example, transcribed and run.
 *
 * The page is a set of validator suites over the small pong-like case the
 * "Validating a Game" page builds, and it opens by saying every example on it
 * uses that page's harness. So this file carries both: the case's figures and
 * the build under test as the two pages fix them, then the harness, then the
 * scripted-clock checks exactly as the page prints them.
 *
 * The docs promise their code works against the engine verbatim, so each check
 * below is the page's own code — its constants, its helper functions, its
 * assertions, its numbers — and the sections are named for the files the page
 * names. What surrounds them is what the two pages specify but do not print:
 * `src/game.ts`'s implementation, which the "Validating a Game" page gives as
 * `export declare const game` beside a figures table, is written out here from
 * that table.
 *
 * Three adaptations, all forced by the environment rather than chosen:
 *
 * - The docs' suites run in a browser page on headless Chromium, where a real
 *   `webgl2` context and a real 2D context exist. Here the two page canvases
 *   the harness creates come from `src/testing/canvas.ts` instead: a real
 *   `THREE.WebGLRenderer` is still constructed over the stage canvas and still
 *   renders the scene through it, over the stubbed WebGL2 context, and the
 *   screen layer still records every drawing operation.
 * - jsdom performs no layout, so the `SurfaceMetrics` the harness supplies —
 *   which is how the docs' harness reports size anyway, since its canvases are
 *   detached — comes from the same rig.
 * - The harness drops the readers this page never calls: the pixel samplers,
 *   the device mapper, the projector, the draw-call log, and the key
 *   dispatchers. Nothing on this page reads a pixel or presses a key; every
 *   check reads the frame loop, a snapshot, or an event.
 *
 * The assertions are the page's own, and they are what its prose claims: a
 * duration under a constant step is a frame count, a sequence is delivered in
 * order and repeats, a seed replays exactly and draws inside its range, a swap
 * mid-scenario carries the counters over, and one posed scenario reaches the
 * same outcome under all three step sizes.
 */

/* -------------------------------------------------------------------------- */
/* The case's figures, from the "Validating a Game" table                      */
/* -------------------------------------------------------------------------- */

const FIELD_WIDTH = 640;
const FIELD_HEIGHT = 360;
const BACKGROUND = "#101018";
const COURT_WIDTH = 16;
const COURT_DEPTH = 10;
const BALL_RADIUS = 0.4;
const BALL_COLOR = "#f45b69";
const PADDLE_X = -7;
const PADDLE_LENGTH = 3;
const PADDLE_COLOR = "#e8e8e8";
const PANEL_COLOR = "#1c2033";
const TEXT_COLOR = "#ffffff";

/** The paddle's speed along `z`, in world units per second. */
const PADDLE_SPEED = 6;

/** Where the camera stands, looking at the origin. */
const CAMERA_POSITION = { x: 0, y: 14, z: 10 };

/**
 * Where the ball's *center* turns around.
 *
 * The two side walls stand at `z = ±COURT_DEPTH / 2` and the ball has a radius,
 * so its edge meets a wall while its center is still `BALL_RADIUS` short of it.
 * This is the figure the page's prose names — "the ball's center reflects at
 * `COURT_DEPTH / 2 - BALL_RADIUS`" — and it is 4.6.
 */
const WALL_Z = COURT_DEPTH / 2 - BALL_RADIUS;

/* -------------------------------------------------------------------------- */
/* src/game.ts — the types as the docs print them                              */
/* -------------------------------------------------------------------------- */

interface Ball {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

interface State {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

interface Debug {
  setBallPosition(state: DeepReadonly<State>, x: number, z: number): State;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vz: number): State;
  setPaddle(state: DeepReadonly<State>, z: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

/* -------------------------------------------------------------------------- */
/* src/debug.ts — as the docs print it                                         */
/* -------------------------------------------------------------------------- */

const debug: Debug = {
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

/* -------------------------------------------------------------------------- */
/* src/game.ts — the build, written out from the case's figures table          */
/* -------------------------------------------------------------------------- */

/**
 * The scene the case fixes, built into the engine's own scene during the game's
 * initialization.
 *
 * Built here rather than on the first render because the engine hands the same
 * scene to `initialize`, and because every harness below builds its own engine
 * over this one shared `game` object: an object cached in a module-level
 * closure would be one mesh shared between engines, so `render` finds its
 * meshes by name in the scene it was handed instead.
 */
function populate(scene: THREE.Scene): void {
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_WIDTH, COURT_DEPTH),
    new THREE.MeshStandardMaterial({ color: "#1b2333" }),
  );
  court.name = "court";
  court.rotation.x = -Math.PI / 2;
  scene.add(court);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
    new THREE.MeshStandardMaterial({ color: BALL_COLOR }),
  );
  ball.name = "ball";
  scene.add(ball);

  const paddle = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1, PADDLE_LENGTH),
    new THREE.MeshStandardMaterial({ color: PADDLE_COLOR }),
  );
  paddle.name = "paddle";
  scene.add(paddle);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(4, 10, 6);
  scene.add(key);
}

/** Clamps `value` into `[-limit, limit]`. */
function clamp(value: number, limit: number): number {
  return Math.min(Math.max(value, -limit), limit);
}

const game: Game<State, Debug> = {
  initialize(api: InitApi<State>): [State, Debug] {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });

    api.audio.define("bounce", { freq: 440, freqTo: 220, durationMs: 90 });

    api.diagnostics.register(
      "ball",
      (state) => `${state.ball.x.toFixed(1)}, ${state.ball.z.toFixed(1)}`,
    );
    api.diagnostics.register("paddle", (state) => state.paddle.z);

    populate(api.scene);

    const state: State = {
      ball: { x: 0, z: 0, vx: 0, vz: 4 },
      paddle: { z: 0 },
      score: 0,
    };
    return [state, debug];
  },

  /**
   * One step of the simulation, integrated against the delta the frame was
   * worth rather than against a count of frames — the property every check on
   * this page measures.
   *
   * The reflection folds the overshoot back into the court rather than clamping
   * to the wall, so a step that carries the ball past the wall lands where the
   * continuous motion would have put it. That is what makes the outcome the
   * same whatever step size the clock delivered, and it is why the "Delta-time
   * independence" check can compare three cadences against one band.
   */
  update(state: DeepReadonly<State>, api: UpdateApi, dt: number): State {
    const drive = api.input.value("down") - api.input.value("up");
    const paddleLimit = COURT_DEPTH / 2 - PADDLE_LENGTH / 2;
    const paddleZ = clamp(state.paddle.z + drive * PADDLE_SPEED * dt, paddleLimit);

    const x = state.ball.x + state.ball.vx * dt;
    let z = state.ball.z + state.ball.vz * dt;
    let vz = state.ball.vz;

    if (z > WALL_Z) {
      z = 2 * WALL_Z - z;
      vz = -vz;
    } else if (z < -WALL_Z) {
      z = -2 * WALL_Z - z;
      vz = -vz;
    }

    // The cue sounds on the frame the wall reflected the ball, placed where the
    // ball ended that frame, which is within one step's travel of the wall.
    if (vz !== state.ball.vz) {
      api.audio.play("bounce", { at: { x, y: BALL_RADIUS, z } });
    }

    return {
      ball: { x, z, vx: state.ball.vx, vz },
      paddle: { z: paddleZ },
      score: state.score,
    };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    api.camera.position.set(
      CAMERA_POSITION.x,
      CAMERA_POSITION.y,
      CAMERA_POSITION.z,
    );
    api.camera.lookAt(0, 0, 0);

    const ball = api.scene.getObjectByName("ball");
    if (ball !== undefined) {
      ball.position.set(state.ball.x, BALL_RADIUS, state.ball.z);
    }
    const paddle = api.scene.getObjectByName("paddle");
    if (paddle !== undefined) {
      paddle.position.set(PADDLE_X, 0.5, state.paddle.z);
    }

    api.screen.fillStyle = PANEL_COLOR;
    api.screen.fillRect(8, 8, 120, 40);
    api.screen.fillStyle = TEXT_COLOR;
    api.screen.font = "16px sans-serif";
    api.screen.fillText(`score ${state.score}`, 16, 32);
  },
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — adapted as the header describes                     */
/* -------------------------------------------------------------------------- */

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly assetFailures: string[];
  setBallPosition(x: number, z: number): void;
  setBallVelocity(vx: number, vz: number): void;
  setPaddle(z: number): void;
  snapshot(): Snapshot;
  dispose(): void;
}

/**
 * Every engine a check built, so one that threw before its `dispose` still has
 * its renderer disposed of. The page's own checks call `dispose` themselves,
 * and destroying twice deletes nothing twice, so this changes no outcome.
 */
const built: Engine<State, Debug>[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
});

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_WIDTH;
  const cssHeight = options.cssHeight ?? FIELD_HEIGHT;
  const dpr = options.dpr ?? 1;

  // The two page canvases and the surface that reports their size, built to
  // match one another: a backing store of the CSS size times the ratio.
  const rig = createStage({ cssWidth, cssHeight, dpr });

  const engine = createEngine<State, Debug>({
    canvas: rig.stage.canvas,
    screen: rig.screen.canvas,
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    game,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface: rig.surface.surface,
  });
  built.push(engine);

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  await engine.initialize();

  return {
    engine,
    assetFailures,
    setBallPosition: (x, z) =>
      engine.apply((s) => engine.debug.setBallPosition(s, x, z)),
    setBallVelocity: (vx, vz) =>
      engine.apply((s) => engine.debug.setBallVelocity(s, vx, vz)),
    setPaddle: (z) => engine.apply((s) => engine.debug.setPaddle(s, z)),
    snapshot: () => engine.debug.snapshot(engine.state),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/advance-ms.ts — as the page prints it                            */
/* -------------------------------------------------------------------------- */

async function advanceMs(engine: Engine<State>, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}

/* -------------------------------------------------------------------------- */
/* validation/constant.test.ts — "Exact stepping with `ConstantClock`"         */
/* -------------------------------------------------------------------------- */

const framesFor = (ms: number, stepMs: number): number => Math.round(ms / stepMs);

describe("examples/scripted-clocks", () => {
  it("advances simulated time by the step it was given", async () => {
    const stepMs = 1000 / 240;
    const harness = await createHarness({ clock: new ConstantClock(stepMs) });
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 3);

    await engine.advance(framesFor(1500, stepMs));

    expect(engine.frame().count).toBe(360);
    expect(engine.frame().timeMs).toBeCloseTo(1500, 6);
    expect(engine.frame().lastDeltaMs).toBeCloseTo(stepMs, 9);
    expect(harness.snapshot().ball.z).toBeCloseTo(4.5, 3);

    harness.dispose();
  });

  // "One and a half seconds at 240 frames per second is 360 frames, and the
  // ball covers 4.5 world units, stopping short of the wall its edge meets at
  // 4.6." The stop-short half of that claim is the one the check above leaves
  // implicit, so it is stated here: no reflection happened, the velocity is the
  // one the pose set, and the ball is inside the wall it never reached.
  it("stops short of the wall it never reached", async () => {
    const stepMs = 1000 / 240;
    const harness = await createHarness({ clock: new ConstantClock(stepMs) });
    const { engine } = harness;
    const bounces: number[] = [];
    engine.events.on("cue:played", ({ cue, t }) => {
      if (cue === "bounce") bounces.push(t);
    });

    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 3);
    await engine.advance(framesFor(1500, stepMs));

    expect(bounces).toEqual([]);
    expect(harness.snapshot().ball.vz).toBe(3);
    expect(harness.snapshot().ball.z).toBeLessThan(WALL_Z);

    harness.dispose();
  });

  /* ------------------------------------------------------------------------ */
  /* validation/sequence.test.ts — "A repeating pattern with `SequenceClock`"  */
  /* ------------------------------------------------------------------------ */

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
    harness.setBallPosition(0, 4.1);
    harness.setBallVelocity(0, 3);

    await engine.advance(PATTERN.length * 4);

    const { ball } = harness.snapshot();
    expect(ball.vz).toBe(-3);
    expect(ball.z).toBeLessThanOrEqual(COURT_DEPTH / 2 - BALL_RADIUS);

    harness.dispose();
  });

  // "the reflection happens inside a frame worth 33 milliseconds" — the claim
  // the check above rests on and does not itself establish. The ball starts
  // half a unit from the wall at 3 units per second, so it arrives 166.7 ms in;
  // the cycle is 65 ms, so the third cycle's stutter spans 146 to 179 ms, and
  // that is the frame the arrival falls inside. The step in force when the cue
  // sounded is therefore six times the pattern's usual one, which is the size
  // the page says the build's collision response is being read against.
  it("reflects inside the 33 millisecond frame of the third cycle", async () => {
    const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
    const { engine } = harness;
    const bounces: { t: number; stepMs: number }[] = [];
    engine.events.on("cue:played", ({ cue, t }) => {
      if (cue === "bounce") bounces.push({ t, stepMs: engine.frame().lastDeltaMs });
    });

    harness.setBallPosition(0, 4.1);
    harness.setBallVelocity(0, 3);
    await engine.advance(PATTERN.length * 4);

    expect(bounces).toHaveLength(1);
    expect(bounces[0]?.t).toBeCloseTo(179, 6);
    expect(bounces[0]?.stepMs).toBe(33);
    expect(engine.frame().lastDeltaMs).toBe(16);
    expect(engine.frame().timeMs).toBeCloseTo(260, 6);

    harness.dispose();
  });

  /* ------------------------------------------------------------------------ */
  /* validation/jitter.test.ts — "A seeded draw with `JitterClock`"            */
  /* ------------------------------------------------------------------------ */

  interface Sampled {
    readonly z: number;
    readonly deltas: readonly number[];
  }

  async function runFor(clock: Clock, frames: number): Promise<Sampled> {
    const harness = await createHarness({ clock });
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 3);

    const deltas: number[] = [];
    for (let i = 0; i < frames; i += 1) {
      await engine.advance(1);
      deltas.push(engine.frame().lastDeltaMs);
    }

    const z = harness.snapshot().ball.z;
    harness.dispose();
    return { z, deltas };
  }

  it("replays exactly under the same seed", async () => {
    const first = await runFor(new JitterClock(4, 40, 20260819), 200);
    const second = await runFor(new JitterClock(4, 40, 20260819), 200);

    expect(second.deltas).toEqual(first.deltas);
    expect(second.z).toBe(first.z);
  });

  it("draws every delta from its range", async () => {
    const { deltas } = await runFor(new JitterClock(4, 40, 20260819), 200);

    expect(Math.min(...deltas)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...deltas)).toBeLessThanOrEqual(40);
    expect(new Set(deltas).size).toBeGreaterThan(1);
  });

  // "a failure found under jitter is a failure that can be run again" rests on
  // a second seed reaching a different sequence — otherwise the seed is not
  // what the replay is keyed on.
  it("draws a different sequence under a different seed", async () => {
    const seeded = await runFor(new JitterClock(4, 40, 20260819), 60);
    const other = await runFor(new JitterClock(4, 40, 1), 60);

    expect(other.deltas).not.toEqual(seeded.deltas);
  });

  /* ------------------------------------------------------------------------ */
  /* "Replacing the clock mid-scenario"                                       */
  /* ------------------------------------------------------------------------ */

  // The page's snippet, with assertions for what its prose narrates: the swap
  // happens in place, "the frame counter and the accumulated time carry over",
  // and the two halves are "one scenario rather than two" — the ball keeps the
  // position and the velocity the constant-clock half left it with.
  it("swaps the clock in place and carries the frame and the time over", async () => {
    const harness = await createHarness({ clock: new ConstantClock(1000 / 120) });
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 3);
    await engine.advance(60);

    const before = engine.frame();
    expect(before.count).toBe(60);
    expect(before.timeMs).toBeCloseTo(500, 6);
    expect(harness.snapshot().ball.z).toBeCloseTo(1.5, 6);

    engine.setClock(new JitterClock(4, 40, 20260819));
    await advanceMs(engine, 2500);

    const after = engine.frame();
    expect(after.count).toBeGreaterThan(before.count);
    expect(after.timeMs).toBeGreaterThanOrEqual(3000);
    expect(after.timeMs).toBeLessThan(3040);
    expect(after.lastDeltaMs).toBeGreaterThanOrEqual(4);
    expect(after.lastDeltaMs).toBeLessThanOrEqual(40);

    // Three seconds of travel at 3 units per second from the origin, folded
    // once off the far wall: the same fifth of a unit the delta-independence
    // check below lands on, reached across two different clocks.
    const { ball } = harness.snapshot();
    expect(ball.vz).toBe(-3);
    expect(Math.abs(ball.z - 0.2)).toBeLessThan(0.3);

    harness.dispose();
  });

  /* ------------------------------------------------------------------------ */
  /* validation/delta-independence.test.ts — "Delta-time independence"         */
  /* ------------------------------------------------------------------------ */

  interface Outcome {
    readonly bounces: number;
    readonly vz: number;
    readonly z: number;
    readonly elapsedMs: number;
  }

  async function runScenario(clock: Clock): Promise<Outcome> {
    const harness = await createHarness({ clock });
    const { engine } = harness;

    const played: string[] = [];
    engine.events.on("cue:played", ({ cue }) => {
      played.push(cue);
    });

    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 3);
    await advanceMs(engine, 3000);

    const { ball } = harness.snapshot();
    const outcome: Outcome = {
      bounces: played.filter((cue) => cue === "bounce").length,
      vz: ball.vz,
      z: ball.z,
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
      expect(outcome.vz).toBe(-3);
      expect(outcome.z).toBeGreaterThan(-(COURT_DEPTH / 2 - BALL_RADIUS));
      expect(outcome.z).toBeLessThan(COURT_DEPTH / 2 - BALL_RADIUS);
      expect(Math.abs(outcome.z - 0.2)).toBeLessThan(0.3);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(3000);
      expect(outcome.elapsedMs).toBeLessThan(3040);
    }
  });

  // "The ball covers 9 units in three seconds, reflecting once at 1533
  // milliseconds" — and the three clocks reach that one outcome over three
  // different frame counts, which is the whole point of running the scenario
  // three times rather than once.
  it("reaches it over a different number of frames each time", async () => {
    const frames: number[] = [];
    const bounceTimes: number[] = [];

    for (const clock of [
      new ConstantClock(1000 / 240),
      new SequenceClock([4, 4, 4, 4, 33, 16]),
      new JitterClock(4, 40, 20260819),
    ]) {
      const harness = await createHarness({ clock });
      const { engine } = harness;
      engine.events.on("cue:played", ({ cue, t }) => {
        if (cue === "bounce") bounceTimes.push(t);
      });

      harness.setBallPosition(0, 0);
      harness.setBallVelocity(0, 3);
      await advanceMs(engine, 3000);

      frames.push(engine.frame().count);
      harness.dispose();
    }

    expect(new Set(frames).size).toBe(3);
    expect(bounceTimes).toHaveLength(3);
    for (const t of bounceTimes) {
      // The ideal instant is 4.6 units at 3 units per second, and the cue lands
      // on the first frame whose step carries the ball to the wall, so it is
      // late by at most one step and never early.
      expect(t).toBeGreaterThanOrEqual(1533.3);
      expect(t).toBeLessThan(1533.4 + 40);
    }
  });
});
