import { beforeEach, describe, expect, it } from "vitest";
import type {
  ActorSpec,
  ColliderOptions,
  Engine,
  GameDefinition,
  Manifold,
  Shape,
  SurfaceMetrics,
  Vec2,
} from "./contract";
import {
  Actor,
  ColliderComponent,
  ConstantClock,
  createEngine,
  GameMode,
  ShapeComponent,
} from "./index";

/**
 * The documentation's "Collision and Events" example — Breaker — transcribed
 * verbatim from `docs/engines/structured-2d/examples/collision-and-events.md`
 * and run as an integration test.
 *
 * The example's modules appear below in the doc's order, unchanged except for
 * what a test environment forces: the imports collapse onto this package, the
 * page's canvas is created here before `main`'s `querySelector` runs, and the
 * engine takes a scripted clock and is stepped with `advance` instead of
 * `run`'s requestAnimationFrame loop — the pattern the docs' Scripted Clocks
 * and Validating a Game pages establish. The assertions state the outcomes the
 * page narrates: pairs found by this frame's movement are reported in that
 * frame with a manifold and nothing moved, `hit` costs the ball's `into` guard
 * nothing after the first frame, the floor trigger settles on `overlap` and
 * spends lives without stopping the ball, `a` is the lower id, and the hint
 * reads the same collision world by raycast.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — verbatim                                                */
/* -------------------------------------------------------------------------- */

const LEVEL = "breaker";
const FIELD = { width: 640, height: 360, wall: 16 };
const SERVE = { x: 320, y: 240 };
const SPEED = 260;

const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

const BLOCK = { [CHANNEL.ball]: "block" } as const;
const HINT_SHAPE: Shape = { kind: "circle", radius: 3 };

const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "circle", radius: 6 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "rect", width: 56, height: 18 },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

const FLOOR_COLLIDER: ColliderOptions = {
  shape: { kind: "rect", width: FIELD.width, height: FIELD.wall },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};

/* -------------------------------------------------------------------------- */
/* src/actors/ball.ts — verbatim                                              */
/* -------------------------------------------------------------------------- */

class Ball extends Actor {
  readonly velocity: Vec2 = { x: SPEED * 0.6, y: SPEED };

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(new ShapeComponent({ shape, fill: "#7fd1ff" }));
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;
  }

  serve(): void {
    Object.assign(this.transform, SERVE);
    Object.assign(this.velocity, { x: SPEED * 0.6, y: SPEED });
  }

  reflect(normal: Vec2, depth: number): void {
    this.transform.x -= normal.x * depth;
    this.transform.y -= normal.y * depth;
    const into = this.velocity.x * normal.x + this.velocity.y * normal.y;
    if (into <= 0) return;
    this.velocity.x -= 2 * into * normal.x;
    this.velocity.y -= 2 * into * normal.y;
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/brick.ts — verbatim                                             */
/* -------------------------------------------------------------------------- */

class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(new ShapeComponent({ shape, fill: "#ffd479" }));
    this.attach(new ColliderComponent(BRICK_COLLIDER));
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/floor.ts — verbatim                                             */
/* -------------------------------------------------------------------------- */

class Floor extends Actor {
  constructor() {
    super();
    this.attach(new ColliderComponent(FLOOR_COLLIDER));
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/breaker-mode.ts — verbatim                                      */
/* -------------------------------------------------------------------------- */

const QUERY = { channel: CHANNEL.ball, responses: BALL_COLLIDER.responses };

class BreakerMode extends GameMode {
  lives = 3;
  private ball: Ball | null = null;
  private hint: Actor | null = null;

  override beginPlay(): void {
    const events = this.world.events;
    this.ball = this.world.find(Ball);
    this.hint = this.world.spawn(Actor, {
      configure: (dot) =>
        dot.attach(new ShapeComponent({ shape: HINT_SHAPE, fill: "#ffffff" })),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : { x: -n.x, y: -n.y }, manifold.depth);
      const other = a === ball ? b : a;
      if (other instanceof Brick) other.destroy();
    });
    events.on("overlap:begin", ({ a, b }) => {
      if (!(a instanceof Floor) && !(b instanceof Floor)) return;
      this.lives -= 1;
      if (this.lives > 0) this.ball?.serve();
      else this.setPhase("over");
    });

    this.setPhase("playing");
  }

  override tick(): void {
    const { ball, hint } = this;
    if (ball === null || hint === null) return;
    const v = ball.velocity;
    const speed = Math.hypot(v.x, v.y) || 1;
    const aim = this.world.collision.raycast(
      ball.transform,
      { x: v.x / speed, y: v.y / speed },
      400,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.x = aim.point.x;
    hint.transform.y = aim.point.y;
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — verbatim                                                     */
/* -------------------------------------------------------------------------- */

const { width, height, wall } = FIELD;

function bar(w: number, h: number, x: number, y: number, channel: string) {
  const shape = { kind: "rect", width: w, height: h } as const;
  return {
    type: Actor,
    transform: { x, y },
    configure(actor: Actor) {
      actor.attach(new ShapeComponent({ shape, fill: "#39465c" }));
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const actors: ActorSpec[] = [
  bar(width, wall, width / 2, -wall / 2, CHANNEL.wall),
  bar(wall, height, -wall / 2, height / 2, CHANNEL.wall),
  bar(wall, height, width + wall / 2, height / 2, CHANNEL.wall),
  bar(72, 10, width / 2, 330, CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: { x: 64 + (i % 9) * 64, y: 56 + Math.floor(i / 9) * 26 },
  })),
  { type: Floor, transform: { x: width / 2, y: height + wall / 2 } },
  { type: Ball, transform: SERVE },
];

const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* The test environment's seams                                               */
/* -------------------------------------------------------------------------- */

/**
 * jsdom parses `<canvas>` but implements no 2D context, so the element the
 * page would carry is given one reduced to what the pipeline calls. The engine
 * reads its measurements through `SurfaceMetrics` regardless.
 */
function stubContext(canvas: HTMLCanvasElement): void {
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
    "clip",
    "setLineDash",
  ]) {
    ctx[name] = (): void => undefined;
  }
  Object.defineProperty(canvas, "getContext", {
    value: (kind: string): unknown => (kind === "2d" ? ctx : null),
    configurable: true,
  });
}

/** Fixed measurements and one event target — jsdom performs no layout. */
function metrics(): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: (): number => FIELD.width,
    cssHeight: (): number => FIELD.height,
    dpr: (): number => 1,
    events: (): EventTarget => target,
  };
}

/**
 * `src/main.ts`, verbatim up to the seams: the page's markup is written first
 * so the example's `querySelector` finds its canvas, the clock is scripted so
 * a frame is worth exactly 1000/60 ms, and the caller advances frames instead
 * of `engine.run()` looping on requestAnimationFrame.
 */
function boot(): Engine {
  document.body.innerHTML = '<canvas id="game"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");
  stubContext(canvas);

  return createEngine({
    canvas,
    width: FIELD.width,
    height: FIELD.height,
    background: "#0b0f16",
    game: breaker,
    clock: new ConstantClock(1000 / 60),
    surface: metrics(),
  });
}

/** One frame's worth of simulated seconds under the scripted clock. */
const DT = 1 / 60;

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("the documentation's Breaker example", () => {
  let engine: Engine;

  beforeEach(() => {
    engine = boot();
  });

  it("opens breaker fully posed: walls, paddle, bricks, floor, ball, hint", async () => {
    await engine.initialize();
    const world = engine.world;

    expect(world.level).toBe(LEVEL);
    // `beginPlay` set the phase before initialize resolved.
    expect(world.state.phase).toBe("playing");
    expect((world.mode as BreakerMode).lives).toBe(3);

    // 3 wall bars + the paddle bar + 27 bricks + the floor + the ball are the
    // declared actors; the mode spawned the hint dot in its beginPlay.
    expect(world.actors()).toHaveLength(34);
    expect(world.ofType(Brick)).toHaveLength(27);
    expect(world.ofType(Floor)).toHaveLength(1);

    const ball = world.find(Ball);
    expect(ball?.transform.x).toBe(SERVE.x);
    expect(ball?.transform.y).toBe(SERVE.y);
    expect(ball?.velocity).toEqual({ x: SPEED * 0.6, y: SPEED });

    // Ids are assigned in spawn order, which is what makes the page's "a is
    // the actor of the pair with the lower id" a statement about declaration
    // order: every declared actor precedes the ball except the mode's hint.
    const ids = world.actors().map((actor) => actor.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    engine.destroy();
  });

  it("aims the hint along the ball's heading through the same collision world", async () => {
    await engine.initialize();
    await engine.advance(1);

    // The ball serves at (320, 240) heading (0.6, 1) · 260, and it travels
    // along its own ray, so the aim point is invariant while the heading
    // holds: the ray leaves the serve down-right and meets the floor's top
    // edge (y = 360) at x = 320 + 120 · 0.6 = 392. The floor answers the ball
    // with `overlap`, which is stronger than the query's unlisted `ignore`,
    // so the trigger is in the raycast's world like any other collider.
    const hint = engine.world.actors().at(-1);
    expect(hint?.transform.x).toBeCloseTo(392, 6);
    expect(hint?.transform.y).toBeCloseTo(360, 6);
    engine.destroy();
  });

  it("reports a pair produced by this frame's movement in that frame, moving nothing", async () => {
    // This subscriber outruns the mode's (initialize has not run yet), so it
    // reads the ball where the collision pass found it — before the game's
    // reflect response moves it.
    const seen: { aIsBrick: boolean; ballY: number; manifold: Manifold }[] = [];
    engine.events.on("hit", ({ a, b, manifold }) => {
      if (!(b instanceof Ball)) return;
      seen.push({
        aIsBrick: a instanceof Brick,
        ballY: b.transform.y,
        manifold,
      });
    });
    const destroyed: Actor[] = [];
    engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor));

    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    // Posed one frame's travel short of the first brick (spanning y 47..65 at
    // x 64), falling straight down: this frame's movement makes the pair.
    Object.assign(ball.transform, { x: 64, y: 40 });
    Object.assign(ball.velocity, { x: 0, y: SPEED });
    await engine.advance(1);

    // The pass ran after the tick and reported the pair the tick produced, in
    // the same frame, with the ball still at its ticked position: the engine
    // moved nothing.
    expect(seen).toHaveLength(1);
    expect(seen[0].aIsBrick).toBe(true);
    expect(seen[0].ballY).toBeCloseTo(40 + SPEED * DT, 6);
    // The manifold points from `a` (the brick) toward the ball above it, and
    // its depth is the overlap this frame's movement drove in.
    expect(seen[0].manifold.normal.x).toBeCloseTo(0, 6);
    expect(seen[0].manifold.normal.y).toBeCloseTo(-1, 6);
    expect(seen[0].manifold.depth).toBeCloseTo(40 + SPEED * DT + 6 - 47, 5);

    // Every consequence was the game's: the reflect backed the ball out along
    // the flipped normal by the depth and mirrored its velocity, and the mode
    // destroyed the brick it struck.
    expect(ball.transform.y).toBeCloseTo(41, 5);
    expect(ball.velocity.y).toBe(-SPEED);
    expect(engine.world.ofType(Brick)).toHaveLength(26);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toBeInstanceOf(Brick);
    expect(destroyed[0].transform).toMatchObject({ x: 64, y: 56 });
    engine.destroy();
  });

  it("reflects off the paddle: lower id first, one blocking hit, speed kept", async () => {
    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    const hits: { lowerFirst: boolean; normal: Vec2 }[] = [];
    engine.events.on("hit", ({ a, b, manifold }) =>
      hits.push({ lowerFirst: a.id < b.id, normal: manifold.normal }),
    );

    // Dropped straight onto the paddle's center (top edge y = 325): three
    // frames of 260/60 land the ball at y = 323, four units deep.
    Object.assign(ball.transform, { x: 320, y: 310 });
    Object.assign(ball.velocity, { x: 0, y: SPEED });
    await engine.advance(3);

    // The paddle was declared before the ball, so it is `a` and the normal
    // points from it up toward the ball; the mode flipped it for the ball.
    expect(hits).toHaveLength(1);
    expect(hits[0].lowerFirst).toBe(true);
    expect(hits[0].normal.x).toBeCloseTo(0, 6);
    expect(hits[0].normal.y).toBeCloseTo(-1, 6);

    // Backed out to rest on the surface, velocity mirrored, speed unchanged.
    expect(ball.transform.y).toBeCloseTo(319, 5);
    expect(ball.velocity.y).toBe(-SPEED);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(SPEED, 6);

    // The blocking pair separated, so the following frames find nothing.
    await engine.advance(3);
    expect(hits).toHaveLength(1);
    engine.destroy();
  });

  it("spends the reflection once: the into guard makes repeats cost nothing", async () => {
    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    // First report: the ball moves into the surface, so the velocity mirrors.
    ball.reflect({ x: 0, y: 1 }, 5);
    expect(ball.velocity).toEqual({ x: SPEED * 0.6, y: -SPEED });
    expect(ball.transform.y).toBe(SERVE.y - 5);

    // A later frame reporting the same pair still backs the ball out, but the
    // ball now moves away from the surface — `into <= 0` — so the frame costs
    // the velocity nothing.
    ball.reflect({ x: 0, y: 1 }, 2);
    expect(ball.velocity).toEqual({ x: SPEED * 0.6, y: -SPEED });
    expect(ball.transform.y).toBe(SERVE.y - 7);
    engine.destroy();
  });

  it("runs the floor as a trigger: lives spent, ball never stopped, match over", async () => {
    const begins: { aIsFloor: boolean }[] = [];
    const ends: { aIsFloor: boolean }[] = [];
    const phases: string[] = [];
    engine.events.on("overlap:begin", ({ a, b }) => {
      if (a instanceof Floor || b instanceof Floor)
        begins.push({ aIsFloor: a instanceof Floor });
    });
    engine.events.on("overlap:end", ({ a, b }) => {
      if (a instanceof Floor || b instanceof Floor)
        ends.push({ aIsFloor: a instanceof Floor });
    });
    engine.events.on("match:phase", ({ phase }) => phases.push(phase));
    const blocked: unknown[] = [];
    engine.events.on("hit", (event) => blocked.push(event));

    await engine.initialize();
    const mode = engine.world.mode as BreakerMode;
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    // From the serve the ball falls down-right, misses the paddle, and first
    // intersects the floor (top edge y = 360, radius 6) on frame 27, when
    // y = 240 + 260 · 27/60 = 357 > 354. The pair settles on `overlap` — the
    // ball leaves `floor` unlisted, the floor answers `overlap`, and the pair
    // takes the stronger — so it begins once, costs a life, and serves.
    await engine.advance(27);
    expect(begins).toHaveLength(1);
    expect(begins[0].aIsFloor).toBe(true); // declared before the ball
    expect(mode.lives).toBe(2);
    expect(ball.transform.x).toBe(SERVE.x);
    expect(ball.transform.y).toBe(SERVE.y);

    // The serve moved the ball off the floor, so the next frame's pass stops
    // finding the pair and emits the end.
    await engine.advance(1);
    expect(ends).toHaveLength(1);

    // The fall replays identically from each serve: 27 frames per life, so
    // the third crossing lands on frame 81 and ends the match. This time no
    // serve rescues the ball, and it keeps falling through the trigger — at
    // frame 85 it sits inside the floor's slab, unstopped and still moving.
    await engine.advance(57);
    expect(begins).toHaveLength(3);
    expect(ends).toHaveLength(2);
    expect(mode.lives).toBe(0);
    expect(engine.world.state.phase).toBe("over");
    expect(phases).toEqual(["playing", "over"]);
    expect(ball.transform.y).toBeCloseTo(240 + SPEED * 31 * DT, 5);
    expect(ball.transform.y).toBeGreaterThan(360);
    expect(ball.velocity.y).toBe(SPEED);

    // Nothing blocked anywhere in the run — the floor reports the crossing
    // without stopping the ball, and the descent touches nothing else.
    expect(blocked).toHaveLength(0);

    // The pair is still overlapping when the world closes, and closing emits
    // the end the pass will never reach.
    engine.destroy();
    expect(ends).toHaveLength(3);
    expect(ends[2].aIsFloor).toBe(true);
  });
});
