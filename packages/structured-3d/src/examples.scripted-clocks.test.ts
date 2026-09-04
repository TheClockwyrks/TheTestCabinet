import { expect, it } from "vitest";

import { Actor, Pawn } from "./actors";
import { ConstantClock, JitterClock, SequenceClock } from "./clocks";
import { ColliderComponent } from "./collision";
import {
  LightComponent,
  MeshComponent,
  ShapeComponent,
  TextComponent,
} from "./components";
import type { Clock, SurfaceMetrics, Vec3 } from "./contract";
import { PlayerController } from "./controllers";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import { vec3 } from "./math";
import { createStage } from "./testing/canvas";
import type { ActorSpec, World } from "./worlds";

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
 * - The docs' harness runs in a browser, where `document.createElement` yields
 *   a canvas with a real `webgl2` context and a real 2D context behind it. Here
 *   the two canvases come from `src/testing/canvas.ts` — the same stage the
 *   engine's own integration tests build a real `THREE.WebGLRenderer` over
 *   under jsdom — and the harness drops the readers nothing here calls
 *   (`logical`, `device`, `pixel`, `picture`, and the draw-call log). The
 *   scripted-clock checks read the frame loop and the world and never a pixel.
 * - The docs place the suite beside the build and import across the two; here
 *   the modules are inlined into their sections below.
 *
 * The page also states, in prose beside those snippets and in the two tables
 * that close it, what each clock guarantees and what a validator may and may
 * not assert across step sizes: one cycle of the pattern is worth 65
 * milliseconds, a seed replays, `advanceMs` overshoots by at most one step, a
 * swapped clock is read from the very next frame, the order of the events a
 * collection causes is fixed, and a manifold's normal survives a change in
 * step size where its depth does not. Those claims are checked here too, in
 * sections placed where the page makes them.
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
const HUD_COLOR = "#1a2238";
const SCORE_COLOR = "#f2f5f7";

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

const ARENA_WIDTH = 16;
const ARENA_DEPTH = 9;

const CAMERA = { position: vec3(0, 12, 9), target: vec3(0, 0, 0) };

const ORB_COUNT = 6;
const ORB_RADIUS = 0.3;
const ORB_POINTS = 10;

const RUNNER_RADIUS = 0.5;
const RUNNER_SPEED = 4;

const DASH_SPEED = 12;
const DASH_SECONDS = 0.25;

const HUD = { x: 80, y: 24, width: 140, height: 28 };
const HUD_LAYER = 0;
const SCORE_LAYER = 1;

/* -------------------------------------------------------------------------- */
/* The build under test                                                       */
/* -------------------------------------------------------------------------- */

// The docs print `src/game.ts` whole and describe the actors and modes it
// imports by the case's figures table: walls are the arena's border, orbs are
// spheres of radius 0.3 destroyed on overlap and worth 10 points, and the
// runner is the pawn player 0 possesses — a sphere of radius 0.5, 4 units per
// second, with a dash at 12 units per second for 0.25 seconds armed by one
// press. `Lights` carries a hemisphere and a directional light, and `Hud`
// carries a screen-space panel and the readout it rewrites from the state each
// tick. The classes below are those descriptions, written out.

// Collision vocabulary: the runner overlaps orbs and is blocked by walls. The
// engine reports both kinds of pair and moves nothing; the arena mode owns the
// consequences.
const CHANNELS = { wall: "wall", orb: "orb", runner: "runner" } as const;

class Wall extends Actor {
  private readonly body = this.attach(
    new MeshComponent({
      geometry: { kind: "box", width: 1, height: 1, depth: 1 },
      material: { color: WALL_COLOR },
    }),
  );

  private readonly collider = this.attach(
    new ColliderComponent({
      shape: { kind: "box", width: 1, height: 1, depth: 1 },
      channel: CHANNELS.wall,
      responses: { [CHANNELS.runner]: "block" },
    }),
  );

  resize(width: number, height: number, depth: number): void {
    this.body.geometry = { kind: "box", width, height, depth };
    this.collider.shape = { kind: "box", width, height, depth };
  }
}

class Orb extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: ORB_RADIUS },
        material: { color: ORB_COLOR },
      }),
    );
    this.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: ORB_RADIUS },
        channel: CHANNELS.orb,
        responses: { [CHANNELS.runner]: "overlap" },
      }),
    );
  }
}

class Runner extends Pawn {
  /** The intent the controller wrote this frame; returns to rest each tick. */
  private dx = 0;
  private dz = 0;

  /** Seconds of dash left to spend. */
  private dashLeft = 0;

  constructor() {
    super();
    this.addTag(TAGS.runner);
    this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: RUNNER_RADIUS },
        material: { color: RUNNER_COLOR },
      }),
    );
    this.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: RUNNER_RADIUS },
        channel: CHANNELS.runner,
        responses: { [CHANNELS.orb]: "overlap", [CHANNELS.wall]: "block" },
      }),
    );
  }

  drive(dx: number, dz: number): void {
    this.dx = Math.min(Math.max(dx, -1), 1);
    this.dz = Math.min(Math.max(dz, -1), 1);
  }

  dash(): void {
    this.dashLeft = DASH_SECONDS;
    this.world.audio.play("dash");
  }

  override tick(dt: number): void {
    // Integrate against the delta the frame was worth, whatever the clock
    // delivered — the property the scripted-clocks checks measure. The runner
    // moves on the ground plane, so `y` is left where it was posed.
    const length = Math.hypot(this.dx, this.dz);
    if (length > 0) {
      const speed = this.dashLeft > 0 ? DASH_SPEED : RUNNER_SPEED;
      const at = this.transform.position;
      this.transform.position = vec3(
        at.x + (this.dx / length) * speed * dt,
        at.y,
        at.z + (this.dz / length) * speed * dt,
      );
    }
    this.dashLeft = Math.max(this.dashLeft - dt, 0);
    this.dx = 0;
    this.dz = 0;
  }
}

class Lights extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({
        light: { kind: "hemisphere", sky: "#94b8ff", ground: "#20242e" },
      }),
    );
    this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
  }
}

class Hud extends Actor {
  private readonly readout: TextComponent;

  constructor() {
    super();
    const panel = this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: HUD.width, height: HUD.height },
        fill: HUD_COLOR,
      }),
    );
    panel.layer = HUD_LAYER;
    this.readout = this.attach(
      new TextComponent({ text: "score 0", fill: SCORE_COLOR }),
    );
    this.readout.layer = SCORE_LAYER;
  }

  override tick(): void {
    this.readout.text = `score ${this.world.state.players[0]?.score ?? 0}`;
  }
}

class RunnerController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Runner)) return;

    // `up` and `down` move along -Z and +Z, `left` and `right` along -X and
    // +X, so from the case's camera `up` is up the screen.
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
    // it, and sound the cue where it stood. One overlap begins once, whichever
    // frame finds it, so a collection costs exactly one of each.
    this.world.events.on("overlap:begin", ({ a, b }) => {
      const orb = a.hasTag(TAGS.orb) ? a : b.hasTag(TAGS.orb) ? b : null;
      const other = orb === a ? b : a;
      if (orb === null || !other.hasTag(TAGS.runner)) return;
      const at = orb.transform.position;
      orb.destroy();
      const player = this.state.players[0];
      if (player !== undefined) player.score += ORB_POINTS;
      this.world.audio.play("collect", { at: vec3(at.x, at.y, at.z) });
    });

    this.world.camera.position = CAMERA.position;
    this.world.camera.lookAt(CAMERA.target);
    this.world.diagnostics.register(
      "orbs",
      () => this.world.byTag(TAGS.orb).length,
    );

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

const WALL_THICKNESS = 0.5;
const WALL_HEIGHT = 1;
const HALF = WALL_THICKNESS / 2;

interface Snapshot {
  level: string;
  phase: string;
  runner: Vec3;
  orbs: Vec3[];
  score: number;
}

interface Debug {
  placeRunner(at: Vec3): void;
  placeOrb(index: number, at: Vec3): void;
  keepOrbs(count: number): void;
  snapshot(): Snapshot;
}

const copy = (at: Vec3): Vec3 => vec3(at.x, at.y, at.z);

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
        this.runner().transform.position = copy(at);
      },
      placeOrb: (index, at) => {
        const orb = this.orbs()[index];
        if (orb === undefined)
          throw new Error(`the arena holds no orb ${index}`);
        orb.transform.position = copy(at);
      },
      keepOrbs: (count) => {
        const orbs = this.orbs();
        if (orbs.length < count)
          throw new Error(`the arena holds ${orbs.length} orbs`);
        for (const orb of orbs.slice(count)) orb.destroy();
      },
      snapshot: () => {
        const world = this.engine.world;
        return {
          level: world.level,
          phase: world.state.phase,
          runner: copy(this.runner().transform.position),
          orbs: this.orbs().map((orb) => copy(orb.transform.position)),
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
  z: number,
  width: number,
  depth: number,
): ActorSpec<Wall> {
  return {
    type: Wall,
    transform: { position: vec3(x, WALL_HEIGHT / 2, z) },
    tags: [TAGS.wall],
    configure: (actor) => actor.resize(width, WALL_HEIGHT, depth),
  };
}

const orbs: readonly ActorSpec<Orb>[] = Array.from(
  { length: ORB_COUNT },
  (_, i) => {
    const angle = (i / ORB_COUNT) * Math.PI * 2;
    return {
      type: Orb,
      transform: {
        position: vec3(Math.cos(angle) * 5, 0, Math.sin(angle) * 3),
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
        { type: Lights },
        { type: Hud, transform: { position: vec3(HUD.x, HUD.y, 0) } },
        wall(
          0,
          -(ARENA_DEPTH / 2 + HALF),
          ARENA_WIDTH + 2 * WALL_THICKNESS,
          WALL_THICKNESS,
        ),
        wall(
          0,
          ARENA_DEPTH / 2 + HALF,
          ARENA_WIDTH + 2 * WALL_THICKNESS,
          WALL_THICKNESS,
        ),
        wall(-(ARENA_WIDTH / 2 + HALF), 0, WALL_THICKNESS, ARENA_DEPTH),
        wall(ARENA_WIDTH / 2 + HALF, 0, WALL_THICKNESS, ARENA_DEPTH),
        ...orbs,
      ],
    },
    [LEVELS.summary]: { mode: SummaryMode },
  },
  startLevel: LEVELS.arena,
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — adapted: the stage's stubbed canvases stand in for */
/* the browser's, and the pixel readers nothing here calls are dropped        */
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

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const stage = createStage({
    cssWidth: DESIGN_WIDTH,
    cssHeight: DESIGN_HEIGHT,
    dpr: 1,
  });
  const events = stage.surface.target;
  const surface: SurfaceMetrics = stage.surface.surface;

  const engine = createEngine<Debug>({
    canvas: stage.stage.canvas,
    screen: stage.screen.canvas,
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
    events.dispatchEvent(
      new KeyboardEvent(type, { code: ACTIONS[action].keys[0] }),
    );
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

// The prose beside the snippet, in the engine's own terms: "One cycle of the
// pattern is 65 milliseconds over six frames".
it("spends 65 milliseconds over one cycle of the pattern", async () => {
  const harness = await createHarness({ clock: new SequenceClock(PATTERN) });

  await harness.engine.advance(PATTERN.length);
  expect(harness.engine.frame().timeMs).toBe(65);

  // The list repeats, so the second cycle is worth exactly what the first was.
  await harness.engine.advance(PATTERN.length);
  expect(harness.engine.frame().timeMs).toBe(130);

  harness.dispose();
});

// "A seeded draw replays exactly, so two engines given the same seed take the
// same deltas in the same order and a failure found under jitter can be run
// again." Two engines, one seed, and the draw compared frame by frame.
it("hands two engines the same deltas from one seed", async () => {
  const seed = 20260819;

  const first = await deltas(new JitterClock(4, 40, seed), 64);
  const second = await deltas(new JitterClock(4, 40, seed), 64);

  expect(second).toEqual(first);
  // The draw is indexed by frame rather than streamed, so a clock nothing has
  // ticked yet answers with the delta the first frame of a run was worth.
  const peer: Clock = new JitterClock(4, 40, seed);
  expect(first[0]).toBe(peer.delta(0));
});

/* -------------------------------------------------------------------------- */
/* "Advancing by duration"                                                    */
/* -------------------------------------------------------------------------- */

// "The loop overshoots the target by at most one step, which is the figure a
// check allows for when it asserts against elapsed simulated time." The bound
// is stated against each clock's own widest step.
it("stops within one step of the duration it was asked for", async () => {
  const cases: [Clock, number][] = [
    [new ConstantClock(1000 / 240), 1000 / 240],
    [new SequenceClock(PATTERN), Math.max(...PATTERN)],
    [new JitterClock(4, 40, 20260819), 40],
  ];

  for (const [clock, widestStepMs] of cases) {
    const harness = await createHarness({ clock });
    const { engine } = harness;
    const target = engine.frame().timeMs + 1000;

    await advanceMs(engine, 1000);

    const reached = engine.frame().timeMs;
    expect(reached).toBeGreaterThanOrEqual(target);
    expect(reached - target).toBeLessThan(widestStepMs);
    harness.dispose();
  }
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
  engine.debug.placeRunner({ x: -3, y: 0, z: 0 });
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
  // continuing from where the constant-clock half posed it: five units down
  // the lane from `x = -3`, ten units of travel on from there.
  const travelMs = after.timeMs - before.timeMs;
  expect(travelMs).toBeGreaterThanOrEqual(2500);
  expect(travelMs).toBeLessThan(2540);
  const { runner } = engine.debug.snapshot();
  expect(Math.abs(runner.x - (-3 + 10))).toBeLessThan(0.2);
  expect(runner.y).toBeCloseTo(0, 6);
  expect(runner.z).toBeCloseTo(0, 6);

  harness.dispose();
});

// "`engine.setClock` swaps the clock in place, and the next frame takes its
// delta from the new one." A sequence states that exactly: the frame after the
// swap is worth the list's first entry and the one after it the second, with
// no frame of the old step in between.
it("takes the very next frame's delta from the clock just installed", async () => {
  const harness = await createHarness({ clock: new ConstantClock(10) });
  const { engine } = harness;
  await engine.advance(3);

  engine.setClock(new SequenceClock([7, 21]));
  await engine.advance(1);
  expect(engine.frame().lastDeltaMs).toBe(7);
  await engine.advance(1);
  expect(engine.frame().lastDeltaMs).toBe(21);

  // The counter and the accumulated time belong to the engine rather than to
  // the clock, so both carry across the swap.
  expect(engine.frame().count).toBe(5);
  expect(engine.frame().timeMs).toBeCloseTo(3 * 10 + 7 + 21, 6);

  harness.dispose();
});

/* -------------------------------------------------------------------------- */
/* validation/clocks.test.ts — "One scenario, three step sizes"               */
/* -------------------------------------------------------------------------- */

const START = { x: -3, y: 0, z: 0 };
const TARGET = { x: 2, y: 0, z: 0 };
const PARKED = { x: 6, y: 0, z: -3 };
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
    expect(outcome.collectedAtMs).toBeGreaterThanOrEqual(1049);
    expect(outcome.collectedAtMs).toBeLessThan(1051 + MAX_STEP_MS);
    expect(outcome.travelMs).toBeGreaterThanOrEqual(TRAVEL_MS);
    expect(outcome.travelMs).toBeLessThan(TRAVEL_MS + MAX_STEP_MS);
    expect(Math.abs(outcome.x - 5)).toBeLessThan(0.2);
  }

  expect(new Set(outcomes.map((outcome) => outcome.frames)).size).toBe(3);
});

it("replays exactly under the same seed", async () => {
  const first = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));
  const second = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));

  expect(second).toEqual(first);
});

/* -------------------------------------------------------------------------- */
/* "What survives a change in step size" / "What legitimately diverges"        */
/* -------------------------------------------------------------------------- */

/**
 * The same scenario reduced to one orb, tracing what the engine broadcast.
 *
 * The doc's own scenario parks a second orb so the match stays open and the
 * runner keeps walking. Collecting the *last* orb is what ends the match, so
 * the one-orb variant is where "a collection precedes what it caused" is a
 * statement about a chain rather than about a single event.
 */
async function traceScenario(clock: Clock): Promise<string[]> {
  const harness = await createHarness({ clock });
  const { engine } = harness;

  engine.debug.keepOrbs(1);
  await engine.advance(1);
  engine.debug.placeOrb(0, TARGET);
  engine.debug.placeRunner(START);

  const trace: string[] = [];
  engine.events.on("cue:played", ({ cue }) => trace.push(`cue ${cue}`));
  engine.events.on("actor:destroyed", ({ actor }) => {
    if (actor.hasTag(TAGS.orb)) trace.push("orb destroyed");
  });
  engine.events.on("world:opening", ({ to }) => trace.push(`opening ${to}`));
  engine.events.on("world:opened", ({ level }) =>
    trace.push(`opened ${level}`),
  );

  harness.hold("right");
  await advanceMs(engine, TRAVEL_MS);
  harness.dispose();
  return trace;
}

// "The order of events | The frame order is fixed, so a collection precedes
// what it caused." The collection sounds its cue, the mode finds the arena
// empty on the same frame and sounds the end of the match, the destroy lands
// at that frame's flush, and the travel to the summary follows — in that
// order, at every step size.
it("broadcasts a collection and what it caused in one order, whatever the step", async () => {
  const traces = [
    await traceScenario(new ConstantClock(1000 / 240)),
    await traceScenario(new SequenceClock(PATTERN)),
    await traceScenario(new JitterClock(4, MAX_STEP_MS, 20260819)),
  ];

  for (const trace of traces) {
    expect(trace).toEqual([
      "cue collect",
      "cue over",
      "orb destroyed",
      "opening summary",
      "opened summary",
    ]);
  }
});

// The second table, read as a set of claims about one scenario run three ways:
// the frame count differs and every figure derived from it with it, the final
// position differs by up to one step of travel, an event's instant differs by
// up to one step, and accumulated simulated time is not an exact figure.
it("diverges only where the table says a step size legitimately shows", async () => {
  const constant = await runScenario(new ConstantClock(1000 / 240));
  const sequence = await runScenario(new SequenceClock(PATTERN));
  const jitter = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));
  const outcomes = [constant, sequence, jitter];

  // "The three clocks reach that outcome over roughly 480, 185, and 91
  // frames." Two of those are exact — 2000 milliseconds is 480 frames of
  // 1000/240 and just over 30 cycles of a 65-millisecond pattern — and the
  // seeded draw reaches the target in 90, one short of the figure the page
  // quotes as a round number.
  expect(constant.frames).toBe(480);
  expect(sequence.frames).toBe(185);
  expect(Math.abs(jitter.frames - 91)).toBeLessThanOrEqual(2);

  // A figure derived from the frame count differs with it, so no two runs
  // agree on where the runner stopped or on when the orb was collected.
  expect(new Set(outcomes.map((outcome) => outcome.x)).size).toBe(3);
  expect(new Set(outcomes.map((outcome) => outcome.collectedAtMs)).size).toBe(
    3,
  );
  expect(new Set(outcomes.map((outcome) => outcome.travelMs)).size).toBe(3);

  // "The band is one step of travel at the widest step the run allows, which
  // is `MAX_STEP_MS` at the walking speed, or `0.16` units." The doc's own
  // check allows 0.2; the figure the band was computed from holds.
  const bandUnits = (MAX_STEP_MS / 1000) * RUNNER_SPEED;
  expect(bandUnits).toBeCloseTo(0.16, 6);
  for (const outcome of outcomes) {
    expect(Math.abs(outcome.x - 5)).toBeLessThan(bandUnits);
    expect(outcome.collectedAtMs - 1050).toBeLessThan(MAX_STEP_MS);
  }

  // "Accumulated floating-point error differs ... so a check of simulated time
  // uses `toBeCloseTo` rather than `toBe`." Four hundred and eighty additions
  // of 1000/240 do not land on two seconds.
  expect(constant.travelMs).not.toBe(TRAVEL_MS);
  expect(constant.travelMs).toBeCloseTo(TRAVEL_MS, 6);
});

/**
 * The first manifold the runner's walk into the arena's right wall produced.
 *
 * The build reports blocking pairs and moves nothing, so the runner keeps
 * walking into the wall and the pass keeps finding the pair — which is what
 * makes the manifold readable at two step sizes without the response changing
 * the scenario underneath the comparison.
 */
async function firstWallHit(
  clock: Clock,
): Promise<{ normal: Vec3; depth: number }> {
  const harness = await createHarness({ clock });
  const { engine } = harness;

  // One orb, parked clear of the lane, so the match stays open for the walk.
  engine.debug.keepOrbs(1);
  await engine.advance(1);
  engine.debug.placeOrb(0, PARKED);
  engine.debug.placeRunner({ x: 6, y: 0, z: 0 });

  const hits: { normal: Vec3; depth: number }[] = [];
  engine.events.on("hit", ({ manifold }) => {
    hits.push({ normal: manifold.normal, depth: manifold.depth });
  });

  harness.hold("right");
  await advanceMs(engine, 800);
  harness.dispose();

  const first = hits[0];
  if (first === undefined) throw new Error("the runner never reached the wall");
  return first;
}

// "The manifold depth differs. A blocking pair is separated by however far
// this frame's movement drove it in, so a larger step produces a deeper
// penetration and a stronger correction. A check reads the normal, which is a
// direction, rather than the depth, which is a step size."
it("reads one normal from two step sizes, and two depths", async () => {
  const fineStepMs = 1000 / 240;
  const coarseStepMs = MAX_STEP_MS;

  const fine = await firstWallHit(new ConstantClock(fineStepMs));
  const coarse = await firstWallHit(new ConstantClock(coarseStepMs));

  // The direction is the same at either step: a unit vector along -X, out of
  // the wall towards the runner that walked into it.
  for (const { normal } of [fine, coarse]) {
    expect(normal.x).toBeCloseTo(-1, 6);
    expect(normal.y).toBeCloseTo(0, 6);
    expect(normal.z).toBeCloseTo(0, 6);
  }

  // The depth is a step size: at most the distance that frame's movement
  // carried, and deeper at the wider step.
  expect(coarse.depth).toBeGreaterThan(fine.depth);
  expect(fine.depth).toBeLessThanOrEqual((fineStepMs / 1000) * RUNNER_SPEED);
  expect(coarse.depth).toBeLessThanOrEqual(
    (coarseStepMs / 1000) * RUNNER_SPEED,
  );
});
