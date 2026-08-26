import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Actor, Pawn } from "./actors";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import { ShapeComponent, type Shape3 } from "./components";
import { PlayerController, type Controller } from "./controllers";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode, GameState, PlayerState } from "./game-mode";
import { TOUCH_LAYOUTS, type ActionBinding } from "./input";
import type { Transform, Vec3 } from "./math";
import type { World } from "./worlds";

/**
 * The documentation's worked example "Game Mode and Scoring", transcribed and
 * run. The page's modules below — the constants, the game definition, the
 * subclassed states, `Ball`, `Paddle`, and `RallyMode` with its
 * `PaddleController` — are copied from the page unchanged. Only what a test
 * environment forces is adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and a
 *   `SurfaceMetrics` over a bare `EventTarget` reports its size and carries
 *   the key events a player's keyboard would deliver. The element is smaller
 *   than the design field, which a software rasterizer forces and which none
 *   of the page's world arithmetic depends on.
 * - `engine.run()` becomes `engine.advance` under a `ConstantClock`, so a
 *   duration is a frame count.
 * - Where a check needs a situation the rally does not reach on its own, it
 *   poses one by writing the world's own state — the ball's transform and
 *   velocity, a player's score — which is what the page's own figures table
 *   says those fields are for.
 *
 * The assertions are the outcomes the page narrates: when each class field is
 * read, what `addPlayer` builds and in what order, the whole `Transform`
 * `spawnPoint` returns, the settled world a mode decides a point from, what
 * `restart` rebuilds and what it leaves standing, the phase rules, and the
 * table of where each figure lives.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — transcribed verbatim                                    */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";

const LEVELS = { rally: "rally" } as const;
const TAGS = { ball: "ball", paddle: "paddle" } as const;
const CUES = { point: "point" } as const;
const COLORS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

const SCORE_LIMIT = 7;
const COURT = { halfWidth: 8, halfDepth: 4.5 };
const PADDLE = {
  size: { x: 0.4, y: 0.8, z: 2.4 } as Vec3,
  inset: 1,
  speed: 8,
};
const BALL = { radius: 0.25, speed: 7, drift: 2.5 };

const ACTIONS: Record<string, ActionBinding> = {
  "p1-up": { keys: ["KeyW"] },
  "p1-down": { keys: ["KeyS"] },
  "p2-up": { keys: ["ArrowUp"] },
  "p2-down": { keys: ["ArrowDown"] },
};

/* -------------------------------------------------------------------------- */
/* src/state.ts — transcribed verbatim                                        */
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
/* src/actors/ball.ts — transcribed verbatim                                  */
/* -------------------------------------------------------------------------- */

const BALL_SHAPE: Shape3 = { kind: "sphere", radius: BALL.radius };

class Ball extends Actor {
  readonly body = this.attach(
    new ShapeComponent({ shape: BALL_SHAPE, color: COLORS.ball }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: BALL_SHAPE,
      responses: { default: "overlap" },
    }),
  );

  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: BALL.speed * direction, y: 0, z: BALL.drift };
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    const p = this.transform.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    const wall = COURT.halfDepth - BALL.radius;
    if (p.z < -wall || p.z > wall) {
      this.velocity.z = -this.velocity.z;
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(p.x - contact.actor.transform.position.x);
      this.velocity.x = Math.abs(this.velocity.x) * away;
      rallyState(this.world).rallies += 1;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/paddle.ts — transcribed verbatim                                */
/* -------------------------------------------------------------------------- */

const PADDLE_SHAPE: Shape3 = { kind: "box", size: PADDLE.size };

class Paddle extends Pawn {
  readonly body = this.attach(
    new ShapeComponent({ shape: PADDLE_SHAPE, color: COLORS.paddle }),
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
/* src/levels/rally-mode.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    if (pawn === null) return;
    const side = this.index === 0 ? "p1" : "p2";
    const dir =
      this.input.value(`${side}-down`) - this.input.value(`${side}-up`);
    const limit = COURT.halfDepth - PADDLE.size.z / 2;
    const p = pawn.transform.position;
    p.z = Math.min(Math.max(p.z + dir * PADDLE.speed * dt, -limit), limit);
  }
}

class RallyMode extends GameMode {
  declare readonly state: RallyState;

  override gameStateClass = RallyState;
  override playerStateClass = RallyPlayerState;
  override playerControllerClass = PaddleController;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 10, z: 9 };
    this.world.camera.lookAt({ x: 0, y: 0, z: 0 });
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
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.position.x;
    if (Math.abs(x) <= COURT.halfWidth) return;

    const scorer = this.state.players[x < 0 ? 1 : 0];
    scorer.score += 1;
    if (this.state.rallies === 0) scorer.aces += 1;
    this.state.rallies = 0;
    this.world.audio.play(CUES.point);

    if (scorer.score >= SCORE_LIMIT) {
      this.setPhase("over");
      return;
    }
    ball.serve(x < 0 ? 1 : -1);
    for (const controller of this.world.players()) this.restart(controller);
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
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
      actors: [{ type: Ball, tags: [TAGS.ball] }],
    },
  },
  startLevel: LEVELS.rally,
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the forced adaptations                     */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

interface Rally {
  readonly engine: Engine<null>;
  readonly phases: { phase: string; previous: string }[];
  world(): World;
  ball(): Ball;
  paddles(): readonly Actor[];
  hold(code: string): void;
  release(code: string): void;
  dispose(): void;
}

async function boot(): Promise<Rally> {
  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => target,
  };
  const engine = createEngine<null>({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    game: rally,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  // Subscribed before any game code runs, so the very first `setPhase` the
  // mode's `beginPlay` performs is observed with the phase it moved from.
  const phases: { phase: string; previous: string }[] = [];
  engine.events.on("match:phase", ({ phase, previous }) =>
    phases.push({ phase, previous }),
  );

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    target.dispatchEvent(
      Object.assign(new Event(type), { code, repeat: false }),
    );
  };

  return {
    engine,
    phases,
    world: () => engine.world,
    ball: () => {
      const found = engine.world.find(Ball);
      if (found === null) throw new Error("the rally holds no ball");
      return found;
    },
    paddles: () => engine.world.byTag(TAGS.paddle),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    dispose: () => engine.destroy(),
  };
}

/** Parks the ball, so a check that is not about the rally is not interrupted. */
function park(ball: Ball): void {
  ball.transform.position = { x: 0, y: 0, z: 0 };
  ball.velocity = { x: 0, y: 0, z: 0 };
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("examples/game-mode-and-scoring", () => {
  let rallyGame: Rally;

  beforeEach(async () => {
    rallyGame = await boot();
  });

  afterEach(() => {
    rallyGame.dispose();
  });

  it("names no touch layout, the catalogue carrying no two-player one", () => {
    // "The touch-layout catalogue carries no two-player layout, so the build
    // names none and the four actions stay keyboard-driven."
    const vocabularies = Object.values(TOUCH_LAYOUTS).flatMap(
      (layout) => layout.actions,
    );
    for (const action of Object.keys(ACTIONS)) {
      expect(vocabularies).not.toContain(action);
    }
  });

  it("builds the subclassed states, the state once and a player state per player", () => {
    // "`gameStateClass` is read once, when the world is built, and
    // `playerStateClass` on each `addPlayer`."
    const world = rallyGame.world();
    expect(world.state).toBeInstanceOf(RallyState);
    expect(rallyState(world).rallies).toBe(0);
    expect(world.state.players).toHaveLength(2);
    for (const player of world.state.players) {
      expect(player).toBeInstanceOf(RallyPlayerState);
    }
    expect(world.state.players.map((player) => player.name)).toEqual([
      "left",
      "right",
    ]);
    expect(world.state.players.map((player) => player.index)).toEqual([0, 1]);
  });

  it("builds a paddle only when the mode adds its players, after the declared ball", () => {
    // "the declared ball has begun play" before `beginPlay`, "which is where a
    // paddle first exists" — so the ball's id is the lower one.
    const world = rallyGame.world();
    const ball = rallyGame.ball();
    const paddles = rallyGame.paddles();

    expect(paddles).toHaveLength(2);
    expect(world.actors()[0]).toBe(ball);
    for (const paddle of paddles) expect(paddle.id).toBeGreaterThan(ball.id);
    for (const player of world.players()) {
      expect(player.pawn).toBeInstanceOf(Paddle);
      expect(player).toBeInstanceOf(PaddleController);
    }
  });

  it("puts each paddle at its own end, at identity rotation and unit scale", () => {
    // "`spawnPoint` returns a whole `Transform`, each paddle at its own end at
    // identity rotation and unit scale."
    const [left, right] = rallyGame.paddles();
    expect(left?.transform.position).toEqual({
      x: PADDLE.inset - COURT.halfWidth,
      y: 0,
      z: 0,
    });
    expect(right?.transform.position).toEqual({
      x: COURT.halfWidth - PADDLE.inset,
      y: 0,
      z: 0,
    });
    expect(left?.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(left?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(right?.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("frames the court from above the center line, screen up being −z", async () => {
    // "the camera is part of the world, so `beginPlay` frames the court first,
    // from above the center line; with the camera on +z looking down at the
    // origin, 'up' on the screen is −z, which is what the controller's
    // `up`/`down` difference moves along."
    const { camera } = rallyGame.world();
    expect(camera.position).toEqual({ x: 0, y: 10, z: 9 });

    const center = camera.project({ x: 0, y: 0, z: 0 });
    expect(center?.x).toBeCloseTo(WIDTH / 2, 6);
    expect(center?.y).toBeCloseTo(HEIGHT / 2, 6);

    const far = camera.project({ x: 0, y: 0, z: -3 });
    const near = camera.project({ x: 0, y: 0, z: 3 });
    expect(far?.y).toBeLessThan(center?.y ?? 0);
    expect(near?.y).toBeGreaterThan(center?.y ?? 0);
  });

  it("moves each paddle along z from its own half of the vocabulary", async () => {
    const { engine } = rallyGame;
    park(rallyGame.ball());
    const [left, right] = rallyGame.paddles();

    rallyGame.hold("KeyS");
    rallyGame.hold("ArrowUp");
    await engine.advance(15);

    // A quarter of a second at the stated speed, in opposite directions, and
    // player 1's keys move player 1's paddle alone.
    expect(left?.transform.position.z).toBeCloseTo(PADDLE.speed / 4, 6);
    expect(right?.transform.position.z).toBeCloseTo(-PADDLE.speed / 4, 6);

    // Held long enough, each stops at the court's own limit.
    rallyGame.release("ArrowUp");
    await engine.advance(60);
    expect(left?.transform.position.z).toBeCloseTo(
      COURT.halfDepth - PADDLE.size.z / 2,
      9,
    );
  });

  it("bounces the ball off the long walls at the stated line", async () => {
    // "bouncing off the long walls at `±(halfDepth − radius)` ... are the
    // ball's own rules, all in world units on the ground plane."
    const { engine } = rallyGame;
    const ball = rallyGame.ball();
    ball.transform.position = { x: 0, y: 0, z: 4 };
    ball.velocity = { x: 0, y: 0, z: 7 };

    const wall = COURT.halfDepth - BALL.radius;
    while (ball.velocity.z > 0) await engine.advance(1);

    expect(ball.transform.position.z).toBeGreaterThan(wall);
    expect(ball.velocity.z).toBe(-7);
  });

  it("reflects off a paddle once per contact and counts the rally", async () => {
    // "Both colliders sit on the default channel and answer it with
    // `overlap`, so the engine reports the pair and moves nothing.
    // Reflecting off the paddle ... and counting the contact are the ball's
    // own rules."
    const { engine } = rallyGame;
    const world = rallyGame.world();
    const ball = rallyGame.ball();
    const [left] = rallyGame.paddles();
    if (left === undefined) throw new Error("the rally holds no paddle");

    ball.transform.position = { x: -6, y: 0, z: 0 };
    ball.velocity = { x: -BALL.speed, y: 0, z: 0 };

    while (ball.velocity.x < 0) await engine.advance(1);

    expect(ball.velocity.x).toBe(BALL.speed);
    expect(rallyState(world).rallies).toBe(1);
    // The paddle answered `overlap`, so nothing moved it.
    expect(left.transform.position).toEqual({
      x: PADDLE.inset - COURT.halfWidth,
      y: 0,
      z: 0,
    });

    // Still inside the paddle on the next frames, and the contact is not
    // counted again.
    await engine.advance(2);
    expect(rallyState(world).rallies).toBe(1);
  });

  it("decides the point from a settled world, on the frame the ball leaves", async () => {
    // "The mode ticks after every actor has ticked and after collision has
    // been reported, so it decides the point from a settled world."
    const { engine } = rallyGame;
    const world = rallyGame.world();
    const ball = rallyGame.ball();
    const before = rallyGame.paddles();

    const cues: string[] = [];
    engine.events.on("cue:played", ({ cue }) => cues.push(cue));

    ball.transform.position = { x: COURT.halfWidth - 0.05, y: 0, z: 0 };
    ball.velocity = { x: BALL.speed, y: 0, z: 0 };
    await engine.advance(1);

    // One frame: the ball moved past the line, the mode read it there, and the
    // point was awarded, sounded, and served again.
    expect(world.state.players[0].score).toBe(1);
    expect(world.state.players[1].score).toBe(0);
    expect(rallyState(world).players[0].aces).toBe(1);
    expect(rallyState(world).rallies).toBe(0);
    expect(cues).toEqual([CUES.point]);
    expect(ball.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(ball.velocity).toEqual({ x: -BALL.speed, y: 0, z: BALL.drift });

    // "`restart` destroys a controller's pawn, spawns `pawnClass` at
    // `spawnPoint(controller)`, and possesses it."
    const after = rallyGame.paddles();
    expect(after).toHaveLength(2);
    expect(after[0]).not.toBe(before[0]);
    expect(before[0]?.alive).toBe(false);
    expect(after[0]?.transform.position).toEqual({
      x: PADDLE.inset - COURT.halfWidth,
      y: 0,
      z: 0,
    });
    for (const player of world.players()) {
      expect(player.pawn).toBe(after[player.index]);
    }
    // The player states are not rebuilt by a restart: the score stands.
    expect(world.state.players[0].score).toBe(1);
  });

  it("counts an ace only when the point went unreturned", async () => {
    // "`rallies` is read by the ball and by the mode and means nothing outside
    // this match", and an ace is a point scored with none.
    const { engine } = rallyGame;
    const world = rallyGame.world();
    const ball = rallyGame.ball();

    rallyState(world).rallies = 2;
    ball.transform.position = { x: COURT.halfWidth - 0.05, y: 0, z: 0 };
    ball.velocity = { x: BALL.speed, y: 0, z: 0 };
    await engine.advance(1);

    expect(world.state.players[0].score).toBe(1);
    expect(rallyState(world).players[0].aces).toBe(0);
    expect(rallyState(world).rallies).toBe(0);
  });

  it("moves to waiting, then playing, and repeats no phase it already holds", async () => {
    // "A mode's `phase` is `"waiting"` when it begins play, so a mode that
    // starts its match at once calls `setPhase("playing")` from `beginPlay`.
    // ... Setting the phase the mode already holds emits nothing."
    const world = rallyGame.world();
    expect(rallyGame.phases).toEqual([
      { phase: "playing", previous: "waiting" },
    ]);
    expect(world.mode.phase).toBe("playing");
    expect(world.state.phase).toBe("playing");

    world.mode.setPhase("playing");
    expect(rallyGame.phases).toHaveLength(1);
  });

  it("ends the match at the score limit, which is what the instance counts", async () => {
    // "`RallyMode` reaches `"over"` on the point that meets the score limit,
    // which is where its `tick` stops scoring and where `RallyInstance` counts
    // the match from its `match:phase` subscription."
    const { engine } = rallyGame;
    const world = rallyGame.world();
    const ball = rallyGame.ball();
    const paddles = rallyGame.paddles();
    world.state.players[0].score = SCORE_LIMIT - 1;

    ball.transform.position = { x: COURT.halfWidth - 0.05, y: 0, z: 0 };
    ball.velocity = { x: BALL.speed, y: 0, z: 0 };
    await engine.advance(1);

    expect(world.state.players[0].score).toBe(SCORE_LIMIT);
    expect(world.mode.phase).toBe("over");
    expect(world.state.phase).toBe("over");
    expect(rallyGame.phases).toEqual([
      { phase: "playing", previous: "waiting" },
      { phase: "over", previous: "playing" },
    ]);
    // The winning point neither served again nor restarted the paddles.
    expect(rallyGame.paddles()[0]).toBe(paddles[0]);
    expect(ball.transform.position.x).toBeGreaterThan(COURT.halfWidth);

    // "A figure that outlives the match belongs to the game instance."
    expect((engine.instance as RallyInstance).matches).toBe(1);

    // "its `tick` stops scoring": the ball is still past the line and no
    // further point is awarded.
    await engine.advance(5);
    expect(world.state.players[0].score).toBe(SCORE_LIMIT);
    expect((engine.instance as RallyInstance).matches).toBe(1);
  });

  it("accumulates elapsed only while the phase is playing", async () => {
    // "`elapsed` ... the match clock that accumulates only while the phase is
    // `"playing"`."
    const { engine } = rallyGame;
    const world = rallyGame.world();
    park(rallyGame.ball());

    await engine.advance(30);
    expect(world.state.elapsed).toBeCloseTo(0.5, 6);
    expect(world.time).toBeCloseTo(0.5, 6);

    world.mode.setPhase("over");
    await engine.advance(30);
    expect(world.state.elapsed).toBeCloseTo(0.5, 6);
    expect(world.time).toBeCloseTo(1, 6);
  });
});
