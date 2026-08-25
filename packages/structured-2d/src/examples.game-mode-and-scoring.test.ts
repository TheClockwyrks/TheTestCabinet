import { describe, expect, it } from "vitest";
import { Actor, Pawn } from "./actors";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import { ShapeComponent } from "./components";
import type {
  ActionBinding,
  Controller,
  Engine,
  GameDefinition,
  InitApi,
  Shape,
  Transform,
  World,
} from "./contract";
import { PlayerController } from "./controllers";
import { createEngine } from "./engine";
import { GameInstance } from "./game-instance";
import { GameMode, GameState, PlayerState } from "./game-mode";

/**
 * The documentation's "Game Mode and Scoring" example — Rally, the two-player
 * match played to a score limit — transcribed as faithfully as the test
 * environment allows and then asserted against the outcomes the page narrates.
 *
 * Source: apps/docs/src/content/docs/engines/structured-2d/examples/game-mode-and-scoring.md
 *
 * The example's modules are inlined below in their documented order, verbatim
 * except for what a test forces: the package specifier becomes the local
 * modules, the canvas `main.ts` queries off a document becomes a hand-written
 * stub, and `engine.run()` under requestAnimationFrame becomes `engine.advance`
 * under a `ConstantClock` — the adaptation the docs' own Validating a Game and
 * Scripted Clocks pages prescribe.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts, verbatim                                                 */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const BACKGROUND = "#0b0f16";

const LEVELS = { rally: "rally" } as const;
const TAGS = { ball: "ball", paddle: "paddle" } as const;
const CUES = { point: "point" } as const;
const FILLS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

const SCORE_LIMIT = 7;
const PADDLE = { width: 12, height: 72, inset: 32, speed: 320 };
const BALL = { radius: 7, speed: 260, drift: 90 };

const ACTIONS: Record<string, ActionBinding> = {
  "p1-up": { keys: ["KeyW"] },
  "p1-down": { keys: ["KeyS"] },
  "p2-up": { keys: ["ArrowUp"] },
  "p2-down": { keys: ["ArrowDown"] },
};

/* -------------------------------------------------------------------------- */
/* src/state.ts, verbatim                                                     */
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
/* src/actors/ball.ts, verbatim                                               */
/* -------------------------------------------------------------------------- */

const BALL_SHAPE: Shape = { kind: "circle", radius: BALL.radius };

class Ball extends Actor {
  readonly body = this.attach(
    new ShapeComponent({ shape: BALL_SHAPE, fill: FILLS.ball }),
  );
  readonly collider = this.attach(
    new ColliderComponent({
      shape: BALL_SHAPE,
      responses: { default: "overlap" },
    }),
  );

  velocity = { x: 0, y: 0 };
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.x = WIDTH / 2;
    this.transform.y = HEIGHT / 2;
    this.velocity = { x: BALL.speed * direction, y: BALL.drift };
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;
    const y = this.transform.y;
    if (y < BALL.radius || y > HEIGHT - BALL.radius) {
      this.velocity.y = -this.velocity.y;
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(this.transform.x - contact.actor.transform.x);
      this.velocity.x = Math.abs(this.velocity.x) * away;
      rallyState(this.world).rallies += 1;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/paddle.ts, verbatim                                             */
/* -------------------------------------------------------------------------- */

const PADDLE_SHAPE: Shape = {
  kind: "rect",
  width: PADDLE.width,
  height: PADDLE.height,
};

class Paddle extends Pawn {
  readonly body = this.attach(
    new ShapeComponent({ shape: PADDLE_SHAPE, fill: FILLS.paddle }),
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
/* src/levels/rally-mode.ts, verbatim                                         */
/* -------------------------------------------------------------------------- */

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    if (pawn === null) return;
    const side = this.index === 0 ? "p1" : "p2";
    const dir =
      this.input.value(`${side}-down`) - this.input.value(`${side}-up`);
    const half = PADDLE.height / 2;
    const y = pawn.transform.y + dir * PADDLE.speed * dt;
    pawn.transform.y = Math.min(Math.max(y, half), HEIGHT - half);
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
    const x = left ? PADDLE.inset : WIDTH - PADDLE.inset;
    return { x, y: HEIGHT / 2, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.x;
    if (x >= 0 && x <= WIDTH) return;

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
/* src/game.ts, verbatim                                                      */
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
/* The harness: what the test environment forces onto src/main.ts             */
/* -------------------------------------------------------------------------- */

/** A canvas reduced to what the engine reads: a context, a size, a style. */
function fakeCanvas(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = { width: 0, height: 0, style: {} };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
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
  ]) {
    ctx[name] = () => {};
  }
  canvas["getContext"] = (kind: string): unknown =>
    kind === "2d" ? ctx : null;
  return canvas as unknown as HTMLCanvasElement;
}

/** The frame step every scenario runs under: sixty frames to the second. */
const STEP_MS = 1000 / 60;
const DT = STEP_MS / 1000;

/**
 * The ball serves at 260 units/s from the field's center and scores when it
 * leaves the field, so the first frame past `320 / 260` seconds — frame 74 —
 * is the scoring frame, every serve, while nothing deflects it. Its y drifts
 * 90 units/s from the center and reaches at most ~291, inside the field and
 * clear of both paddles, so an undisturbed match is 13 alternating aces:
 * the left player takes points 1, 3, …, 13 and the match ends 7 to 6.
 */
const FRAMES_PER_POINT = 74;
const FRAMES_TO_OVER = 13 * FRAMES_PER_POINT;

interface Rig {
  engine: Engine<null>;
  instance: RallyInstance;
  target: EventTarget;
  press(code: string): void;
  release(code: string): void;
}

/**
 * `src/main.ts`, adapted: the same options in the same shape, over a stub
 * canvas, a scripted clock, and a `SurfaceMetrics` whose event target is the
 * seam a held key is dispatched through. `engine.run()` becomes the callers'
 * `engine.advance`.
 */
async function createRally(): Promise<Rig> {
  const target = new EventTarget();
  const engine = createEngine({
    canvas: fakeCanvas(),
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    layout: "dual-vertical",
    game: rally,
    clock: new ConstantClock(STEP_MS),
    surface: {
      cssWidth: () => WIDTH,
      cssHeight: () => HEIGHT,
      dpr: () => 1,
      events: () => target,
    },
  });

  const instance = (await engine.initialize()) as RallyInstance;
  return {
    engine,
    instance,
    target,
    press: (code) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { code })),
    release: (code) =>
      target.dispatchEvent(new KeyboardEvent("keyup", { code })),
  };
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("the rally example", () => {
  it("opens with the declared ball begun first, then two possessed paddles", async () => {
    const target = new EventTarget();
    const spawned: Actor[] = [];
    const phases: unknown[] = [];
    const engine = createEngine({
      canvas: fakeCanvas(),
      width: WIDTH,
      height: HEIGHT,
      background: BACKGROUND,
      layout: "dual-vertical",
      game: rally,
      clock: new ConstantClock(STEP_MS),
      surface: {
        cssWidth: () => WIDTH,
        cssHeight: () => HEIGHT,
        dpr: () => 1,
        events: () => target,
      },
    });
    engine.events.on("actor:spawned", ({ actor }) => spawned.push(actor));
    engine.events.on("match:phase", (payload) => phases.push(payload));
    await engine.initialize();

    // The declared ball exists before the mode's beginPlay adds a paddle.
    expect(spawned).toHaveLength(3);
    expect(spawned[0]).toBeInstanceOf(Ball);
    expect(spawned[1]).toBeInstanceOf(Paddle);
    expect(spawned[2]).toBeInstanceOf(Paddle);

    // A mode that starts its match at once: playing, announced from waiting.
    const world = engine.world;
    expect(world.level).toBe(LEVELS.rally);
    expect(world.mode).toBeInstanceOf(RallyMode);
    expect(world.state).toBeInstanceOf(RallyState);
    expect(world.state.phase).toBe("playing");
    expect(phases).toEqual([{ phase: "playing", previous: "waiting" }]);

    // Two players, held in index order beside their names and scores.
    const state = rallyState(world);
    expect(state.players.map((player) => player.index)).toEqual([0, 1]);
    expect(state.players.map((player) => player.name)).toEqual([
      "left",
      "right",
    ]);
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
    expect(state.players.map((player) => player.aces)).toEqual([0, 0]);
    expect(state.rallies).toBe(0);

    // addPlayer possessed a paddle per controller, spawned at spawnPoint.
    const players = world.players();
    expect(players).toHaveLength(2);
    expect(players[0].pawn).toBeInstanceOf(Paddle);
    expect(players[0].pawn?.hasTag(TAGS.paddle)).toBe(true);
    expect(players[0].pawn?.transform).toMatchObject({
      x: PADDLE.inset,
      y: HEIGHT / 2,
    });
    expect(players[1].pawn?.transform).toMatchObject({
      x: WIDTH - PADDLE.inset,
      y: HEIGHT / 2,
    });

    // The ball begun play served toward the right, from the center.
    const ball = world.find(Ball);
    expect(ball?.hasTag(TAGS.ball)).toBe(true);
    expect(ball?.transform).toMatchObject({ x: WIDTH / 2, y: HEIGHT / 2 });
    expect(ball?.velocity).toEqual({ x: BALL.speed, y: BALL.drift });

    engine.destroy();
  });

  it("drives each paddle from its own half of the action vocabulary, clamped", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const half = PADDLE.height / 2;

    // Thirty frames of p1-down: half a second at 320 units/s runs the left
    // paddle into the clamp at HEIGHT - half three frames early.
    rig.press("KeyS");
    await engine.advance(30);
    rig.release("KeyS");

    const [left, right] = engine.world.players();
    expect(left.pawn?.transform.y).toBeCloseTo(HEIGHT - half, 6);
    expect(left.pawn?.transform.x).toBe(PADDLE.inset);
    expect(right.pawn?.transform.y).toBe(HEIGHT / 2);

    // Thirty frames of p2-up clamp the right paddle at the top; the left
    // paddle, reading only the p1 actions, holds where the clamp left it.
    rig.press("ArrowUp");
    await engine.advance(30);
    rig.release("ArrowUp");

    expect(right.pawn?.transform.y).toBeCloseTo(half, 6);
    expect(right.pawn?.transform.x).toBe(WIDTH - PADDLE.inset);
    expect(left.pawn?.transform.y).toBeCloseTo(HEIGHT - half, 6);

    engine.destroy();
  });

  it("reflects the ball off the field's top and bottom edges", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const ball = engine.world.find(Ball) as Ball;

    // One frame from y=352 at 90 units/s crosses HEIGHT - radius and flips.
    ball.transform.y = 352;
    ball.velocity = { x: 0, y: BALL.drift };
    await engine.advance(1);
    expect(ball.velocity.y).toBe(-BALL.drift);

    // The next frame moves back inside the field; nothing flips twice.
    await engine.advance(1);
    expect(ball.velocity.y).toBe(-BALL.drift);

    // And the top edge, symmetrically.
    ball.transform.y = 8;
    ball.velocity = { x: 0, y: -BALL.drift };
    await engine.advance(1);
    expect(ball.velocity.y).toBe(BALL.drift);

    engine.destroy();
  });

  it("reflects off a paddle once per contact and counts the rally", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const world = engine.world;
    const ball = world.find(Ball) as Ball;

    // One frame from x=600 puts the ball inside the right paddle. The engine
    // reports the overlap and moves nothing; the ball reflects itself away
    // and counts the contact.
    ball.transform.x = 600;
    ball.transform.y = HEIGHT / 2;
    ball.velocity = { x: BALL.speed, y: 0 };
    await engine.advance(1);
    expect(ball.velocity.x).toBe(-BALL.speed);
    expect(rallyState(world).rallies).toBe(1);

    // Still overlapping on the next frame, but lastHit keeps the contact to
    // one count and one reflection.
    await engine.advance(1);
    expect(ball.velocity.x).toBe(-BALL.speed);
    expect(rallyState(world).rallies).toBe(1);

    engine.destroy();
  });

  it("scores a point: the cue, the reset rallies, the serve, the restart", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const world = engine.world;
    const state = rallyState(world);
    const [left, right] = world.players();
    const firstPawns = [left.pawn, right.pawn];

    const cues: string[] = [];
    engine.events.on("cue:played", ({ cue }) => cues.push(cue));

    // Frame 73 leaves the undisturbed serve inside the field...
    await engine.advance(FRAMES_PER_POINT - 1);
    expect(state.players.map((player) => player.score)).toEqual([0, 0]);
    expect(cues).toEqual([]);

    // ...and frame 74 carries it past the right edge, where the mode decides
    // the point from a settled world: the left player scores an ace on a
    // rally of zero, the cue plays, and the ball is served back toward the
    // side that conceded.
    await engine.advance(1);
    expect(state.players[0].score).toBe(1);
    expect(state.players[0].aces).toBe(1);
    expect(state.players[1].score).toBe(0);
    expect(state.rallies).toBe(0);
    expect(cues).toEqual([CUES.point]);

    const ball = world.find(Ball) as Ball;
    expect(ball.transform).toMatchObject({ x: WIDTH / 2, y: HEIGHT / 2 });
    expect(ball.velocity).toEqual({ x: -BALL.speed, y: BALL.drift });

    // restart destroyed each controller's pawn and possessed a fresh paddle
    // at its spawn point.
    expect(left.pawn).not.toBe(firstPawns[0]);
    expect(right.pawn).not.toBe(firstPawns[1]);
    expect(left.pawn?.transform).toMatchObject({
      x: PADDLE.inset,
      y: HEIGHT / 2,
    });
    expect(right.pawn?.transform).toMatchObject({
      x: WIDTH - PADDLE.inset,
      y: HEIGHT / 2,
    });

    engine.destroy();
  });

  it("scores no ace for a point whose rally was answered", async () => {
    const rig = await createRally();
    const { engine } = rig;
    const world = engine.world;
    const ball = world.find(Ball) as Ball;

    // One paddle contact, then the ball is put past the right edge by hand.
    ball.transform.x = 600;
    ball.transform.y = HEIGHT / 2;
    ball.velocity = { x: BALL.speed, y: 0 };
    await engine.advance(1);
    expect(rallyState(world).rallies).toBe(1);

    ball.transform.x = WIDTH + 10;
    await engine.advance(1);

    const state = rallyState(world);
    expect(state.players[0].score).toBe(1);
    expect(state.players[0].aces).toBe(0);
    expect(state.rallies).toBe(0);

    engine.destroy();
  });

  it("ends the match at the score limit and counts it on the instance", async () => {
    const rig = await createRally();
    const { engine, instance } = rig;
    const state = rallyState(engine.world);

    const phases: unknown[] = [];
    const cues: string[] = [];
    engine.events.on("match:phase", (payload) => phases.push(payload));
    engine.events.on("cue:played", ({ cue }) => cues.push(cue));

    // Thirteen undisturbed serves alternate aces until the left player's
    // seventh point meets the limit.
    await engine.advance(FRAMES_TO_OVER);

    expect(state.phase).toBe("over");
    expect(engine.world.mode.phase).toBe("over");
    expect(phases).toEqual([{ phase: "over", previous: "playing" }]);
    expect(state.players[0].score).toBe(SCORE_LIMIT);
    expect(state.players[1].score).toBe(SCORE_LIMIT - 1);
    expect(state.players[0].aces).toBe(SCORE_LIMIT);
    expect(state.players[1].aces).toBe(SCORE_LIMIT - 1);
    expect(cues).toEqual(Array.from({ length: 13 }, () => CUES.point));

    // The instance counted the match from its match:phase subscription.
    expect(instance.matches).toBe(1);

    // elapsed is the match clock: it accumulated only while the phase was
    // playing, so it stops at the over frame while world.time runs on.
    const elapsedAtOver = state.elapsed;
    expect(elapsedAtOver).toBeCloseTo(FRAMES_TO_OVER * DT, 6);
    await engine.advance(60);
    expect(state.elapsed).toBe(elapsedAtOver);
    expect(engine.world.time).toBeCloseTo((FRAMES_TO_OVER + 60) * DT, 6);

    // And the mode's tick stopped scoring: the ball drifting out changes
    // nothing after the phase reached over.
    expect(state.players[0].score).toBe(SCORE_LIMIT);
    expect(state.players[1].score).toBe(SCORE_LIMIT - 1);
    expect(cues).toHaveLength(13);

    engine.destroy();
  });
});
