import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor as ActorType, Pawn as PawnType } from "./actors";
import { Actor, Pawn } from "./actors";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import type {
  ActorSpec,
  Clock,
  EndPlayReason,
  Engine,
  EngineEvents,
  GameDefinition,
  InitApi,
  Shape,
  SurfaceMetrics,
  Vec2,
  World,
} from "./contract";
import { PlayerController } from "./controllers";
import { ConstantClock } from "./clocks";
import { createEngine } from "./engine";
import { GameInstance } from "./game-instance";
import { GameMode } from "./game-mode";

/**
 * The "Validating a Game" worked example, transcribed from
 * `docs/engines/structured-2d/examples/validating-a-game.md`. The page promises
 * that its code works against the engine verbatim, so this suite carries the
 * example's constants, game definition, harness, and all four validator suites
 * as literally as one test module allows, and asserts the outcomes the page
 * narrates.
 *
 * Adaptations, all forced by the test environment rather than chosen:
 *
 * - The example is a seeded workspace (`src/` + `validation/`, several
 *   modules); here everything lives in this one module, so the `Debug` and
 *   `Snapshot` interfaces the page declares twice — once by the build and once
 *   by the suite, both from the same instrumentation spec — are declared once.
 * - Imports name the engine's own modules instead of the published package
 *   `@clockwyrks/structured-2d` (this file *is* that package).
 * - The docs page fixes the case's specification (the table of figures) but
 *   leaves the build's own source — the actors, the controller, and the two
 *   game modes — to the model under test. A reference build of that case is
 *   written below, from the page's table and its narration.
 * - `@napi-rs/canvas` is the canvas the doc's own harness constructs; it
 *   resolves from the workspace root here.
 */

/* ------------------------------------------------------------------ */
/* The case's constants (the example's `src/constants.ts`, verbatim)   */
/* ------------------------------------------------------------------ */

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

const MATCH_SECONDS = 30;

/* ------------------------------------------------------------------ */
/* The debug surface (the example's `validation/debug.ts`, verbatim)   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* The build under test: the reference build of the collection arena   */
/* ------------------------------------------------------------------ */

/**
 * A boundary of the arena. The build's `wall` helper resizes each one, so the
 * wall carries a `resize` that rewrites both its drawn shape and its collider.
 */
class Wall extends Actor {
  readonly body = this.attach(
    new ShapeComponent({
      shape: { kind: "rect", width: 1, height: 1 },
      fill: WALL_COLOR,
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "rect", width: 1, height: 1 },
      channel: TAGS.wall,
      responses: { [TAGS.runner]: "block" },
    }),
  );

  resize(width: number, height: number): void {
    this.body.shape = { kind: "rect", width, height };
    this.collider.shape = { kind: "rect", width, height };
  }
}

const ORB_SHAPE: Shape = { kind: "circle", radius: ORB_RADIUS };

/** One collectible: drawn on the orb layer, overlapping the runner alone. */
class Orb extends Actor {
  readonly body = this.attach(
    new ShapeComponent({ shape: ORB_SHAPE, fill: ORB_COLOR }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: ORB_SHAPE,
      channel: TAGS.orb,
      responses: { [TAGS.runner]: "overlap" },
    }),
  );

  constructor() {
    super();
    this.body.layer = ORB_LAYER;
  }
}

const RUNNER_SHAPE: Shape = { kind: "circle", radius: RUNNER_RADIUS };

/**
 * The pawn player 0 possesses. The controller records a steering direction
 * and arms the dash; the pawn integrates against the delta it is given,
 * spending the dash budget at `DASH_SPEED` and the rest of each frame at
 * `RUNNER_SPEED`, so the dash costs exactly its stated duration whatever the
 * clock's step is.
 */
class Runner extends Pawn {
  readonly body = this.attach(
    new ShapeComponent({ shape: RUNNER_SHAPE, fill: RUNNER_COLOR }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: RUNNER_SHAPE,
      channel: TAGS.runner,
      responses: { [TAGS.wall]: "block", [TAGS.orb]: "overlap" },
    }),
  );

  private direction: Vec2 = { x: 0, y: 0 };
  private dashLeft = 0;

  constructor() {
    super();
    this.addTag(TAGS.runner);
    this.body.layer = RUNNER_LAYER;
  }

  /** Records this frame's steering intent; consumed and reset by `tick`. */
  steer(direction: Vec2): void {
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
    const length = Math.hypot(this.direction.x, this.direction.y);
    if (length > 0) {
      const travel = DASH_SPEED * dashTime + RUNNER_SPEED * (dt - dashTime);
      this.transform.x += (this.direction.x / length) * travel;
      this.transform.y += (this.direction.y / length) * travel;
    }
    this.direction = { x: 0, y: 0 };
  }
}

/** Player 0's controller: two axes from four held actions, one edge for dash. */
class RunnerController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Runner)) return;
    pawn.steer({
      x: this.input.value("right") - this.input.value("left"),
      y: this.input.value("down") - this.input.value("up"),
    });
    if (this.input.pressed("dash")) pawn.dash();
  }
}

/**
 * The arena's mode: adds player 0 (which spawns and possesses the runner),
 * scores each runner–orb overlap, backs the runner out of a blocking wall,
 * and travels to the summary once the last orb is gone or the match clock
 * runs out.
 */
class ArenaMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  /** Removers for the engine-bus subscriptions this world's mode made. */
  private readonly off: (() => void)[] = [];

  override beginPlay(): void {
    this.addPlayer({ name: "runner" });
    this.setPhase("playing");

    const world = this.world;
    world.diagnostics.register("orbs", () => world.byTag(TAGS.orb).length);

    const events: EngineEvents = this.world.events;
    this.off.push(
      // Detection is the engine's; the response is the game's. A blocking
      // pair is separated by moving the runner out along the manifold, with
      // the normal flipped when the runner is the pair's first actor.
      events.on("hit", ({ a, b, manifold }) => {
        const runner = a instanceof Runner ? a : b instanceof Runner ? b : null;
        if (runner === null) return;
        const sign = a === runner ? -1 : 1;
        runner.transform.x += sign * manifold.normal.x * manifold.depth;
        runner.transform.y += sign * manifold.normal.y * manifold.depth;
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
 * example's transition check relies on.
 */
class SummaryMode extends GameMode {
  override playerControllerClass = RunnerController;
  override pawnClass = Runner;

  override beginPlay(): void {
    this.addPlayer({ name: "runner" });
    this.setPhase("over");
  }
}

/* ------------------------------------------------------------------ */
/* The build's game definition (the example's `src/game.ts`)           */
/* ------------------------------------------------------------------ */

const WALL_THICKNESS = 16;
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

  private runner(): PawnType {
    const [player] = this.engine.world.players();
    const pawn = player?.pawn ?? null;
    if (pawn === null) throw new Error("no player controller holds a runner");
    return pawn;
  }

  private orbs(): readonly ActorType[] {
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

/* ------------------------------------------------------------------ */
/* The harness (the example's `validation/harness.ts`, verbatim)       */
/* ------------------------------------------------------------------ */

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<Debug>;
  readonly instance: GameInstance<Debug>;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  world(): World;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  device(point: Vec2): { x: number; y: number };
  pixel(point: Vec2): [number, number, number, number];
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

function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function toDevice(world: World, point: Vec2): { x: number; y: number } {
  const logical = world.camera.worldToLogical(point);
  const view = world.viewport();
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
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

function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

function setsOf(calls: readonly DrawCall[], property: string): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? DESIGN_WIDTH;
  const cssHeight = options.cssHeight ?? DESIGN_HEIGHT;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
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
    ctx,
    calls,
    assetFailures,
    world: () => engine.world,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    device: (point) => toDevice(engine.world, point),
    pixel: (point) => {
      const at = toDevice(engine.world, point);
      const { data } = ctx.getImageData(at.x, at.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => engine.destroy(),
  };
}

/* ------------------------------------------------------------------ */
/* validation/simulation.test.ts                                       */
/* ------------------------------------------------------------------ */

// The probe harness the example builds once at module load, so a build with
// an open field reports the wall check as skipped rather than failed.
const probe = await createHarness();
const declaresWalls = probe.world().byTag(TAGS.wall).length > 0;
probe.dispose();

describe("stepping the simulation", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("carries the runner at its stated speed", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 320, y: 180 });

    harness.hold("right");
    await engine.advance(60);

    const { runner } = engine.debug.snapshot();
    expect(engine.frame().count).toBe(60);
    expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
    expect(runner.x).toBeCloseTo(320 + RUNNER_SPEED, 2);
    expect(runner.y).toBeCloseTo(180, 6);
    expect(harness.assetFailures).toEqual([]);
  });

  it("spends the dash over its stated duration", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 320, y: 180 });

    harness.hold("right");
    harness.tap("dash");
    await engine.advance(60);

    const dashed = DASH_SPEED * DASH_SECONDS;
    const walked = RUNNER_SPEED * (1 - DASH_SECONDS);
    expect(engine.debug.snapshot().runner.x).toBeCloseTo(
      320 + dashed + walked,
      2,
    );
  });

  it.skipIf(!declaresWalls)("is blocked by the arena wall", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 320, y: 180 });

    const hits: { wall: boolean; normal: Vec2 }[] = [];
    engine.events.on("hit", ({ a, manifold }) => {
      hits.push({
        wall: a.hasTag(TAGS.wall),
        normal: { x: manifold.normal.x, y: manifold.normal.y },
      });
    });

    harness.hold("right");
    await engine.advance(120);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].wall).toBe(true);
    expect(hits[0].normal.x).toBeCloseTo(-1, 6);
    expect(engine.debug.snapshot().runner.x).toBeLessThan(
      DESIGN_WIDTH - RUNNER_RADIUS,
    );
  });
});

/* ------------------------------------------------------------------ */
/* validation/world-and-actors.test.ts                                 */
/* ------------------------------------------------------------------ */

describe("asserting on the world and the actors", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("opens the arena with its orbs and one possessed runner", () => {
    const { engine } = harness;
    const world = harness.world();

    expect(world.level).toBe(LEVELS.arena);
    expect(world.mode.phase).toBe("playing");
    expect(world.state.phase).toBe("playing");
    expect(world.byTag(TAGS.orb)).toHaveLength(ORB_COUNT);

    const [player] = world.players();
    expect(player.index).toBe(0);
    expect(player.pawn?.hasTag(TAGS.runner)).toBe(true);
    expect(world.state.players).toHaveLength(1);

    const snapshot = engine.debug.snapshot();
    expect(snapshot.level).toBe(LEVELS.arena);
    expect(snapshot.orbs).toHaveLength(ORB_COUNT);
    expect(snapshot.runner).toEqual({
      x: player.pawn?.transform.x,
      y: player.pawn?.transform.y,
    });

    const ids = world.actors().map((actor) => actor.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("removes a destroyed orb from the world at the end of the frame", async () => {
    const { engine } = harness;
    const world = harness.world();

    const destroyed: number[] = [];
    engine.events.on("actor:destroyed", ({ actor }) =>
      destroyed.push(actor.id),
    );

    const [kept] = world.byTag(TAGS.orb);
    engine.debug.keepOrbs(1);
    expect(world.byTag(TAGS.orb)).toEqual([kept]);

    await engine.advance(1);

    expect(destroyed).toHaveLength(ORB_COUNT - 1);
    expect(world.actors().filter((actor) => actor.hasTag(TAGS.orb))).toEqual([
      kept,
    ]);
  });

  it("travels to the summary level when the last orb is collected", async () => {
    const { engine } = harness;
    const arena = harness.world();

    const travel: string[] = [];
    engine.events.on("world:opening", ({ from, to }) =>
      travel.push(`${from} -> ${to}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      travel.push(`opened ${level}`),
    );

    engine.debug.keepOrbs(1);
    await engine.advance(1);
    engine.debug.placeOrb(0, { x: 320, y: 180 });
    engine.debug.placeRunner({ x: 320, y: 180 });
    await engine.advance(1);

    const summary = harness.world();
    expect(travel).toEqual([
      `${LEVELS.arena} -> ${LEVELS.summary}`,
      `opened ${LEVELS.summary}`,
    ]);
    expect(summary.level).toBe(LEVELS.summary);
    expect(summary).not.toBe(arena);
    expect(summary.mode.options.score).toBe(ORB_POINTS);
    expect(summary.time).toBeCloseTo(0, 6);
    expect(engine.debug.snapshot().level).toBe(LEVELS.summary);
    expect(engine.instance).toBe(harness.instance);
    expect(engine.frame().count).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* validation/rendering.test.ts                                        */
/* ------------------------------------------------------------------ */

describe("asserting on pixels and on the draw stream", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("draws the runner and an orb in the colors the case fixes", async () => {
    const { engine } = harness;
    engine.debug.keepOrbs(1);
    engine.debug.placeOrb(0, { x: 480, y: 180 });
    engine.debug.placeRunner({ x: 320, y: 180 });

    await engine.advance(1);

    expect(harness.device({ x: 0, y: 0 })).toEqual({ x: 160, y: 0 });
    expect(harness.pixel({ x: 320, y: 180 })).toEqual(rgba(RUNNER_COLOR));
    expect(harness.pixel({ x: 480, y: 180 })).toEqual(rgba(ORB_COLOR));
    expect(harness.pixel({ x: 240, y: 100 })).toEqual(rgba(BACKGROUND));
  });

  it("draws the orbs beneath the runner", async () => {
    const { engine, calls } = harness;
    engine.debug.placeRunner({ x: 320, y: 180 });

    calls.length = 0;
    await engine.advance(1);

    const arcs = callsTo(calls, "arc");
    expect(arcs).toHaveLength(ORB_COUNT + 1);
    expect(arcs.at(-1)?.slice(0, 3)).toEqual([320, 180, RUNNER_RADIUS]);

    const fills = setsOf(calls, "fillStyle").filter(
      (color) => color !== BACKGROUND,
    );
    expect(fills.at(-1)).toBe(RUNNER_COLOR);
    expect(fills.filter((color) => color === ORB_COLOR)).toHaveLength(
      ORB_COUNT,
    );
  });

  it("draws outlines alone in wireframe", async () => {
    const { engine, calls } = harness;
    engine.renderer.setMode("wireframe");

    calls.length = 0;
    await engine.advance(1);

    expect(engine.renderer.mode()).toBe("wireframe");
    expect(callsTo(calls, "fill")).toHaveLength(0);
    expect(callsTo(calls, "stroke").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* validation/input-and-audio.test.ts                                  */
/* ------------------------------------------------------------------ */

describe("asserting on actions and cues", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("plays the dash cue once per press", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 320, y: 180 });

    const played: { cue: string; t: number; gain: number }[] = [];
    const off = engine.events.on("cue:played", (event) => played.push(event));

    harness.hold("dash");
    await engine.advance(30);
    harness.release("dash");
    await engine.advance(30);
    off();

    expect(played.map((event) => event.cue)).toEqual(["dash"]);
    expect(played[0].gain).toBeGreaterThan(0);
    expect(played[0].t).toBeGreaterThan(0);
  });

  it("plays the collect cue and scores the orb it removed", async () => {
    const { engine } = harness;
    const world = harness.world();
    engine.debug.keepOrbs(2);
    await engine.advance(1);
    engine.debug.placeOrb(0, { x: 200, y: 180 });
    engine.debug.placeRunner({ x: 200, y: 180 });

    const collected: number[] = [];
    const off = engine.events.on("cue:played", ({ cue, gain }) => {
      if (cue === "collect") collected.push(gain);
    });

    await engine.advance(1);
    off();

    expect(collected).toHaveLength(1);
    expect(engine.debug.snapshot().score).toBe(ORB_POINTS);
    expect(world.byTag(TAGS.orb)).toHaveLength(1);
  });

  it("emits a muted cue with no gain", async () => {
    const { engine } = harness;
    const world = harness.world();
    world.audio.setMuted(true);

    const gains: number[] = [];
    const off = engine.events.on("cue:played", ({ gain }) => gains.push(gain));

    harness.tap("dash");
    await engine.advance(2);
    off();

    expect(world.audio.muted()).toBe(true);
    expect(gains).toEqual([0]);
  });
});

/* ------------------------------------------------------------------ */
/* validation/diagnostics.test.ts                                      */
/* ------------------------------------------------------------------ */

describe("asserting the diagnostics a build registered", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("registers the diagnostics the case names", () => {
    const { engine } = harness;
    engine.debug.keepOrbs(2);

    expect(engine.diagnostics()).toEqual([
      { name: "best", value: 0 },
      { name: "orbs", value: 2 },
    ]);
  });

  it("drops the arena's source when the arena closes", async () => {
    const { engine } = harness;
    engine.debug.keepOrbs(0);
    await engine.advance(1);

    // The travel to `summary` closed the arena, so its source went with it and
    // the instance's stayed.
    expect(harness.world().level).toBe(LEVELS.summary);
    expect(engine.diagnostics()).toEqual([{ name: "best", value: 0 }]);
  });
});
