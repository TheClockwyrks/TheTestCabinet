import { createCanvas } from "@test-cabinet/headless-webgl2";
import { describe, expect, it } from "vitest";
import { Actor, Pawn, type EndPlayReason } from "./actors";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "./clocks";
import type { SurfaceMetrics } from "./camera";
import { PlayerController } from "./controllers";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import { vec3Scale, type Vec3 } from "./math";
import type { ActorSpec, EngineEvents, World } from "./worlds";

/**
 * The documentation's worked example "Scripted Clocks", transcribed and run.
 *
 * The page is a validator suite over the collection-arena case that
 * [Validating a Game](validating-a-game.md) builds: "Every example below uses
 * the harness and the debug surface from Validating a Game." Both pages
 * promise their code works against the engine verbatim, so this file carries
 * all of it — that page's constants and `src/game.ts` as it prints them, the
 * actors and modes it describes by its figures table but does not print, its
 * harness, and then the scripted-clocks checks exactly as this page writes
 * them.
 *
 * Adaptations, all forced by the test environment rather than chosen, and all
 * inherited from the sibling suite: one module instead of a seeded workspace,
 * imports naming the engine's own modules, a reference build of the case
 * behind the page's figures, `@test-cabinet/headless-webgl2` for the canvas,
 * and a harness surface smaller than the design size, because a software
 * rasterizer charges for every device pixel and these checks step more than a
 * thousand frames while reading the frame loop and the world rather than the
 * picture. The heavy checks also carry an explicit vitest timeout, for the
 * same reason and for that reason only. The harness itself drops the readers
 * nothing on this page calls — the recording helpers and the device-pixel
 * conversion, which belong to that page's rendering checks.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — the case's constants, as the page prints them           */
/* -------------------------------------------------------------------------- */

const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;

const BACKGROUND = "#0b0f18";
const WALL_COLOR = "#2a3550";
const ORB_COLOR = "#f7c948";
const RUNNER_COLOR = "#7fd1ff";

const LEVELS = {
  arena: "arena",
  summary: "summary",
} as const;

const TAGS = {
  wall: "wall",
  orb: "orb",
  runner: "runner",
} as const;

const ACTIONS = {
  forward: { keys: ["KeyW", "ArrowUp"] },
  back: { keys: ["KeyS", "ArrowDown"] },
  left: { keys: ["KeyA", "ArrowLeft"] },
  right: { keys: ["KeyD", "ArrowRight"] },
  dash: { keys: ["Space"] },
} as const;

const CUES = {
  collect: { freq: 880, freqTo: 1320, durationMs: 90 },
  dash: { wave: "square", freq: 220, freqTo: 110, durationMs: 120 },
  over: { freq: 440, freqTo: 220, durationMs: 400 },
} as const;

type ActionName = keyof typeof ACTIONS;

const ARENA_HALF_X = 10;
const ARENA_HALF_Z = 7.5;

const CAMERA_POSITION = { x: 0, y: 12, z: 14 };
const CAMERA_TARGET = { x: 0, y: 0, z: 0 };

const ORB_COUNT = 6;
const ORB_RADIUS = 0.4;
const ORB_POINTS = 10;
const ORB_LAYER = 0;

const RUNNER_RADIUS = 0.6;
const RUNNER_SPEED = 6;
const RUNNER_LAYER = 1;

const DASH_SPEED = 16;
const DASH_SECONDS = 0.25;

const MATCH_SECONDS = 30;

/* -------------------------------------------------------------------------- */
/* validation/debug.ts — the instrumentation spec, as the page prints it      */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  level: string;
  phase: string;
  runner: { x: number; y: number; z: number };
  orbs: { x: number; y: number; z: number }[];
  score: number;
}

interface Debug {
  placeRunner(at: Vec3): void;
  placeOrb(index: number, at: Vec3): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

/* -------------------------------------------------------------------------- */
/* The build under test: the reference build of the collection arena          */
/* -------------------------------------------------------------------------- */

/**
 * A boundary of the arena. The build's `wall` helper resizes each one, so the
 * wall carries a `resize` that rewrites both its drawn shape and its collider,
 * and a `Shape3` box's `size` is its full extent in world units.
 */
class Wall extends Actor {
  readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "box", size: { x: 1, y: 1, z: 1 } },
      color: WALL_COLOR,
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "box", size: { x: 1, y: 1, z: 1 } },
      channel: TAGS.wall,
      responses: { [TAGS.runner]: "block" },
    }),
  );

  resize(size: Vec3): void {
    this.body.shape = { kind: "box", size: { ...size } };
    this.collider.shape = { kind: "box", size: { ...size } };
  }
}

/** One collectible: drawn on the orb layer, overlapping the runner alone. */
class Orb extends Actor {
  readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "sphere", radius: ORB_RADIUS },
      color: ORB_COLOR,
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "sphere", radius: ORB_RADIUS },
      channel: TAGS.orb,
      responses: { [TAGS.runner]: "overlap" },
    }),
  );

  constructor() {
    super();
    this.body.layer = ORB_LAYER;
  }
}

/**
 * The pawn player 0 possesses. The controller records a steering direction on
 * the ground plane and arms the dash; the pawn integrates against the delta it
 * is given, spending the dash budget at `DASH_SPEED` and the rest of each
 * frame at `RUNNER_SPEED`, so the dash costs exactly its stated duration
 * whatever the clock's step is.
 */
class Runner extends Pawn {
  readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "sphere", radius: RUNNER_RADIUS },
      color: RUNNER_COLOR,
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "sphere", radius: RUNNER_RADIUS },
      channel: TAGS.runner,
      responses: { [TAGS.wall]: "block", [TAGS.orb]: "overlap" },
    }),
  );

  private direction: Vec3 = { x: 0, y: 0, z: 0 };
  private dashLeft = 0;

  constructor() {
    super();
    this.addTag(TAGS.runner);
    this.body.layer = RUNNER_LAYER;
  }

  /** Records this frame's steering intent; consumed and reset by `tick`. */
  steer(direction: Vec3): void {
    this.direction = direction;
  }

  /** Arms one dash and sounds its cue. One press costs one call. */
  dash(): void {
    this.dashLeft = DASH_SECONDS;
    this.world.audio.play("dash");
  }

  override tick(dt: number): void {
    // The dash is a budget of seconds spent at the dash speed: each frame
    // consumes what it can, so the boundary frame splits itself between the
    // two speeds and the distances sum exactly.
    const dashTime = Math.min(this.dashLeft, dt);
    this.dashLeft -= dashTime;
    const length = Math.hypot(this.direction.x, this.direction.z);
    if (length > 0) {
      const travel = DASH_SPEED * dashTime + RUNNER_SPEED * (dt - dashTime);
      const p = this.transform.position;
      p.x += (this.direction.x / length) * travel;
      p.z += (this.direction.z / length) * travel;
    }
    this.direction = { x: 0, y: 0, z: 0 };
  }
}

/**
 * Player 0's controller: two ground-plane axes from four held actions and one
 * edge for the dash. The camera looks from +z toward the origin, so forward is
 * −z and the two differences are a direction on the ground plane.
 */
class RunnerController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Runner)) return;
    pawn.steer({
      x: this.input.value("right") - this.input.value("left"),
      y: 0,
      z: this.input.value("back") - this.input.value("forward"),
    });
    if (this.input.pressed("dash")) pawn.dash();
  }
}

/**
 * The arena's mode: poses the case's fixed camera, adds player 0 (which spawns
 * and possesses the runner), scores each runner–orb overlap, backs the runner
 * out of a blocking wall, and travels to the summary once the last orb is gone
 * or the match clock runs out.
 */
class ArenaMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  /** Removers for the engine-bus subscriptions this world's mode made. */
  private readonly off: (() => void)[] = [];

  override beginPlay(): void {
    this.world.camera.position = { ...CAMERA_POSITION };
    this.world.camera.lookAt(CAMERA_TARGET);
    this.addPlayer({ name: "runner" });
    this.setPhase("playing");

    const events: EngineEvents = this.world.events;
    this.off.push(
      // Detection is the engine's; the response is the game's. A blocking
      // pair is separated by moving the runner out along the manifold, with
      // the normal flipped when the runner is the pair's first actor.
      events.on("hit", ({ a, b, manifold }) => {
        const runner = a instanceof Runner ? a : b instanceof Runner ? b : null;
        if (runner === null) return;
        const push = vec3Scale(manifold.normal, a === runner ? -1 : 1);
        const p = runner.transform.position;
        p.x += push.x * manifold.depth;
        p.y += push.y * manifold.depth;
        p.z += push.z * manifold.depth;
      }),
      events.on("overlap:begin", ({ a, b }) => {
        const orb = a instanceof Orb ? a : b instanceof Orb ? b : null;
        const runner = a instanceof Runner ? a : b instanceof Runner ? b : null;
        if (orb === null || runner === null || !orb.alive) return;
        orb.destroy();
        const scorer = this.state.players[0];
        if (scorer !== undefined) scorer.score += ORB_POINTS;
        this.world.audio.play("collect");
      }),
    );

    this.world.after(MATCH_SECONDS, () => this.finish());
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    if (this.world.byTag(TAGS.orb).length === 0) this.finish();
  }

  override endPlay(reason: EndPlayReason): void {
    // Subscriptions live on the engine rather than the world, so the mode
    // removes its own when its world closes.
    for (const remove of this.off) remove();
    this.off.length = 0;
    super.endPlay(reason);
  }

  private finish(): void {
    if (this.phase === "over") return;
    this.setPhase("over");
    this.world.audio.play("over");
    this.world.open(LEVELS.summary, {
      score: this.state.players[0]?.score ?? 0,
    });
  }
}

/**
 * The summary's mode. It keeps a possessed runner so the debug surface's
 * `snapshot` answers in the summary as readily as in the arena, which the
 * page's transition check relies on.
 */
class SummaryMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  override beginPlay(): void {
    this.addPlayer({ name: "runner" });
    this.setPhase("over");
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const WALL_HEIGHT = 2;
const WALL_THICKNESS = 1;
const HALF = WALL_THICKNESS / 2;

class Collector extends GameInstance<Debug> {
  best = 0;

  override initialize(api: InitApi): Debug {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, { keys: [...binding.keys] });
    }
    for (const [cue, spec] of Object.entries(CUES)) {
      api.audio.define(cue, spec);
    }
    api.diagnostics.register("best", () => this.best);

    return {
      placeRunner: (at) => {
        const runner = this.runner();
        runner.transform.position = { x: at.x, y: at.y, z: at.z };
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined)
          throw new Error(`the arena holds no orb ${index}`);
        orb.transform.position = { x: at.x, y: at.y, z: at.z };
      },
      keepOrbs: (count) => {
        const orbs = this.orbs();
        if (orbs.length < count)
          throw new Error(`the arena holds ${orbs.length} orbs`);
        for (const orb of orbs.slice(count)) orb.destroy();
      },
      snapshot: () => {
        const world = this.engine.world;
        const runner = this.runner();
        return {
          level: world.level,
          phase: world.state.phase,
          runner: { ...runner.transform.position },
          orbs: this.orbs().map((orb) => ({ ...orb.transform.position })),
          score: world.state.players[0]?.score ?? 0,
        };
      },
    };
  }

  private runner(): Pawn {
    const [player] = this.engine.world.players();
    const pawn = player?.pawn ?? null;
    if (pawn === null) throw new Error("no player controller holds a runner");
    return pawn;
  }

  private orbs(): readonly Actor[] {
    return this.engine.world.byTag(TAGS.orb);
  }
}

function wall(position: Vec3, size: Vec3): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { position },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(size),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from(
  { length: ORB_COUNT },
  (_, i) => {
    const angle = (i / ORB_COUNT) * Math.PI * 2;
    return {
      type: Orb,
      transform: {
        position: { x: Math.cos(angle) * 6, y: 0, z: Math.sin(angle) * 4.5 },
      },
      tags: [TAGS.orb],
    };
  },
);

const game: GameDefinition<Debug> = {
  instance: Collector,
  levels: {
    [LEVELS.arena]: {
      mode: ArenaMode,
      actors: [
        wall(
          { x: 0, y: WALL_HEIGHT / 2, z: -ARENA_HALF_Z - HALF },
          { x: 2 * ARENA_HALF_X, y: WALL_HEIGHT, z: WALL_THICKNESS },
        ),
        wall(
          { x: 0, y: WALL_HEIGHT / 2, z: ARENA_HALF_Z + HALF },
          { x: 2 * ARENA_HALF_X, y: WALL_HEIGHT, z: WALL_THICKNESS },
        ),
        wall(
          { x: -ARENA_HALF_X - HALF, y: WALL_HEIGHT / 2, z: 0 },
          { x: WALL_THICKNESS, y: WALL_HEIGHT, z: 2 * ARENA_HALF_Z },
        ),
        wall(
          { x: ARENA_HALF_X + HALF, y: WALL_HEIGHT / 2, z: 0 },
          { x: WALL_THICKNESS, y: WALL_HEIGHT, z: 2 * ARENA_HALF_Z },
        ),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — transcribed verbatim                               */
/* -------------------------------------------------------------------------- */

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<Debug>;
  readonly instance: GameInstance<Debug>;
  readonly assetFailures: string[];
  world(): World;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
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

/**
 * The surface the frame-stepping checks build on. The page's harness defaults
 * to the design size; a software rasterizer charges for every device pixel of
 * a backing store, and these checks read the world rather than the picture, so
 * the default is scaled down and the fit stays the same shape.
 */
const SMALL_CSS_WIDTH = 160;
const SMALL_CSS_HEIGHT = 90;

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? SMALL_CSS_WIDTH;
  const cssHeight = options.cssHeight ?? SMALL_CSS_HEIGHT;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<Debug>({
    canvas: element,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    game: game as GameDefinition<Debug>,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface,
  });

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  const instance = await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", action: ActionName): void => {
    events.dispatchEvent(new KeyEvent(type, ACTIONS[action].keys[0]));
  };

  return {
    engine,
    instance,
    assetFailures,
    world: () => engine.world,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/advance-ms.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}

/* -------------------------------------------------------------------------- */
/* validation/deltas.test.ts — transcribed verbatim                           */
/* -------------------------------------------------------------------------- */

const PATTERN = [4, 4, 4, 4, 33, 16];

async function deltas(clock: Clock, frames: number): Promise<number[]> {
  const harness = await createHarness({ clock });
  const steps: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    await harness.engine.advance(1);
    steps.push(harness.engine.frame().lastDeltaMs);
  }
  harness.dispose();
  return steps;
}

describe("examples/scripted-clocks", () => {
  it("holds one step under a constant clock", async () => {
    const stepMs = 1000 / 240;

    expect(await deltas(new ConstantClock(stepMs), 4)).toEqual([
      stepMs,
      stepMs,
      stepMs,
      stepMs,
    ]);
  });

  it("repeats the sequence in order", async () => {
    const steps = await deltas(new SequenceClock(PATTERN), PATTERN.length * 2);

    expect(steps).toEqual([...PATTERN, ...PATTERN]);
  });

  it("draws every jittered delta from its range", async () => {
    const steps = await deltas(new JitterClock(4, 40, 20260819), 200);

    expect(Math.min(...steps)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...steps)).toBeLessThanOrEqual(40);
    expect(new Set(steps).size).toBeGreaterThan(1);
  }, 30_000);

  /* ------------------------------------------------------------------------ */
  /* Advancing by duration                                                    */
  /* ------------------------------------------------------------------------ */

  it("overshoots a duration target by at most one step", async () => {
    // "The loop overshoots the target by at most one step, which is the figure
    // a check allows for when it asserts against elapsed simulated time."
    const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
    const { engine } = harness;

    await advanceMs(engine, 1000);

    expect(engine.frame().timeMs).toBeGreaterThanOrEqual(1000);
    expect(engine.frame().timeMs).toBeLessThan(1000 + Math.max(...PATTERN));
    harness.dispose();
  });

  /* ------------------------------------------------------------------------ */
  /* Replacing the clock mid-scenario                                         */
  /* ------------------------------------------------------------------------ */

  it("swaps the clock in place, the counters carrying over", async () => {
    // "`engine.setClock` swaps the clock in place, and the next frame takes
    // its delta from the new one. The frame counter and the accumulated
    // simulated time carry over, so posing a scenario under an exact step and
    // then running it under jitter is one scenario rather than two."
    const harness = await createHarness({
      clock: new ConstantClock(1000 / 120),
    });
    const { engine } = harness;
    engine.debug.placeRunner({ x: -6, y: 0, z: 0 });
    await engine.advance(60);

    const posed = engine.frame();
    expect(posed.count).toBe(60);
    expect(posed.timeMs).toBeCloseTo(500, 6);
    expect(posed.lastDeltaMs).toBeCloseTo(1000 / 120, 9);

    engine.setClock(new JitterClock(4, 40, 20260819));
    harness.hold("right");
    await advanceMs(engine, 2500);

    expect(engine.frame().count).toBeGreaterThan(posed.count);
    expect(engine.frame().timeMs).toBeGreaterThanOrEqual(posed.timeMs + 2500);
    expect(engine.frame().lastDeltaMs).not.toBeCloseTo(1000 / 120, 9);
    // The runner kept walking through the swap: one scenario, not two.
    expect(engine.debug.snapshot().runner.x).toBeGreaterThan(-6);
    harness.dispose();
  }, 30_000);
});

/* -------------------------------------------------------------------------- */
/* validation/clocks.test.ts — transcribed verbatim                           */
/* -------------------------------------------------------------------------- */

const START = { x: -6.1, y: 0, z: 0 };
const TARGET = { x: 4, y: 0, z: 0 };
const PARKED = { x: 0, y: 0, z: -6 };
const TRAVEL_MS = 2000;
const MAX_STEP_MS = 40;

interface Outcome {
  frames: number;
  travelMs: number;
  collects: number;
  collectedAtMs: number;
  score: number;
  remaining: number;
  x: number;
}

async function runScenario(clock: Clock): Promise<Outcome> {
  const harness = await createHarness({ clock });
  const { engine } = harness;
  const world = harness.world();

  engine.debug.keepOrbs(2);
  await engine.advance(1);
  engine.debug.placeOrb(0, TARGET);
  engine.debug.placeOrb(1, PARKED);
  engine.debug.placeRunner(START);

  const collected: number[] = [];
  engine.events.on("cue:played", ({ cue, t }) => {
    if (cue === "collect") collected.push(t);
  });

  const startMs = engine.frame().timeMs;
  const startFrames = engine.frame().count;
  harness.hold("right");
  await advanceMs(engine, TRAVEL_MS);
  harness.release("right");

  const snapshot = engine.debug.snapshot();
  const outcome: Outcome = {
    frames: engine.frame().count - startFrames,
    travelMs: engine.frame().timeMs - startMs,
    collects: collected.length,
    collectedAtMs: (collected[0] ?? Number.NaN) - startMs,
    score: snapshot.score,
    remaining: world.byTag(TAGS.orb).length,
    x: snapshot.runner.x,
  };
  harness.dispose();
  return outcome;
}

describe("examples/scripted-clocks: one scenario, three step sizes", () => {
  it("reaches the same outcome under every step size", async () => {
    const clocks: Clock[] = [
      new ConstantClock(1000 / 240),
      new SequenceClock([4, 4, 4, 4, 33, 16]),
      new JitterClock(4, MAX_STEP_MS, 20260819),
    ];

    const outcomes: Outcome[] = [];
    for (const clock of clocks) {
      outcomes.push(await runScenario(clock));
    }

    for (const outcome of outcomes) {
      expect(outcome.collects).toBe(1);
      expect(outcome.score).toBe(ORB_POINTS);
      expect(outcome.remaining).toBe(1);
      expect(outcome.collectedAtMs).toBeGreaterThanOrEqual(1516);
      expect(outcome.collectedAtMs).toBeLessThan(1517 + MAX_STEP_MS);
      expect(outcome.travelMs).toBeGreaterThanOrEqual(TRAVEL_MS);
      expect(outcome.travelMs).toBeLessThan(TRAVEL_MS + MAX_STEP_MS);
      expect(Math.abs(outcome.x - 5.9)).toBeLessThan(0.4);
    }

    expect(new Set(outcomes.map((outcome) => outcome.frames)).size).toBe(3);
  }, 60_000);

  it("replays exactly under the same seed", async () => {
    const first = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));
    const second = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));

    expect(second).toEqual(first);
  }, 60_000);
});
