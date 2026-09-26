import { expect, it } from "vitest";
import { Actor, Pawn } from "./actors";
import { ConstantClock, JitterClock, SequenceClock } from "./clocks";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import type {
  ActorSpec,
  Clock,
  Engine,
  GameDefinition,
  InitApi,
  SurfaceMetrics,
  Vec2,
  World,
} from "./contract";
import { PlayerController } from "./controllers";
import { createEngine } from "./engine";
import { GameInstance } from "./game-instance";
import { GameMode } from "./game-mode";

/**
 * The documentation's "Scripted Clocks" example, transcribed as a test.
 *
 * The example is a validator suite over the collection-arena case that the
 * "Validating a Game" page builds: the case's constants, the build's game
 * definition with its debug surface, and the harness every check constructs
 * its engine through. Both pages promise their code works against the engine
 * verbatim, so this file carries all of it — the constants and `src/game.ts`
 * as the docs print them, the actors and modes the docs describe by their
 * figures table but do not print, and then the scripted-clocks checks exactly
 * as written.
 *
 * Two adaptations, both forced by the test environment rather than chosen:
 *
 * - The docs' harness draws through `@napi-rs/canvas` so its checks can read
 *   pixels back. The scripted-clock checks read the frame loop and the world
 *   and never a pixel, so the native canvas is replaced with the same stub
 *   context the engine's own integration tests use, and the harness drops the
 *   readers nothing here calls (`pixel`, `device`, and the draw-call log).
 * - The docs place the suite beside the build and import across the two; here
 *   the modules are inlined into their sections below.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — the case's constants, as the docs print them            */
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
  up: { keys: ["KeyW", "ArrowUp"] },
  down: { keys: ["KeyS", "ArrowDown"] },
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

const ORB_COUNT = 6;
const ORB_RADIUS = 8;
const ORB_POINTS = 10;
const ORB_LAYER = 0;

const RUNNER_RADIUS = 12;
const RUNNER_SPEED = 180;
const RUNNER_LAYER = 1;

const DASH_SPEED = 480;
const DASH_SECONDS = 0.25;

/* -------------------------------------------------------------------------- */
/* The build under test                                                       */
/* -------------------------------------------------------------------------- */

// The docs print `src/game.ts` whole and describe the actors and modes it
// imports by the case's figures table: walls are the arena's border, orbs are
// circles of radius 8 destroyed on overlap and worth 10 points, and the runner
// is the pawn player 0 possesses — radius 12, 180 units per second, with a
// dash at 480 units per second for 0.25 seconds armed by one press. The
// classes below are those descriptions, written out.

// Collision vocabulary: the runner overlaps orbs and is blocked by walls. The
// engine reports both kinds of pair and moves nothing; the arena mode owns the
// consequences.
const CHANNELS = { wall: "wall", orb: "orb", runner: "runner" } as const;

class Wall extends Actor {
  private readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "rect", width: 1, height: 1 },
      fill: WALL_COLOR,
    }),
  );

  private readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "rect", width: 1, height: 1 },
      channel: CHANNELS.wall,
      responses: { [CHANNELS.runner]: "block" },
    }),
  );

  resize(width: number, height: number): void {
    this.body.shape = { kind: "rect", width, height };
    this.collider.shape = { kind: "rect", width, height };
  }
}

class Orb extends Actor {
  constructor() {
    super();
    const body = this.attach(
      new ShapeComponent({
        shape: { kind: "circle", radius: ORB_RADIUS },
        fill: ORB_COLOR,
      }),
    );
    body.layer = ORB_LAYER;
    this.attach(
      new ColliderComponent({
        shape: { kind: "circle", radius: ORB_RADIUS },
        channel: CHANNELS.orb,
        responses: { [CHANNELS.runner]: "overlap" },
      }),
    );
  }
}

class Runner extends Pawn {
  /** The intent the controller wrote this frame; returns to rest each tick. */
  private dx = 0;
  private dy = 0;

  /** Seconds of dash left to spend. */
  private dashLeft = 0;

  constructor() {
    super();
    this.addTag(TAGS.runner);
    const body = this.attach(
      new ShapeComponent({
        shape: { kind: "circle", radius: RUNNER_RADIUS },
        fill: RUNNER_COLOR,
      }),
    );
    body.layer = RUNNER_LAYER;
    this.attach(
      new ColliderComponent({
        shape: { kind: "circle", radius: RUNNER_RADIUS },
        channel: CHANNELS.runner,
        responses: { [CHANNELS.orb]: "overlap", [CHANNELS.wall]: "block" },
      }),
    );
  }

  drive(dx: number, dy: number): void {
    this.dx = Math.min(Math.max(dx, -1), 1);
    this.dy = Math.min(Math.max(dy, -1), 1);
  }

  dash(): void {
    this.dashLeft = DASH_SECONDS;
    this.world.audio.play("dash");
  }

  override tick(dt: number): void {
    // Integrate against the delta the frame was worth, whatever the clock
    // delivered — the property the scripted-clocks checks measure.
    const length = Math.hypot(this.dx, this.dy);
    if (length > 0) {
      const speed = this.dashLeft > 0 ? DASH_SPEED : RUNNER_SPEED;
      this.transform.x += (this.dx / length) * speed * dt;
      this.transform.y += (this.dy / length) * speed * dt;
    }
    this.dashLeft = Math.max(this.dashLeft - dt, 0);
    this.dx = 0;
    this.dy = 0;
  }
}

class RunnerController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Runner)) return;

    pawn.drive(
      this.input.value("right") - this.input.value("left"),
      this.input.value("down") - this.input.value("up"),
    );
    if (this.input.pressed("dash")) pawn.dash();
  }
}

class ArenaMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  override beginPlay(): void {
    // A collected orb is one that overlapped the runner: destroy it, score
    // it, and sound the cue. One overlap begins once, whichever frame finds
    // it, so a collection costs exactly one of each.
    this.world.events.on("overlap:begin", ({ a, b }) => {
      const orb = a.hasTag(TAGS.orb) ? a : b.hasTag(TAGS.orb) ? b : null;
      const other = orb === a ? b : a;
      if (orb === null || !other.hasTag(TAGS.runner)) return;
      orb.destroy();
      this.state.players[0].score += ORB_POINTS;
      this.world.audio.play("collect");
    });

    this.addPlayer({ name: "runner" });
    this.setPhase("playing");
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    // A destroyed actor leaves `byTag` at once, so the frame that collected
    // the last orb is the frame that requests the travel.
    if (this.world.byTag(TAGS.orb).length > 0) return;
    this.setPhase("over");
    this.world.audio.play("over");
    this.world.open(LEVELS.summary, {
      score: this.state.players[0]?.score ?? 0,
    });
  }
}

class SummaryMode extends GameMode {
  override pawnClass = null;

  override beginPlay(): void {
    this.setPhase("over");
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — as the docs print it                                         */
/* -------------------------------------------------------------------------- */

const WALL_THICKNESS = 16;
const HALF = WALL_THICKNESS / 2;

interface Snapshot {
  level: string;
  phase: string;
  runner: { x: number; y: number };
  orbs: { x: number; y: number }[];
  score: number;
}

interface Debug {
  placeRunner(at: Vec2): void;
  placeOrb(index: number, at: Vec2): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

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
        runner.transform.x = at.x;
        runner.transform.y = at.y;
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined)
          throw new Error(`the arena holds no orb ${index}`);
        orb.transform.x = at.x;
        orb.transform.y = at.y;
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
          runner: { x: runner.transform.x, y: runner.transform.y },
          orbs: this.orbs().map((orb) => ({
            x: orb.transform.x,
            y: orb.transform.y,
          })),
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

function wall(
  x: number,
  y: number,
  width: number,
  height: number,
): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { x, y },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(width, height),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from(
  { length: ORB_COUNT },
  (_, i) => {
    const angle = (i / ORB_COUNT) * Math.PI * 2;
    return {
      type: Orb,
      transform: {
        x: DESIGN_WIDTH / 2 + Math.cos(angle) * 120,
        y: DESIGN_HEIGHT / 2 + Math.sin(angle) * 90,
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
        wall(DESIGN_WIDTH / 2, HALF, DESIGN_WIDTH, WALL_THICKNESS),
        wall(
          DESIGN_WIDTH / 2,
          DESIGN_HEIGHT - HALF,
          DESIGN_WIDTH,
          WALL_THICKNESS,
        ),
        wall(HALF, DESIGN_HEIGHT / 2, WALL_THICKNESS, DESIGN_HEIGHT),
        wall(
          DESIGN_WIDTH - HALF,
          DESIGN_HEIGHT / 2,
          WALL_THICKNESS,
          DESIGN_HEIGHT,
        ),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — adapted: a stub context stands in for the native   */
/* canvas, and the pixel readers nothing here calls are dropped               */
/* -------------------------------------------------------------------------- */

interface HarnessOptions {
  clock?: Clock;
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

/** A canvas reduced to what the engine reads: a context, a size, a style. */
function stubCanvas(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = { width: 0, height: 0, style: {} };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "save",
    "restore",
    "clip",
  ]) {
    ctx[name] = (): void => {};
  }
  canvas["getContext"] = (kind: string): unknown =>
    kind === "2d" ? ctx : null;
  return canvas as unknown as HTMLCanvasElement;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => DESIGN_WIDTH,
    cssHeight: () => DESIGN_HEIGHT,
    dpr: () => 1,
    events: () => events,
  };

  const engine = createEngine<Debug>({
    canvas: stubCanvas(),
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    game,
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
/* validation/advance-ms.ts — as the docs print it                            */
/* -------------------------------------------------------------------------- */

async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}

/* -------------------------------------------------------------------------- */
/* validation/deltas.test.ts — "The deltas each clock delivers"               */
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
});

/* -------------------------------------------------------------------------- */
/* "Replacing the clock mid-scenario"                                         */
/* -------------------------------------------------------------------------- */

// The page's snippet, with assertions for what its prose narrates: the frame
// counter and the accumulated simulated time carry over, the next frame takes
// its delta from the new clock, and the posed scenario continues as one.
it("swaps the clock in place and carries the frame and the time over", async () => {
  const harness = await createHarness({ clock: new ConstantClock(1000 / 120) });
  const { engine } = harness;
  engine.debug.placeRunner({ x: 120, y: 60 });
  await engine.advance(60);

  const before = engine.frame();
  expect(before.count).toBe(60);
  expect(before.timeMs).toBeCloseTo(500, 6);

  engine.setClock(new JitterClock(4, 40, 20260819));
  harness.hold("right");
  await advanceMs(engine, 2500);

  const after = engine.frame();
  expect(after.count).toBeGreaterThan(before.count);
  expect(after.lastDeltaMs).toBeGreaterThanOrEqual(4);
  expect(after.lastDeltaMs).toBeLessThanOrEqual(40);

  // The runner held right for 2500 ms of simulated time at the walking speed,
  // continuing from where the constant-clock half posed it.
  const travelMs = after.timeMs - before.timeMs;
  expect(travelMs).toBeGreaterThanOrEqual(2500);
  expect(travelMs).toBeLessThan(2540);
  const { runner } = engine.debug.snapshot();
  expect(Math.abs(runner.x - (120 + 450))).toBeLessThan(10);
  expect(runner.y).toBeCloseTo(60, 6);

  harness.dispose();
});

/* -------------------------------------------------------------------------- */
/* validation/clocks.test.ts — "One scenario, three step sizes"               */
/* -------------------------------------------------------------------------- */

const START = { x: 120, y: 60 };
const TARGET = { x: 420, y: 60 };
const PARKED = { x: 600, y: 320 };
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
    expect(outcome.collectedAtMs).toBeGreaterThanOrEqual(1555);
    expect(outcome.collectedAtMs).toBeLessThan(1556 + MAX_STEP_MS);
    expect(outcome.travelMs).toBeGreaterThanOrEqual(TRAVEL_MS);
    expect(outcome.travelMs).toBeLessThan(TRAVEL_MS + MAX_STEP_MS);
    expect(Math.abs(outcome.x - 480)).toBeLessThan(10);
  }

  expect(new Set(outcomes.map((outcome) => outcome.frames)).size).toBe(3);
});

it("replays exactly under the same seed", async () => {
  const first = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));
  const second = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));

  expect(second).toEqual(first);
});
