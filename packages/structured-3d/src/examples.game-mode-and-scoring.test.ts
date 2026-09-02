import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Actor,
  ColliderComponent,
  ConstantClock,
  GameInstance,
  GameMode,
  GameState,
  LightComponent,
  MeshComponent,
  Pawn,
  PlayerController,
  PlayerState,
  QUAT_IDENTITY,
  TOUCH_LAYOUTS,
  VEC3_ONE,
  add,
  createEngine,
  quatFromEuler,
  scale,
  vec3,
} from "./index";
import type {
  ActionBinding,
  Controller,
  Engine,
  GameDefinition,
  InitApi,
  MatchPhase,
  SurfaceMetrics,
  Transform,
  Vec3,
  World,
} from "./index";
import { installCanvasContexts } from "./testing/canvas";
import type { InstalledContexts } from "./testing/canvas";

/**
 * The documentation's "Game Mode and Scoring" example — Rally, the two-player
 * match played to a score limit — transcribed from
 * `apps/docs/src/content/docs/engines/structured-3d/examples/game-mode-and-scoring.md`
 * and run.
 *
 * The example's modules appear below in the page's order, verbatim except for
 * the seams a test environment forces and nothing else: the package specifier
 * `@test-cabinet/structured-3d` becomes this package's own entry point (this
 * file *is* that package), the canvas `main.ts` finds by `querySelector` is
 * written into the document first, every canvas in that document answers
 * `getContext` through the harness stubs because jsdom has neither a GPU nor a
 * rasterizer, the engine takes a scripted clock and a fixed surface because
 * jsdom performs no layout, and `engine.run()` becomes the caller's
 * `engine.advance` — the adaptation the docs' own Scripted Clocks and
 * Validating a Game pages prescribe. The court, the paddles, the ball's rules,
 * the mode's scoring, and every line of `RallyInstance` are the page's.
 *
 * The assertions are the outcomes the page narrates rather than the absence of
 * a throw. `gameStateClass` is read once and `playerStateClass` on each
 * `addPlayer`, so the mode's `beginPlay` — running after the declared lamp and
 * ball have begun play — is where a paddle first exists. `spawnPoint` returns a
 * whole transform and the court is centered on the origin, so the world's
 * default camera at `(0, 0, 10)` frames both paddles and the whole court with
 * the mode posing nothing. The mode ticks after every actor and after the
 * collision pass, so it decides the point from a settled world; `restart`
 * destroys a controller's pawn, spawns `pawnClass` at `spawnPoint`, and
 * possesses; the cue is played with `at`, so it carries the side of the court
 * the ball left. `setPhase` announces the new phase with the previous one and
 * says nothing for a phase the mode already holds, and the page's closing table
 * fixes which object each figure survives with — the game state with the world,
 * the player state with each `addPlayer`, and `matches` with the instance,
 * which nothing in a match rebuilds.
 *
 * One number is the suite's rather than the page's: the frame step. A step of
 * exactly 1000/60 ms puts the undisturbed serve at `x === 10` on its
 * seventy-fifth frame — the court's own half-width, which the mode's
 * `Math.abs(x) <= COURT.halfWidth` reads as still in play — so whether that
 * frame scores would be decided by the last bit of an accumulated float rather
 * than by the rule. 16 ms per frame moves the crossing clear of the tie: frame
 * 78 leaves the ball at 9.984 and frame 79 carries it to 10.112.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — verbatim                                                */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";

const LEVELS = { rally: "rally" } as const;
const TAGS = { ball: "ball", paddle: "paddle" } as const;
const CUES = { point: "point" } as const;
const COLORS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

const SCORE_LIMIT = 7;
const COURT = { halfWidth: 10, halfHeight: 5 };
const PADDLE = { width: 0.4, height: 2.4, depth: 0.4, inset: 1, speed: 9 };
const BALL = { radius: 0.25, speed: 8, drift: 3 };

const AXES: readonly (readonly [up: string, down: string])[] = [
  ["move-up", "move-down"],
  ["look-up", "look-down"],
];

const ACTIONS: Record<string, ActionBinding> = {
  "move-up": { keys: ["KeyW"], kind: "analog" },
  "move-down": { keys: ["KeyS"], kind: "analog" },
  "look-up": { keys: ["ArrowUp"], kind: "analog" },
  "look-down": { keys: ["ArrowDown"], kind: "analog" },
};

/* -------------------------------------------------------------------------- */
/* src/state.ts — verbatim                                                    */
/* -------------------------------------------------------------------------- */

class RallyPlayerState extends PlayerState {
  aces = 0;
}

class RallyState extends GameState {
  declare readonly players: readonly RallyPlayerState[];
  rallies = 0;
}

function rallyState(world: World): RallyState {
  return world.state as RallyState;
}

/* -------------------------------------------------------------------------- */
/* src/actors/lamp.ts — verbatim                                              */
/* -------------------------------------------------------------------------- */

class Lamp extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    const sun = this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
    sun.offset.rotation = quatFromEuler(-Math.PI / 4, Math.PI / 4, 0);
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/ball.ts — verbatim                                              */
/* -------------------------------------------------------------------------- */

const BALL_SHAPE = { kind: "sphere", radius: BALL.radius } as const;

class Ball extends Actor {
  readonly body = this.attach(
    new MeshComponent({
      geometry: BALL_SHAPE,
      material: { color: COLORS.ball },
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: BALL_SHAPE,
      responses: { default: "overlap" },
    }),
  );

  velocity: Vec3 = vec3(0, 0, 0);
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.position = vec3(0, 0, 0);
    this.velocity = vec3(BALL.speed * direction, BALL.drift, 0);
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    this.transform.position = add(
      this.transform.position,
      scale(this.velocity, dt),
    );
    const limit = COURT.halfHeight - BALL.radius;
    const y = this.transform.position.y;
    if (y < -limit || y > limit) {
      this.velocity = vec3(this.velocity.x, -this.velocity.y, 0);
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(
        this.transform.position.x - contact.actor.transform.position.x,
      );
      this.velocity = vec3(
        Math.abs(this.velocity.x) * away,
        this.velocity.y,
        0,
      );
      rallyState(this.world).rallies += 1;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/paddle.ts — verbatim                                            */
/* -------------------------------------------------------------------------- */

const PADDLE_SHAPE = {
  kind: "box",
  width: PADDLE.width,
  height: PADDLE.height,
  depth: PADDLE.depth,
} as const;

class Paddle extends Pawn {
  readonly body = this.attach(
    new MeshComponent({
      geometry: PADDLE_SHAPE,
      material: { color: COLORS.paddle },
    }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: PADDLE_SHAPE,
      responses: { default: "overlap" },
    }),
  );

  constructor() {
    super();
    this.addTag(TAGS.paddle);
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/rally-mode.ts — verbatim                                        */
/* -------------------------------------------------------------------------- */

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    const axis = AXES[this.index];
    if (pawn === null || axis === undefined) return;
    const dir = this.input.value(axis[0]) - this.input.value(axis[1]);
    const limit = COURT.halfHeight - PADDLE.height / 2;
    const current = pawn.transform.position;
    const y = current.y + dir * PADDLE.speed * dt;
    pawn.transform.position = vec3(
      current.x,
      Math.min(Math.max(y, -limit), limit),
      0,
    );
  }
}

class RallyMode extends GameMode {
  declare readonly state: RallyState;

  override gameStateClass = RallyState;
  override playerStateClass = RallyPlayerState;
  override playerControllerClass = PaddleController;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.addPlayer({ index: 0, name: "left" });
    this.addPlayer({ index: 1, name: "right" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    const x = left
      ? PADDLE.inset - COURT.halfWidth
      : COURT.halfWidth - PADDLE.inset;
    return {
      position: vec3(x, 0, 0),
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.position.x;
    if (Math.abs(x) <= COURT.halfWidth) return;

    const scorer = this.state.players[x < 0 ? 1 : 0];
    if (scorer === undefined) return;
    scorer.score += 1;
    if (this.state.rallies === 0) scorer.aces += 1;
    this.state.rallies = 0;
    this.world.audio.play(CUES.point, { at: ball.transform.position });

    if (scorer.score >= SCORE_LIMIT) {
      this.setPhase("over");
      return;
    }
    ball.serve(x < 0 ? 1 : -1);
    for (const controller of this.world.players()) this.restart(controller);
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — verbatim                                                     */
/* -------------------------------------------------------------------------- */

class RallyInstance extends GameInstance<null> {
  matches = 0;

  override initialize(api: InitApi): null {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, binding);
    }
    api.audio.define(CUES.point, { freq: 660, freqTo: 440, durationMs: 90 });
    api.diagnostics.register("matches", () => this.matches);
    api.events.on("match:phase", ({ phase }) => {
      if (phase === "over") this.matches += 1;
    });
    return null;
  }
}

const rally: GameDefinition<null> = {
  instance: RallyInstance,
  levels: {
    [LEVELS.rally]: {
      mode: RallyMode,
      actors: [{ type: Lamp }, { type: Ball, tags: [TAGS.ball] }],
    },
  },
  startLevel: LEVELS.rally,
};

/* -------------------------------------------------------------------------- */
/* The test environment's seams                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a frame is worth. Not 1000/60: see the module header — a sixtieth of a
 * second puts the undisturbed serve exactly on the touchline, so the rule's
 * `<=` would be decided by float accumulation rather than by the court.
 */
const STEP_MS = 16;

/** One frame's worth of simulated seconds under the scripted clock. */
const DT = STEP_MS / 1000;

/**
 * The ball serves from the origin at 8 units/s and the mode scores the frame
 * the ball is strictly outside the court's half-width, so the first frame past
 * `10 / 8` seconds — frame 79 — is the scoring frame of every undisturbed
 * serve. Its `y` drifts 3 units/s from the center and stands at 3.79 when the
 * point falls: above a paddle's top edge at 1.2 and below the ceiling at 4.75,
 * so an unattended serve neither reflects nor is answered.
 */
const FRAMES_PER_POINT = 79;

/**
 * Thirteen unanswered serves alternate sides, so the left player takes points
 * 1, 3, …, 13 and meets the limit on the thirteenth, 7 to 6.
 */
const FRAMES_TO_OVER = 13 * FRAMES_PER_POINT;

/** What each rig exposes: the engine, its instance, and the key seam. */
interface Rig {
  readonly engine: Engine<null>;
  readonly instance: RallyInstance;
  /** Dispatches a `keydown` for `code` at the surface's event target. */
  hold(code: string): void;
  /** Dispatches a `keyup` for `code` at the surface's event target. */
  release(code: string): void;
}

let contexts: InstalledContexts;
const built: Engine<null>[] = [];

/**
 * `src/main.ts`, verbatim up to the seams: the page's markup is written first
 * so the example's `querySelector` finds its canvas, the same `createEngine`
 * options in the same shape, plus the scripted clock and the `SurfaceMetrics`
 * jsdom performs no layout for. The caller advances frames rather than letting
 * `engine.run()` drive them.
 */
function boot(): { engine: Engine<null>; target: EventTarget } {
  document.body.innerHTML = '<canvas id="game"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => 1,
    events: () => target,
  };

  const engine = createEngine({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    layout: "dual-stick",
    game: rally,
    clock: new ConstantClock(STEP_MS),
    surface,
  });
  built.push(engine);
  return { engine, target };
}

/** A booted, initialized engine with the two key helpers over its surface. */
async function createRally(): Promise<Rig> {
  const { engine, target } = boot();
  const instance = (await engine.initialize()) as RallyInstance;
  return {
    engine,
    instance,
    hold: (code) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { code }));
    },
    release: (code) => {
      target.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },
  };
}

/** The world's ball, which every check below expects to exist. */
function ballOf(engine: Engine<null>): Ball {
  const ball = engine.world.find(Ball);
  expect(ball).toBeInstanceOf(Ball);
  return ball as Ball;
}

/** The pawn a controller holds, asserted to be one rather than `null`. */
function pawnOf(controller: Controller): Pawn {
  const pawn = controller.pawn;
  expect(pawn).toBeInstanceOf(Paddle);
  return pawn as Pawn;
}

/** The two player controllers, in the index order `state.players` holds. */
function sides(engine: Engine<null>): [PlayerController, PlayerController] {
  const players = engine.world.players();
  expect(players).toHaveLength(2);
  return [players[0] as PlayerController, players[1] as PlayerController];
}

beforeEach(() => {
  contexts = installCanvasContexts();
});

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  contexts.uninstall();
  document.body.replaceChildren();
});

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("the documentation's Rally example", () => {
  it("opens with the declared actors begun first, then two possessed paddles", async () => {
    const { engine } = boot();
    const spawned: Actor[] = [];
    const phases: { phase: MatchPhase; previous: MatchPhase }[] = [];
    engine.events.on("actor:spawned", ({ actor }) => spawned.push(actor));
    engine.events.on("match:phase", (payload) => phases.push(payload));

    await engine.initialize();

    // `addPlayer` builds the player state, the controller, and the pawn, so
    // `beginPlay` — which runs after the declared lamp and ball have begun
    // play — is where a paddle first exists.
    expect(spawned).toHaveLength(4);
    expect(spawned[0]).toBeInstanceOf(Lamp);
    expect(spawned[1]).toBeInstanceOf(Ball);
    expect(spawned[2]).toBeInstanceOf(Paddle);
    expect(spawned[3]).toBeInstanceOf(Paddle);

    // A mode that starts its match at once: `"playing"`, announced from the
    // `"waiting"` every mode begins play holding.
    const world = engine.world;
    expect(world.level).toBe(LEVELS.rally);
    expect(world.mode).toBeInstanceOf(RallyMode);
    expect(world.state).toBeInstanceOf(RallyState);
    expect(world.mode.phase).toBe("playing");
    expect(world.state.phase).toBe("playing");
    expect(phases).toEqual([{ phase: "playing", previous: "waiting" }]);

    // Two players, held in index order beside their names, scores, and the
    // `aces` the game's own player state adds.
    const state = rallyState(world);
    expect(state.players).toHaveLength(2);
    expect(state.players.map((player) => player.index)).toEqual([0, 1]);
    expect(state.players.map((player) => player.name)).toEqual([
      "left",
      "right",
    ]);
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
    expect(state.players.map((player) => player.aces)).toEqual([0, 0]);
    expect(state.players[0]).toBeInstanceOf(RallyPlayerState);
    expect(state.rallies).toBe(0);
    expect(state.elapsed).toBe(0);

    // `spawnPoint` returns a whole transform, so each paddle arrives placed,
    // unrotated, and unscaled — one inset from its own end of the court.
    const [left, right] = sides(engine);
    expect(pawnOf(left).hasTag(TAGS.paddle)).toBe(true);
    expect(pawnOf(left).transform).toEqual({
      position: { x: PADDLE.inset - COURT.halfWidth, y: 0, z: 0 },
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    });
    expect(pawnOf(right).transform.position).toEqual({
      x: COURT.halfWidth - PADDLE.inset,
      y: 0,
      z: 0,
    });

    // Each controller holds its own pawn, and each pawn its controller.
    expect(pawnOf(left)).not.toBe(pawnOf(right));
    expect(pawnOf(left).controller).toBe(left);
    expect(pawnOf(right).controller).toBe(right);

    // The declared ball begun play by serving toward the right, from the
    // court's center.
    const ball = ballOf(engine);
    expect(ball.hasTag(TAGS.ball)).toBe(true);
    expect(ball.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(ball.velocity).toEqual({ x: BALL.speed, y: BALL.drift, z: 0 });
  });

  it("lights the court from one actor carrying a fill light and a sun", async () => {
    const { engine } = await createRally();
    const lamp = engine.world.find(Lamp);
    expect(lamp).toBeInstanceOf(Lamp);

    const lights = (lamp as Lamp).components.filter(
      (component): component is LightComponent =>
        component instanceof LightComponent,
    );
    expect(lights).toHaveLength(2);

    // The fill is unaimed — a hemisphere light has no direction to aim.
    const fill = lights[0] as LightComponent;
    expect(fill.light).toEqual({ kind: "hemisphere", intensity: 0.6 });
    expect(fill.offset.rotation).toEqual(QUAT_IDENTITY);

    // The sun is aimed the only way a light is aimed: by rotating what carries
    // it. The component's own offset does it, so the actor stays unrotated.
    const sun = lights[1] as LightComponent;
    expect(sun.light).toEqual({ kind: "directional", intensity: 1.2 });
    expect(sun.offset.rotation).toEqual(
      quatFromEuler(-Math.PI / 4, Math.PI / 4, 0),
    );
    expect((lamp as Lamp).transform.rotation).toEqual(QUAT_IDENTITY);
  });

  it("frames the whole court from the world's default camera, unposed", async () => {
    const { engine } = await createRally();
    const camera = engine.world.camera;

    // Nothing in the game touches the camera, so it stands where a world
    // builds one.
    expect(camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(camera.rotation).toEqual(QUAT_IDENTITY);
    expect(camera.projection).toBe("perspective");

    // Both paddles and all four corners of the court project inside the
    // logical field, in front of the camera.
    const [left, right] = sides(engine);
    const corners: Vec3[] = [
      vec3(-COURT.halfWidth, -COURT.halfHeight, 0),
      vec3(-COURT.halfWidth, COURT.halfHeight, 0),
      vec3(COURT.halfWidth, -COURT.halfHeight, 0),
      vec3(COURT.halfWidth, COURT.halfHeight, 0),
    ];
    for (const point of [
      pawnOf(left).transform.position,
      pawnOf(right).transform.position,
      ...corners,
    ]) {
      const projected = camera.worldToLogical(point);
      expect(projected.visible).toBe(true);
      expect(projected.x).toBeGreaterThanOrEqual(0);
      expect(projected.x).toBeLessThanOrEqual(WIDTH);
      expect(projected.y).toBeGreaterThanOrEqual(0);
      expect(projected.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("gives each player one stick of the dual-stick vocabulary", async () => {
    const rig = await createRally();
    const { engine } = rig;

    // All four actions belong to the selected layout, so a touch build gets
    // them from the layout's own sticks rather than from a key.
    const layout = TOUCH_LAYOUTS["dual-stick"];
    expect(layout).toBeDefined();
    for (const [up, down] of AXES) {
      expect(layout?.actions).toContain(up);
      expect(layout?.actions).toContain(down);
    }

    // A stick's deflection reaches the paddle as a magnitude: every action is
    // read through `value`, which rests at 0 and stands at 1 for a held key.
    const [left, right] = sides(engine);
    for (const [up, down] of AXES) {
      expect(left.input.value(up)).toBe(0);
      expect(left.input.value(down)).toBe(0);
    }

    rig.hold("KeyW");
    rig.hold("ArrowDown");
    await engine.advance(1);
    expect(left.input.value("move-up")).toBe(1);
    expect(left.input.value("look-down")).toBe(1);

    // The vocabulary is shared but the axis pair is not: the left player reads
    // only `move-*` and the right only `look-*`, so one held key moves one
    // paddle.
    expect(pawnOf(left).transform.position.y).toBeCloseTo(PADDLE.speed * DT, 9);
    expect(pawnOf(right).transform.position.y).toBeCloseTo(
      -PADDLE.speed * DT,
      9,
    );
  });

  it("drives each paddle along its own axis and clamps it inside the court", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const limit = COURT.halfHeight - PADDLE.height / 2;
    const [left, right] = sides(engine);

    // Half a second of `move-down` at 9 units/s would carry the left paddle
    // 4.5 units; the clamp stops it 3.8 from the center.
    rig.hold("KeyS");
    await engine.advance(30);
    rig.release("KeyS");

    expect(pawnOf(left).transform.position.y).toBeCloseTo(-limit, 9);
    expect(pawnOf(left).transform.position.x).toBe(
      PADDLE.inset - COURT.halfWidth,
    );
    expect(pawnOf(left).transform.position.z).toBe(0);
    expect(pawnOf(right).transform.position.y).toBe(0);

    // The right stick clamps the right paddle at the ceiling, and the left
    // paddle — reading only its own axis — holds where the clamp left it.
    rig.hold("ArrowUp");
    await engine.advance(30);
    rig.release("ArrowUp");

    expect(pawnOf(right).transform.position.y).toBeCloseTo(limit, 9);
    expect(pawnOf(right).transform.position.x).toBe(
      COURT.halfWidth - PADDLE.inset,
    );
    expect(pawnOf(left).transform.position.y).toBeCloseTo(-limit, 9);

    // Released, both rest: no input is no movement.
    await engine.advance(10);
    expect(pawnOf(left).transform.position.y).toBeCloseTo(-limit, 9);
    expect(pawnOf(right).transform.position.y).toBeCloseTo(limit, 9);
  });

  it("reflects the ball off the court's ceiling and floor", async () => {
    const { engine } = await createRally();
    const ball = ballOf(engine);
    const limit = COURT.halfHeight - BALL.radius;

    // One frame from just under the ceiling crosses it and flips the drift.
    ball.transform.position = vec3(0, limit - 0.01, 0);
    ball.velocity = vec3(0, BALL.drift, 0);
    await engine.advance(1);
    expect(ball.transform.position.y).toBeGreaterThan(limit);
    expect(ball.velocity.y).toBe(-BALL.drift);

    // The next frame moves back inside the court, and nothing flips twice.
    await engine.advance(1);
    expect(ball.transform.position.y).toBeLessThan(limit);
    expect(ball.velocity.y).toBe(-BALL.drift);

    // The floor, symmetrically.
    ball.transform.position = vec3(0, -limit + 0.01, 0);
    ball.velocity = vec3(0, -BALL.drift, 0);
    await engine.advance(1);
    expect(ball.velocity.y).toBe(BALL.drift);

    // The reflection is the ball's own rule about `y`: the frame it fires
    // leaves `x` and `z` alone, and the engine moved nothing.
    expect(ball.velocity.x).toBe(0);
    expect(ball.velocity.z).toBe(0);
  });

  it("reflects off a paddle once per contact and counts the rally", async () => {
    const { engine } = await createRally();
    const world = engine.world;
    const ball = ballOf(engine);
    const [, right] = sides(engine);
    const paddleX = pawnOf(right).transform.position.x;

    // One frame carries the ball into the right paddle: the two colliders
    // answer the default channel with `overlap`, so the engine reports the
    // pair and moves nothing, and the ball reflects itself away.
    ball.transform.position = vec3(paddleX - 0.4, 0, 0);
    ball.velocity = vec3(BALL.speed, 0, 0);
    await engine.advance(1);
    expect(ball.velocity.x).toBe(-BALL.speed);
    expect(ball.transform.position.x).toBeGreaterThan(paddleX - 0.4);
    expect(rallyState(world).rallies).toBe(1);

    // Still inside the paddle on the next frame, but `lastHit` keeps one
    // contact to one reflection and one count.
    await engine.advance(1);
    expect(ball.velocity.x).toBe(-BALL.speed);
    expect(rallyState(world).rallies).toBe(1);

    // The reflection took the sign from the paddle's own position, so the ball
    // leaves the way it came in — away from the paddle it met.
    await engine.advance(3);
    expect(ball.transform.position.x).toBeLessThan(paddleX);
    expect(rallyState(world).rallies).toBe(1);
  });

  it("scores the point from a settled world: the cue, the serve, the restart", async () => {
    const { engine } = await createRally();
    const world = engine.world;
    const state = rallyState(world);
    const [left, right] = sides(engine);
    const firstPawns = [pawnOf(left), pawnOf(right)];
    const firstStates = [state.players[0], state.players[1]];

    const cues: { cue: string; at: Vec3 | null }[] = [];
    const destroyed: Actor[] = [];
    engine.events.on("cue:played", ({ cue, at }) => cues.push({ cue, at }));
    engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor));

    // Frame 78 leaves the undisturbed serve inside the court...
    await engine.advance(FRAMES_PER_POINT - 1);
    expect(ballOf(engine).transform.position.x).toBeLessThan(COURT.halfWidth);
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
    expect(cues).toEqual([]);

    // ...and frame 79 carries it past the right end, where the mode — ticking
    // after every actor and after the collision pass — decides the point from
    // a settled world.
    await engine.advance(1);

    expect(state.players[0]?.score).toBe(1);
    expect(state.players[1]?.score).toBe(0);
    // A point taken on a rally of zero is an ace, and the rally count resets
    // whether or not it was one.
    expect(state.players[0]?.aces).toBe(1);
    expect(state.players[1]?.aces).toBe(0);
    expect(state.rallies).toBe(0);

    // The cue is played with `at`, so it sounds from the side of the court the
    // ball left rather than from nowhere.
    expect(cues).toHaveLength(1);
    expect(cues[0]?.cue).toBe(CUES.point);
    expect(cues[0]?.at?.x).toBeGreaterThan(COURT.halfWidth);
    expect(cues[0]?.at?.y).toBeCloseTo(BALL.drift * DT * FRAMES_PER_POINT, 9);

    // The ball was served back toward the side that conceded, from the center.
    const ball = ballOf(engine);
    expect(ball.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(ball.velocity).toEqual({ x: -BALL.speed, y: BALL.drift, z: 0 });

    // `restart` destroyed each controller's pawn, spawned `pawnClass` at
    // `spawnPoint(controller)`, and possessed it.
    expect(pawnOf(left)).not.toBe(firstPawns[0]);
    expect(pawnOf(right)).not.toBe(firstPawns[1]);
    // The frame's deferred destroys run in reverse spawn order, so the right
    // paddle — restarted second — leaves the world first.
    expect(destroyed).toEqual([firstPawns[1], firstPawns[0]]);
    expect(pawnOf(left).transform.position).toEqual({
      x: PADDLE.inset - COURT.halfWidth,
      y: 0,
      z: 0,
    });
    expect(pawnOf(right).transform.position).toEqual({
      x: COURT.halfWidth - PADDLE.inset,
      y: 0,
      z: 0,
    });

    // The player states are the durable half: a restart rebuilt neither, so
    // the score just taken survives the pawn that took it.
    expect(state.players[0]).toBe(firstStates[0]);
    expect(state.players[1]).toBe(firstStates[1]);
    expect(engine.world.players()[0]).toBe(left);
  });

  it("scores no ace for a point whose rally was answered", async () => {
    const { engine } = await createRally();
    const world = engine.world;
    const state = rallyState(world);
    const ball = ballOf(engine);
    const [, right] = sides(engine);

    // One paddle contact, counted by the ball...
    ball.transform.position = vec3(
      pawnOf(right).transform.position.x - 0.4,
      0,
      0,
    );
    ball.velocity = vec3(BALL.speed, 0, 0);
    await engine.advance(1);
    expect(state.rallies).toBe(1);

    // ...and then the ball is put past the right end by hand. The point is the
    // same point, but `rallies` was not zero when it fell, so it is no ace.
    ball.transform.position = vec3(COURT.halfWidth + 1, 0, 0);
    ball.velocity = vec3(BALL.speed, 0, 0);
    await engine.advance(1);

    expect(state.players[0]?.score).toBe(1);
    expect(state.players[0]?.aces).toBe(0);
    expect(state.rallies).toBe(0);
  });

  it("gives the point to the player whose end the ball did not leave", async () => {
    const { engine } = await createRally();
    const state = rallyState(engine.world);
    const ball = ballOf(engine);

    // Past the left end: the point is the right player's.
    ball.transform.position = vec3(-COURT.halfWidth - 1, 0, 0);
    ball.velocity = vec3(-BALL.speed, 0, 0);
    await engine.advance(1);

    expect(state.players[1]?.score).toBe(1);
    expect(state.players[0]?.score).toBe(0);
    // And the serve goes back toward the end the ball left.
    expect(ballOf(engine).velocity.x).toBe(BALL.speed);
  });

  it("ends the match at the score limit and counts it on the instance", async () => {
    const { engine, instance } = await createRally();
    const state = rallyState(engine.world);

    const phases: { phase: MatchPhase; previous: MatchPhase }[] = [];
    const cues: string[] = [];
    engine.events.on("match:phase", (payload) => phases.push(payload));
    engine.events.on("cue:played", ({ cue }) => cues.push(cue));

    // Thirteen unanswered serves alternate the point until the left player's
    // seventh meets the limit.
    await engine.advance(FRAMES_TO_OVER);

    expect(engine.world.mode.phase).toBe("over");
    expect(state.phase).toBe("over");
    expect(phases).toEqual([{ phase: "over", previous: "playing" }]);
    expect(state.players[0]?.score).toBe(SCORE_LIMIT);
    expect(state.players[1]?.score).toBe(SCORE_LIMIT - 1);
    expect(state.players[0]?.aces).toBe(SCORE_LIMIT);
    expect(state.players[1]?.aces).toBe(SCORE_LIMIT - 1);
    expect(cues).toEqual(Array.from({ length: 13 }, () => CUES.point));

    // The instance counted the match from its `match:phase` subscription, and
    // its diagnostic — registered once, on a figure no world holds — reads it.
    expect(instance.matches).toBe(1);
    expect(engine.diagnostics()).toContainEqual({ name: "matches", value: 1 });

    // The point that met the limit did not serve the ball back: the mode
    // returned on the phase change instead.
    expect(ballOf(engine).transform.position.x).toBeGreaterThan(
      COURT.halfWidth,
    );

    // `elapsed` is the match clock, accumulated only while the phase is
    // `"playing"`, so it stops at the over frame while `world.time` runs on.
    const elapsedAtOver = state.elapsed;
    expect(elapsedAtOver).toBeCloseTo(FRAMES_TO_OVER * DT, 9);
    await engine.advance(60);
    expect(state.elapsed).toBe(elapsedAtOver);
    expect(engine.world.time).toBeCloseTo((FRAMES_TO_OVER + 60) * DT, 9);

    // And the mode's tick stops scoring at `"over"`: sixty more frames of a
    // ball well outside the court change nothing.
    expect(state.players[0]?.score).toBe(SCORE_LIMIT);
    expect(state.players[1]?.score).toBe(SCORE_LIMIT - 1);
    expect(cues).toHaveLength(13);
    expect(phases).toHaveLength(1);
    expect(instance.matches).toBe(1);
  });

  it("rebuilds each figure with the holder the page's table names", async () => {
    const { engine, instance } = await createRally();
    const first = engine.world;
    const firstState = rallyState(first);
    const firstPlayers = [...firstState.players];

    // Put a figure on each of the three holders: a rally on the game state, a
    // score and an ace on a player state, and a match on the instance.
    const ball = ballOf(engine);
    const [, right] = sides(engine);
    ball.transform.position = vec3(
      pawnOf(right).transform.position.x - 0.4,
      0,
      0,
    );
    ball.velocity = vec3(BALL.speed, 0, 0);
    await engine.advance(1);
    expect(firstState.rallies).toBe(1);

    ball.transform.position = vec3(COURT.halfWidth + 1, 0, 0);
    await engine.advance(1);
    expect(firstState.players[0]?.score).toBe(1);
    expect(firstState.players[0]?.aces).toBe(0);

    const served = ballOf(engine);
    served.transform.position = vec3(
      pawnOf(sides(engine)[0]).transform.position.x + 0.4,
      0,
      0,
    );
    await engine.advance(1);
    expect(firstState.rallies).toBe(1);

    (first.mode as RallyMode).setPhase("over");
    expect(instance.matches).toBe(1);
    expect(firstState.elapsed).toBeGreaterThan(0);

    // Opening a level builds a new world, and the game state and every player
    // state are built with it — so a match's figures clear without the
    // instance doing anything.
    first.open(LEVELS.rally);
    await engine.advance(1);

    const second = engine.world;
    expect(second).not.toBe(first);
    const state = rallyState(second);
    expect(state).not.toBe(firstState);
    expect(state).toBeInstanceOf(RallyState);
    expect(state.rallies).toBe(0);
    // The transition is taken after the outgoing world's tick, so the frame
    // that opened this world simulated none of it: its clocks stand at zero.
    expect(state.elapsed).toBe(0);
    expect(second.time).toBe(0);
    expect(state.phase).toBe("playing");
    expect(state.players[0]).not.toBe(firstPlayers[0]);
    expect(state.players[1]).not.toBe(firstPlayers[1]);
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
    expect(state.players.map((player) => player.aces)).toEqual([0, 0]);
    expect(state.players.map((player) => player.name)).toEqual([
      "left",
      "right",
    ]);

    // The instance is the one framework object kept across a transition, so
    // the figure that outlives the match — and the diagnostic reading it —
    // outlive it too.
    expect(engine.instance).toBe(instance);
    expect(instance.matches).toBe(1);
    expect(engine.diagnostics()).toContainEqual({ name: "matches", value: 1 });
  });

  it("says nothing for a phase the mode already holds", async () => {
    const { engine, instance } = await createRally();
    const mode = engine.world.mode as RallyMode;

    const phases: MatchPhase[] = [];
    engine.events.on("match:phase", ({ phase }) => phases.push(phase));

    mode.setPhase("playing");
    expect(phases).toEqual([]);
    expect(instance.matches).toBe(0);

    // A phase it does not hold is announced with the one it held, and the
    // instance's subscription counts the match exactly once.
    mode.setPhase("over");
    mode.setPhase("over");
    expect(phases).toEqual(["over"]);
    expect(instance.matches).toBe(1);
    expect(engine.world.state.phase).toBe("over");
  });
});
