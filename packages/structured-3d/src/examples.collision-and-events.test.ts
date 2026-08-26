import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Actor } from "./actors";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { ColliderComponent, type ColliderOptions } from "./collision";
import { RenderComponent, ShapeComponent, type Shape3 } from "./components";
import { createEngine, type Engine } from "./engine";
import type { GameDefinition } from "./game-instance";
import { GameMode } from "./game-mode";
import { vec3Dot, vec3Length, vec3Scale, vec3Sub, type Vec3 } from "./math";
import type { ActorSpec, World } from "./worlds";

/**
 * The documentation's worked example "Collision and Events", transcribed and
 * run. The page's modules below — the constants, `src/game.ts` with its `slab`
 * helper, `Ball`, `Brick`, `Floor`, and `BreakerMode` — are copied from the
 * page unchanged. Only what a test environment forces is adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and the engine takes
 *   its measurements from an injected `SurfaceMetrics`. The element is smaller
 *   than the design field, which a software rasterizer forces and which none
 *   of the page's world arithmetic depends on: `DESIGN` is "the logical field
 *   the camera projects into, not the arena".
 * - `engine.run()` becomes `engine.advance` under a `ConstantClock`, so a
 *   duration is a frame count.
 * - Where a check needs a pair the free-falling ball does not reach on its
 *   own, it poses one by writing the ball's transform and velocity, which are
 *   the ball's own public fields.
 * - The checks that advance tens of frames of collision carry an explicit
 *   vitest timeout, as the sibling suites' heavy checks do and for the same
 *   reason only: a software rasterizer charges for every device pixel and the
 *   whole workspace's suites run at once. A timeout bounds how long a check
 *   may take; it changes nothing a check asserts.
 *
 * The assertions are the outcomes the page narrates: the channel matrix and
 * its stronger-answer rule, the whole-vector rule a partial spec transform
 * follows, the trigger that reports without stopping, the manifold's
 * orientation against the lower id, the push-out and the `into` guard, the
 * raycast the hint reads, and the pass running after every actor ticked and
 * before the mode ticked.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — transcribed verbatim                                    */
/* -------------------------------------------------------------------------- */

const LEVEL = "breaker";
const DESIGN = { width: 640, height: 360 };
const FIELD = { halfX: 8, halfZ: 5, top: 10, wall: 1 };
const SERVE: Vec3 = { x: 0, y: 5, z: 0 };
const SPEED = 8;

const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

const BLOCK = { [CHANNEL.ball]: "block" } as const;
const HINT_SHAPE: Shape3 = { kind: "sphere", radius: 0.15 };

const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "sphere", radius: 0.4 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "box", size: { x: 1.4, y: 0.7, z: 2 } },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

const FLOOR_COLLIDER: ColliderOptions = {
  shape: { kind: "box", size: { x: 16, y: 1, z: 10 } },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};

/* -------------------------------------------------------------------------- */
/* src/actors/ball.ts — transcribed verbatim                                  */
/* -------------------------------------------------------------------------- */

class Ball extends Actor {
  velocity: Vec3 = { x: SPEED * 0.6, y: -SPEED, z: SPEED * 0.3 };

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(new ShapeComponent({ shape, color: "#7fd1ff" }));
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    const position = this.transform.position;
    position.x += this.velocity.x * dt;
    position.y += this.velocity.y * dt;
    position.z += this.velocity.z * dt;
  }

  serve(): void {
    this.transform.position = { ...SERVE };
    this.velocity = { x: SPEED * 0.6, y: -SPEED, z: SPEED * 0.3 };
  }

  reflect(normal: Vec3, depth: number): void {
    this.transform.position = vec3Sub(
      this.transform.position,
      vec3Scale(normal, depth),
    );
    const into = vec3Dot(this.velocity, normal);
    if (into <= 0) return;
    this.velocity = vec3Sub(this.velocity, vec3Scale(normal, 2 * into));
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/brick.ts — transcribed verbatim                                 */
/* -------------------------------------------------------------------------- */

class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(new ShapeComponent({ shape, color: "#ffd479" }));
    this.attach(new ColliderComponent(BRICK_COLLIDER));
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/floor.ts — transcribed verbatim                                 */
/* -------------------------------------------------------------------------- */

class Floor extends Actor {
  constructor() {
    super();
    this.attach(new ColliderComponent(FLOOR_COLLIDER));
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/breaker-mode.ts — transcribed verbatim                          */
/* -------------------------------------------------------------------------- */

const QUERY = { channel: CHANNEL.ball, responses: BALL_COLLIDER.responses };

class BreakerMode extends GameMode {
  lives = 3;
  private ball: Ball | null = null;
  private hint: Actor | null = null;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 7, z: 16 };
    this.world.camera.lookAt({ x: 0, y: 5, z: 0 });

    const events = this.world.events;
    this.ball = this.world.find(Ball);
    this.hint = this.world.spawn(Actor, {
      configure: (dot) =>
        dot.attach(new ShapeComponent({ shape: HINT_SHAPE, color: "#ffffff" })),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : vec3Scale(n, -1), manifold.depth);
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
    const speed = vec3Length(ball.velocity) || 1;
    const aim = this.world.collision.raycast(
      ball.transform.position,
      vec3Scale(ball.velocity, 1 / speed),
      40,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.position = { ...aim.point };
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const { halfX, halfZ, top, wall } = FIELD;

function slab(size: Vec3, position: Vec3, channel: string) {
  const shape = { kind: "box", size } as const;
  return {
    type: Actor,
    transform: { position },
    configure(actor: Actor) {
      actor.attach(new ShapeComponent({ shape, color: "#39465c" }));
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const actors: ActorSpec[] = [
  slab(
    { x: 2 * halfX, y: wall, z: 2 * halfZ },
    { x: 0, y: top + wall / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: wall, y: top, z: 2 * halfZ },
    { x: -halfX - wall / 2, y: top / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: wall, y: top, z: 2 * halfZ },
    { x: halfX + wall / 2, y: top / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: 2 * halfX, y: top, z: wall },
    { x: 0, y: top / 2, z: -halfZ - wall / 2 },
    CHANNEL.wall,
  ),
  slab(
    { x: 2 * halfX, y: top, z: wall },
    { x: 0, y: top / 2, z: halfZ + wall / 2 },
    CHANNEL.wall,
  ),
  slab({ x: 3, y: 0.5, z: 2 }, { x: 0, y: 1, z: 0 }, CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: {
      position: {
        x: -6.4 + (i % 9) * 1.6,
        y: 8,
        z: -2.4 + Math.floor(i / 9) * 2.4,
      },
    },
  })),
  { type: Floor, transform: { position: { x: 0, y: -0.5, z: 0 } } },
  { type: Ball, transform: { position: SERVE } },
];

const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

interface Breaker {
  readonly engine: Engine;
  world(): World;
  mode(): BreakerMode;
  ball(): Ball;
  hint(): Actor;
  dispose(): void;
}

async function boot(): Promise<Breaker> {
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
  const engine = createEngine({
    canvas,
    width: DESIGN.width,
    height: DESIGN.height,
    background: "#0b0f16",
    game: breaker,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  await engine.initialize();

  return {
    engine,
    world: () => engine.world,
    mode: () => engine.world.mode as BreakerMode,
    ball: () => {
      const found = engine.world.find(Ball);
      if (found === null) throw new Error("the level holds no ball");
      return found;
    },
    hint: () => {
      const found = engine.world.actors().at(-1);
      if (found === undefined) throw new Error("the level holds no hint");
      return found;
    },
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("examples/collision-and-events", () => {
  let breakerGame: Breaker;

  beforeEach(async () => {
    breakerGame = await boot();
  });

  afterEach(() => {
    breakerGame.dispose();
  });

  it("builds the box from five slabs, a paddle, the bricks, the floor, and the ball", () => {
    // "The five wall slabs close every face of the box except the bottom,
    // which the paddle guards."
    const world = breakerGame.world();
    expect(world.ofType(Brick)).toHaveLength(27);
    expect(world.ofType(Floor)).toHaveLength(1);
    expect(world.ofType(Ball)).toHaveLength(1);
    // Five walls, one paddle, 27 bricks, the floor, the ball, and the hint the
    // mode spawns in `beginPlay`.
    expect(world.actors()).toHaveLength(5 + 1 + 27 + 1 + 1 + 1);
    expect(world.mode.phase).toBe("playing");
  });

  it("replaces the whole vector a spec's transform names, leaving the rest at the identity", () => {
    // "An `ActorSpec.transform` is a partial transform, and a supplied
    // `position` replaces the whole vector, so each spec states all three
    // numbers."
    const ball = breakerGame.ball();
    expect(ball.transform.position).toEqual(SERVE);
    expect(ball.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(ball.transform.scale).toEqual({ x: 1, y: 1, z: 1 });

    const [firstSlab] = breakerGame.world().actors();
    expect(firstSlab?.transform.position).toEqual({
      x: 0,
      y: top + wall / 2,
      z: 0,
    });
    expect(firstSlab?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("carries a collider and no render component on the floor", () => {
    // "The floor is a trigger: it carries a collider and no render
    // component."
    const [floor] = breakerGame.world().ofType(Floor);
    expect(floor?.components).toHaveLength(1);
    expect(floor?.components[0]).toBeInstanceOf(ColliderComponent);
    expect(
      floor?.components.filter(
        (component) => component instanceof RenderComponent,
      ),
    ).toEqual([]);
  });

  it("frames the arena before the first frame draws", () => {
    // "`beginPlay` also frames the arena: the camera is part of the world, so
    // the mode places it and aims it with `lookAt` before the first frame
    // draws."
    const { camera } = breakerGame.world();
    expect(camera.position).toEqual({ x: 0, y: 7, z: 16 });
    const aim = camera.project({ x: 0, y: 5, z: 0 });
    expect(aim?.x).toBeCloseTo(DESIGN.width / 2, 6);
    expect(aim?.y).toBeCloseTo(DESIGN.height / 2, 6);
  });

  it("settles the ball–floor pair on overlap, the stronger of the two answers", async () => {
    // "The ball answers the `floor` channel with `ignore`, so the pair settles
    // on `overlap`. The pair emits `overlap:begin` on the first frame it is
    // found and `overlap:end` on the first frame it is not."
    const { engine } = breakerGame;
    const world = breakerGame.world();
    const [floor] = world.ofType(Floor);
    const log: string[] = [];
    const served: Vec3[] = [];
    engine.events.on("overlap:begin", ({ a, b }) => {
      if (a !== floor && b !== floor) return;
      log.push("begin");
      // Subscribed after the mode was, so this handler runs after the mode's:
      // the life is already spent and the ball already back on the serve line.
      served.push({ ...breakerGame.ball().transform.position });
    });
    engine.events.on("overlap:end", ({ a, b }) => {
      if (a === floor || b === floor) log.push("end");
    });
    engine.events.on("hit", ({ a, b }) => {
      if (a === floor || b === floor) log.push("hit");
    });

    // The serve falls past the paddle and reaches the floor; the mode spends a
    // life and serves again, which is what ends the overlap. A pair that
    // settled on `overlap` reports the edges alone and never `hit`.
    await engine.advance(40);

    expect(log).toEqual(["begin", "end"]);
    expect(breakerGame.mode().lives).toBe(2);
    expect(served).toEqual([SERVE]);
  }, 30_000);

  it("spends every life on the floor and then ends the match", async () => {
    const { engine } = breakerGame;
    await engine.advance(120);

    expect(breakerGame.mode().lives).toBe(0);
    expect(breakerGame.world().mode.phase).toBe("over");
    expect(breakerGame.world().state.phase).toBe("over");
  }, 30_000);

  it("reports the pair with its colliders and manifold, and moves nothing", async () => {
    // "It reported the two actors, their colliders, and the manifold, and
    // moved nothing. Every consequence is the game's."
    const { engine } = breakerGame;
    const world = breakerGame.world();
    const ball = breakerGame.ball();
    const [brick] = world.ofType(Brick);
    if (brick === undefined) throw new Error("the level holds no brick");

    const seen: {
      lower: boolean;
      colliders: number;
      normal: Vec3;
      depth: number;
      brickAt: Vec3;
    }[] = [];
    engine.events.on("hit", ({ a, b, colliders, manifold }) => {
      if (a !== brick && b !== brick) return;
      seen.push({
        // "`a` is the actor of the pair with the lower `id`" — the bricks are
        // declared before the ball, so the brick is always `a`.
        lower: a === brick && b === ball,
        colliders: colliders.filter(
          (collider) => collider instanceof ColliderComponent,
        ).length,
        normal: { ...manifold.normal },
        depth: manifold.depth,
        brickAt: { ...brick.transform.position },
      });
    });

    ball.transform.position = { x: -6.4, y: 7, z: -2.4 };
    ball.velocity = { x: 0, y: SPEED, z: 0 };
    await engine.advance(3);

    expect(seen).toHaveLength(1);
    expect(seen[0].lower).toBe(true);
    expect(seen[0].colliders).toBe(2);
    // The normal runs from the pair's first collider toward its second, so it
    // points from the brick down at the ball beneath it.
    expect(seen[0].normal.y).toBeCloseTo(-1, 9);
    expect(seen[0].depth).toBeGreaterThan(0);
    // Detection moved nothing: the brick stood where it was declared.
    expect(seen[0].brickAt).toEqual({ x: -6.4, y: 8, z: -2.4 });
  });

  it("reflects off a brick and destroys it, from the flipped normal", async () => {
    // "the mode compares both sides against the ball it cached and flips the
    // normal when the ball is second", and "`reflect` is the whole physical
    // response".
    const { engine } = breakerGame;
    const world = breakerGame.world();
    const ball = breakerGame.ball();
    const [brick] = world.ofType(Brick);

    ball.transform.position = { x: -6.4, y: 7, z: -2.4 };
    ball.velocity = { x: 0, y: SPEED, z: 0 };
    await engine.advance(3);

    expect(ball.velocity.y).toBeCloseTo(-SPEED, 9);
    expect(ball.velocity.x).toBe(0);
    expect(brick?.alive).toBe(false);
    await engine.advance(1);
    expect(world.ofType(Brick)).toHaveLength(26);
  });

  it("backs the ball out along the normal and spends nothing on the frames after", async () => {
    // "back the ball out along the normal by the manifold's depth, then mirror
    // the velocity while it still moves into the surface ... the `into` guard
    // is what makes the frames after the first cost nothing."
    const { engine } = breakerGame;
    const ball = breakerGame.ball();

    ball.transform.position = { x: 7.8, y: 5, z: 0 };
    ball.velocity = { x: -SPEED, y: 0, z: 0 };
    await engine.advance(1);

    // The +x wall's inner face is at `halfX`; the push-out puts the ball's own
    // surface exactly on it, and the velocity, already leaving, is untouched.
    expect(ball.transform.position.x).toBeCloseTo(halfX - 0.4, 9);
    expect(ball.velocity).toEqual({ x: -SPEED, y: 0, z: 0 });
  });

  it("moves the hint to the first thing the ball is heading into", async () => {
    // "The hint reads the same collision world, along the ball's heading."
    const { engine } = breakerGame;
    const ball = breakerGame.ball();
    const hint = breakerGame.hint();

    ball.transform.position = { x: 0, y: 5, z: 0 };
    ball.velocity = { x: 0, y: -SPEED, z: 0 };
    await engine.advance(1);

    // Straight down from the serve line, the paddle slab's top face is the
    // first surface the ray meets.
    expect(hint.transform.position.x).toBeCloseTo(0, 9);
    expect(hint.transform.position.y).toBeCloseTo(1.25, 9);
    expect(hint.transform.position.z).toBeCloseTo(0, 9);

    // The query the mode poses is the ball's own matrix, with the ball itself
    // ignored, so the ray starts inside nothing.
    const speed = vec3Length(ball.velocity) || 1;
    const direct = breakerGame
      .world()
      .collision.raycast(
        ball.transform.position,
        vec3Scale(ball.velocity, 1 / speed),
        40,
        { ...QUERY, ignore: [ball] },
      );
    expect(direct?.point.y).toBeCloseTo(1.25, 9);
    expect(direct?.normal.y).toBeCloseTo(1, 9);
  });

  it("runs the pass after every actor ticked and before the mode ticked", async () => {
    // "The engine ran its collision pass after every actor ticked and before
    // the mode ticked, so a pair produced by this frame's movement is reported
    // in that frame."
    const { engine } = breakerGame;
    const ball = breakerGame.ball();
    const [floor] = breakerGame.world().ofType(Floor);

    const reportedOnFrame: number[] = [];
    engine.events.on("overlap:begin", ({ a, b }) => {
      if (a !== floor && b !== floor) return;
      reportedOnFrame.push(engine.frame().count);
    });

    // The ball starts clear of everything: at `y = 0.45` its own surface is
    // still above the floor's top face at `y = 0`, and `x = 5` puts it beside
    // the paddle rather than over it. One frame's movement is what takes it
    // in, and that same frame reports the pair and spends the life, so the
    // pass ran after the actor's tick rather than before it.
    ball.transform.position = { x: 5, y: 0.45, z: 0 };
    ball.velocity = { x: 0, y: -SPEED, z: 0 };
    expect(breakerGame.world().collision.overlaps(ball)).toEqual([]);

    await engine.advance(1);

    expect(reportedOnFrame).toEqual([1]);
    expect(breakerGame.mode().lives).toBe(2);
    expect(ball.transform.position).toEqual(SERVE);
  });

  it("answers an unlisted channel with ignore, so two bricks report nothing", async () => {
    // "An unlisted channel is answered with `ignore`" — a brick's matrix names
    // the ball alone, so brick against brick settles on `ignore`.
    const { engine } = breakerGame;
    const world = breakerGame.world();
    const bricks = world.ofType(Brick);
    const [first, second] = bricks;
    if (first === undefined || second === undefined) {
      throw new Error("the level holds too few bricks");
    }

    const between: string[] = [];
    const between2 = (a: Actor, b: Actor): boolean =>
      (a === first && b === second) || (a === second && b === first);
    engine.events.on("overlap:begin", ({ a, b }) => {
      if (between2(a, b)) between.push("overlap");
    });
    engine.events.on("hit", ({ a, b }) => {
      if (between2(a, b)) between.push("hit");
    });

    // Park the ball out of the way and drive one brick into the other.
    breakerGame.ball().velocity = { x: 0, y: 0, z: 0 };
    breakerGame.ball().transform.position = { x: 0, y: -20, z: 0 };
    second.transform.position = { ...first.transform.position };
    await engine.advance(2);

    expect(between).toEqual([]);
  });
});
