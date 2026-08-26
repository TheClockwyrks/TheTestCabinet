import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Actor, Pawn, type EndPlayReason } from "./actors";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import { ConstantClock, type Clock } from "./clocks";
import type { SurfaceMetrics } from "./camera";
import type { DrawOp, Recording } from "./contract";
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
 * The "Validating a Game" worked example, transcribed from
 * `docs/engines/structured-3d/examples/validating-a-game.md`. The page
 * promises that its code works against the engine verbatim, so this suite
 * carries the example's constants, game definition, harness, and all four
 * validator suites as literally as one test module allows, and asserts the
 * outcomes the page narrates.
 *
 * Adaptations, all forced by the test environment rather than chosen:
 *
 * - The example is a seeded workspace (`src/` + `validation/`, several
 *   modules); here everything lives in this one module, so the `Debug` and
 *   `Snapshot` interfaces the page declares twice — once by the build and once
 *   by the suite, both from the same instrumentation spec — are declared once.
 * - Imports name the engine's own modules instead of the published package
 *   `@test-cabinet/structured-3d` (this file *is* that package).
 * - The docs page fixes the case's specification (the table of figures) but
 *   leaves the build's own source — the actors, the controller, and the two
 *   game modes — to the model under test. A reference build of that case is
 *   written below, from the page's table and its narration.
 * - `@test-cabinet/headless-webgl2` is the canvas the doc's own harness
 *   constructs; it resolves from the workspace root here, exactly as the
 *   seeded workspace resolves the vendored copy.
 * - The four suites the page keeps in four files are four `describe` blocks
 *   here, so one module holds one page.
 * - The harness's default surface is smaller than the case's design size.
 *   `headless-webgl2` rasterizes in software, so a frame costs time in
 *   proportion to the backing store, and the scenario checks step hundreds of
 *   frames — at the design size the 120-frame wall check alone outruns
 *   vitest's default timeout. The design size, and therefore every figure the
 *   checks read, is unchanged: only the element the fit maps into is smaller.
 *   The rendering checks pass the page's own `800 × 360` at a device pixel
 *   ratio of 2, so the letterbox arithmetic the page states is asserted at the
 *   size the page states it for.
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

type DrawCall = Extract<DrawOp, { op: "call" }>;

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
  device(point: Vec3): { x: number; y: number } | null;
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

function frameCalls(recording: Recording, index: number): DrawCall[] {
  const frame = recording.frames[index];
  if (frame === undefined)
    throw new Error(`the recording holds no frame ${index}`);
  return frame.ops
    .map((op) => recording.ops[op])
    .filter((op): op is DrawCall => op?.op === "call");
}

function drawsOf(calls: readonly DrawCall[]): DrawCall[] {
  return calls.filter((call) => call.method.startsWith("draw"));
}

function toDevice(world: World, point: Vec3): { x: number; y: number } | null {
  const logical = world.camera.project(point);
  if (logical === null) return null;
  const view = world.viewport();
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
  };
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
    device: (point) => toDevice(engine.world, point),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/simulation.test.ts                                              */
/* -------------------------------------------------------------------------- */

// The probe harness the page builds once at module load, so a build with an
// open field reports the wall check as skipped rather than failed.
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
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

    harness.hold("right");
    await engine.advance(60);

    const { runner } = engine.debug.snapshot();
    expect(engine.frame().count).toBe(60);
    expect(engine.frame().timeMs).toBeCloseTo(1000, 6);
    expect(runner.x).toBeCloseTo(RUNNER_SPEED, 2);
    expect(runner.z).toBeCloseTo(0, 6);
    expect(harness.assetFailures).toEqual([]);
  });

  it("spends the dash over its stated duration", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

    harness.hold("right");
    harness.tap("dash");
    await engine.advance(60);

    const dashed = DASH_SPEED * DASH_SECONDS;
    const walked = RUNNER_SPEED * (1 - DASH_SECONDS);
    expect(engine.debug.snapshot().runner.x).toBeCloseTo(dashed + walked, 2);
  });

  it.skipIf(!declaresWalls)("is blocked by the arena wall", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

    const hits: { wall: boolean; normal: Vec3 }[] = [];
    engine.events.on("hit", ({ a, manifold }) => {
      hits.push({
        wall: a.hasTag(TAGS.wall),
        normal: { ...manifold.normal },
      });
    });

    harness.hold("right");
    await engine.advance(120);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].wall).toBe(true);
    expect(hits[0].normal.x).toBeCloseTo(-1, 6);
    expect(engine.debug.snapshot().runner.x).toBeLessThan(ARENA_HALF_X);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/world-and-actors.test.ts                                        */
/* -------------------------------------------------------------------------- */

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
      x: player.pawn?.transform.position.x,
      y: player.pawn?.transform.position.y,
      z: player.pawn?.transform.position.z,
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
    engine.debug.placeOrb(0, { x: 0, y: 0, z: 0 });
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });
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

/* -------------------------------------------------------------------------- */
/* validation/rendering.test.ts                                               */
/* -------------------------------------------------------------------------- */

describe("asserting on the recording", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("draws under the camera the case fixes and the default light rig", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

    await engine.advance(1);
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(recording.space).toBe("3d");
    expect(recording.frames).toHaveLength(1);

    const state = recording.states[recording.frames[0].state];
    expect(state.camera.position).toEqual(CAMERA_POSITION);
    expect(state.mode).toBe("standard");
    expect(state.lights.map((light) => light.type)).toEqual([
      "ambient",
      "directional",
    ]);

    expect(harness.device({ x: 0, y: 0, z: 0 })).toEqual({ x: 800, y: 360 });
  });

  it("draws the orbs beneath the runner", async () => {
    const { engine } = harness;
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

    await engine.advance(1);
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const draws = drawsOf(frameCalls(recording, 0));
    const colors = draws.map((call) => call.args[1]);
    expect(colors.filter((color) => color === ORB_COLOR)).toHaveLength(
      ORB_COUNT,
    );
    expect(colors.at(-1)).toBe(RUNNER_COLOR);

    const transform = draws.at(-1)?.args[2] as { position: Vec3 };
    expect(transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("draws the next frame under a set mode", async () => {
    const { engine } = harness;
    engine.renderer.setMode("wireframe");

    await engine.advance(1);
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(engine.renderer.mode()).toBe("wireframe");
    expect(recording.states[recording.frames[0].state].mode).toBe("wireframe");
  });
});

/* -------------------------------------------------------------------------- */
/* validation/input-and-audio.test.ts                                         */
/* -------------------------------------------------------------------------- */

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
    engine.debug.placeRunner({ x: 0, y: 0, z: 0 });

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
    engine.debug.placeOrb(0, { x: -4, y: 0, z: 0 });
    engine.debug.placeRunner({ x: -4, y: 0, z: 0 });

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
