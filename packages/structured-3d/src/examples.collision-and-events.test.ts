import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ColliderOptions, Manifold, MeshGeometry, Vec3 } from "./contract";
import type { Engine } from "./engine";
import type { GameDefinition } from "./game-instance";
import type { ActorSpec } from "./worlds";
import {
  Actor,
  ColliderComponent,
  ConstantClock,
  FORWARD,
  GameMode,
  LightComponent,
  MeshComponent,
  add,
  createEngine,
  dot,
  length,
  normalize,
  quatFromAxisAngle,
  quatLookAt,
  quatRotate,
  scale,
  sub,
  vec3,
} from "./index";
import { createSurface, installCanvasContexts } from "./testing/canvas";
import type { InstalledContexts } from "./testing/canvas";

/**
 * The documentation's "Collision and Events" example — Breaker — transcribed
 * from `docs/engines/structured-3d/examples/collision-and-events.md` and run
 * as an integration test.
 *
 * The example's modules appear below in the doc's order, unchanged except for
 * what a test environment forces: the imports collapse onto this package, the
 * page's canvas is written into the document before `main`'s `querySelector`
 * runs, every canvas in that document answers `getContext` through the harness
 * stubs, and the engine takes a scripted clock and a fixed surface and is
 * stepped with `advance` instead of `run`'s frame callback — the pattern the
 * docs' Scripted Clocks and Validating a Game pages establish. Nothing else is
 * touched: the field, the channels, the response maps, the twenty-seven
 * bricks, and every line of `Ball.reflect` and `BreakerMode` are the page's.
 *
 * The assertions state the outcomes the page narrates. A pair produced by this
 * frame's movement is reported in that frame, with a manifold, and the engine
 * moved nothing — every consequence is the game's. `hit` fires on every frame a
 * blocking pair is found and the `into` guard makes the frames after the first
 * cost the velocity nothing. The floor settles on `overlap` because the pair
 * takes the stronger of the two answers, so it reports the crossing without
 * stopping the ball, and closing the world emits the end the pass never
 * reaches. `a` is the actor with the lower id, so the mode's flip is what keeps
 * the reflection correct on both sides. The hint reads the same collision world
 * by raycast, along the ball's own heading.
 *
 * The vocabulary the page opens on is checked as a matrix rather than a
 * sentence: two pairs driven straight through each other that both sides leave
 * unlisted are never tested, while the pair the ball and a wall bar both answer
 * with `block` is. One shape record reaches the collider and the mesh that
 * shows it, so "what the engine tests is what the player sees" is an identity
 * and not a coincidence, and the lights actor's rotation alone is the direction
 * `quatLookAt` turned `FORWARD` onto.
 *
 * The page closes on the claim that separates this engine from its
 * two-dimensional sibling: the manifold is three-dimensional, the in-plane
 * field keeps the ball's `z` at zero without the game doing anything to hold it
 * there, and "a brick tilted out of the plane would report a normal with a `z`
 * component, and the same `reflect` would send the ball out of the plane along
 * it." The last suite tilts a brick and checks exactly that.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — verbatim                                                */
/* -------------------------------------------------------------------------- */

const LEVEL = "breaker";
const FIELD = { width: 16, height: 9, depth: 1, wall: 0.5 };
const SERVE: Vec3 = vec3(0, -1.5, 0);
const SPEED = 6;

const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

const BLOCK = { [CHANNEL.ball]: "block" } as const;
const HINT_GEOMETRY: MeshGeometry = { kind: "sphere", radius: 0.08 };

const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "sphere", radius: 0.2 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "box", width: 1.5, height: 0.5, depth: FIELD.depth },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

const FLOOR_COLLIDER: ColliderOptions = {
  shape: {
    kind: "box",
    width: FIELD.width,
    height: FIELD.wall,
    depth: FIELD.depth,
  },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};

/* -------------------------------------------------------------------------- */
/* src/actors/ball.ts — verbatim                                              */
/* -------------------------------------------------------------------------- */

class Ball extends Actor {
  velocity: Vec3 = vec3(SPEED * 0.6, SPEED, 0);

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(
      new MeshComponent({
        geometry: shape,
        material: { color: "#7fd1ff", roughness: 0.4 },
      }),
    );
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    this.transform.position = add(
      this.transform.position,
      scale(this.velocity, dt),
    );
  }

  serve(): void {
    this.transform.position = vec3(SERVE.x, SERVE.y, SERVE.z);
    this.velocity = vec3(SPEED * 0.6, SPEED, 0);
  }

  reflect(normal: Vec3, depth: number): void {
    this.transform.position = sub(
      this.transform.position,
      scale(normal, depth),
    );
    const into = dot(this.velocity, normal);
    if (into <= 0) return;
    this.velocity = sub(this.velocity, scale(normal, 2 * into));
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/brick.ts — verbatim                                             */
/* -------------------------------------------------------------------------- */

class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(
      new MeshComponent({ geometry: shape, material: { color: "#ffd479" } }),
    );
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
      configure: (marker) =>
        marker.attach(
          new MeshComponent({
            geometry: HINT_GEOMETRY,
            material: { kind: "basic", color: "#ffffff" },
          }),
        ),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : scale(n, -1), manifold.depth);
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
    if (length(ball.velocity) === 0) return;
    const aim = this.world.collision.raycast(
      ball.transform.position,
      normalize(ball.velocity),
      40,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.position = aim.point;
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — verbatim                                                     */
/* -------------------------------------------------------------------------- */

const { width, height, depth, wall } = FIELD;

function bar(w: number, h: number, position: Vec3, channel: string): ActorSpec {
  const shape = { kind: "box", width: w, height: h, depth } as const;
  return {
    type: Actor,
    transform: { position },
    configure(actor: Actor) {
      actor.attach(
        new MeshComponent({ geometry: shape, material: { color: "#39465c" } }),
      );
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const lights: ActorSpec = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.4, -1, -0.6)) },
  configure(actor: Actor) {
    actor.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    actor.attach(
      new LightComponent({ light: { kind: "directional", intensity: 2 } }),
    );
  },
};

const actors: ActorSpec[] = [
  lights,
  bar(width + 2 * wall, wall, vec3(0, height / 2 + wall / 2, 0), CHANNEL.wall),
  bar(wall, height, vec3(-(width / 2 + wall / 2), 0, 0), CHANNEL.wall),
  bar(wall, height, vec3(width / 2 + wall / 2, 0, 0), CHANNEL.wall),
  bar(2, 0.3, vec3(0, -3.6, 0), CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: {
      position: vec3(-6.4 + (i % 9) * 1.6, 3.4 - Math.floor(i / 9) * 0.7, 0),
    },
  })),
  {
    type: Floor,
    transform: { position: vec3(0, -(height / 2 + wall / 2), 0) },
  },
  { type: Ball, transform: { position: SERVE } },
];

const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* The test environment's seams                                               */
/* -------------------------------------------------------------------------- */

/**
 * `src/main.ts`, verbatim up to the seams: the page's markup is written first
 * so the example's `querySelector` finds its canvas, every canvas in the
 * document — the page's, and the screen layer and capture canvas the engine
 * makes for itself — answers `getContext` through the harness stubs, the clock
 * is scripted so a frame is worth exactly 1000/60 ms, the surface reports the
 * measurements jsdom performs no layout for, and the caller advances frames
 * rather than letting `engine.run()` drive them.
 */
function boot(): Engine {
  document.body.innerHTML = '<canvas id="game"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  return createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#0b0f16",
    game: breaker,
    clock: new ConstantClock(1000 / 60),
    surface: createSurface({ cssWidth: 640, cssHeight: 360, dpr: 1 }).surface,
  });
}

/** One frame's worth of simulated seconds under the scripted clock. */
const DT = 1 / 60;

/** The ball's radius, the figure every pose below measures a clearance in. */
const BALL_RADIUS = 0.2;

/** Poses the ball outright: the page's own fields, written from a test. */
function pose(ball: Ball, position: Vec3, velocity: Vec3): void {
  ball.transform.position = position;
  ball.velocity = velocity;
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("the documentation's Breaker example", () => {
  let engine: Engine;
  let contexts: InstalledContexts;

  beforeEach(() => {
    contexts = installCanvasContexts();
    engine = boot();
  });

  afterEach(() => {
    engine.destroy();
    contexts.uninstall();
  });

  it("opens breaker fully posed: lights, walls, paddle, bricks, floor, ball, hint", async () => {
    await engine.initialize();
    const world = engine.world;

    expect(world.level).toBe(LEVEL);
    // `beginPlay` set the phase before initialize resolved.
    expect(world.state.phase).toBe("playing");
    expect((world.mode as BreakerMode).lives).toBe(3);

    // The lights actor + 3 wall bars + the paddle bar + 27 bricks + the floor
    // + the ball are the declared actors; the mode spawned the hint in its
    // own beginPlay.
    expect(world.actors()).toHaveLength(35);
    expect(world.ofType(Brick)).toHaveLength(27);
    expect(world.ofType(Floor)).toHaveLength(1);

    const ball = world.find(Ball);
    expect(ball?.transform.position).toEqual(SERVE);
    expect(ball?.velocity).toEqual({ x: SPEED * 0.6, y: SPEED, z: 0 });

    // A spec's `transform` is a `Partial<Transform>`: a bar gave its position
    // alone and took the identity rotation and the unit scale, and the lights
    // actor gave its rotation alone and took the origin.
    const topWall = world.actors()[1];
    expect(topWall?.transform.position).toEqual({ x: 0, y: 4.75, z: 0 });
    expect(topWall?.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(topWall?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(world.actors()[0]?.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(world.actors()[0]?.transform.rotation).toEqual(
      quatLookAt(vec3(-0.4, -1, -0.6)),
    );

    // The floor is a trigger: it carries a collider and no render component,
    // while everything the player sees carries both. The hint is an unlit
    // sphere, so it reads as a marker under any lighting.
    const floor = world.find(Floor);
    expect(floor?.components).toHaveLength(1);
    expect(floor?.component(ColliderComponent)).not.toBeNull();
    expect(floor?.component(MeshComponent)).toBeNull();
    expect(ball?.component(MeshComponent)).not.toBeNull();
    expect(ball?.component(ColliderComponent)).not.toBeNull();
    const hint = world.actors().at(-1);
    expect(hint?.component(ColliderComponent)).toBeNull();
    expect(hint?.component(MeshComponent)?.geometry).toEqual(HINT_GEOMETRY);
    expect(hint?.component(MeshComponent)?.material.kind).toBe("basic");

    // Ids are assigned in spawn order, which is what makes the page's "a is
    // the actor of the pair with the lower id" a statement about declaration
    // order: every declared actor precedes the ball except the mode's hint.
    const ids = world.actors().map((actor) => actor.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("sees the whole field from the camera's defaults, which the game never poses", async () => {
    await engine.initialize();
    const camera = engine.world.camera;

    // "The camera stays at its defaults, at (0, 0, 10) looking along -Z": the
    // game poses nothing, so the field centered on the origin is simply in
    // view.
    expect(camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(camera.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(camera.projection).toBe("perspective");
    expect(camera.fov).toBe(60);

    // "A perspective camera with a fov of 60 sees about eleven and a half world
    // units vertically on the z = 0 plane from there, which the nine-unit field
    // and its walls fit inside." The walls put the outer faces at y = ±5.
    const span = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    expect(span).toBeCloseTo(11.547, 3);
    expect(span).toBeGreaterThan(FIELD.height + 2 * FIELD.wall);

    const top = camera.worldToLogical(vec3(0, 5, 0));
    const bottom = camera.worldToLogical(vec3(0, -5, 0));
    expect(top.visible).toBe(true);
    expect(bottom.visible).toBe(true);
    expect(top.y).toBeGreaterThan(0);
    expect(bottom.y).toBeLessThan(360);
  });

  it("hands one shape record to the collider and to the mesh that shows it", async () => {
    await engine.initialize();
    const world = engine.world;
    const ball = world.find(Ball);
    const brick = world.ofType(Brick)[0];
    const topWall = world.actors()[1];
    if (ball === null || brick === undefined || topWall === undefined) {
      throw new Error("breaker did not open fully posed");
    }

    // "A box and a sphere carry the same fields whether they name a
    // ColliderShape or a MeshGeometry, so one record is handed to the collider
    // and to the mesh that shows it": each of these actors holds the very
    // record its module declared, in both components, rather than two records
    // that happen to agree today.
    for (const actor of [ball, brick, topWall]) {
      expect(actor.component(MeshComponent)?.geometry).toBe(
        actor.component(ColliderComponent)?.shape,
      );
    }
    expect(ball.component(ColliderComponent)?.shape).toBe(BALL_COLLIDER.shape);
    expect(brick.component(ColliderComponent)?.shape).toBe(
      BRICK_COLLIDER.shape,
    );

    // "Every figure is in world units": the ball's collider encloses exactly
    // the sphere the constants declare, centered on the serve, and the brick's
    // box is the width, height, and depth the constants give it.
    const sphere = ball.component(ColliderComponent)?.bounds();
    if (sphere === undefined) throw new Error("the ball carries no collider");
    expect(sphere.min.y).toBeCloseTo(SERVE.y - BALL_RADIUS, 6);
    expect(sphere.max.y).toBeCloseTo(SERVE.y + BALL_RADIUS, 6);
    expect(sphere.max.x - sphere.min.x).toBeCloseTo(2 * BALL_RADIUS, 6);
    expect(sphere.max.z - sphere.min.z).toBeCloseTo(2 * BALL_RADIUS, 6);

    const box = brick.component(ColliderComponent)?.bounds();
    if (box === undefined) throw new Error("the brick carries no collider");
    expect(box.max.x - box.min.x).toBeCloseTo(1.5, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(0.5, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(FIELD.depth, 6);
  });

  it("lights the field along the direction quatLookAt turned FORWARD onto", async () => {
    await engine.initialize();
    const lights = engine.world.actors()[0];
    if (lights === undefined) throw new Error("no lights actor");

    // The lights actor is the one declared actor with no collider at all, so
    // it never enters the pass.
    expect(lights.component(ColliderComponent)).toBeNull();
    const attached = lights.componentsOf(LightComponent);
    expect(attached).toHaveLength(2);
    expect(attached[0]?.light).toEqual({ kind: "hemisphere", intensity: 0.6 });
    expect(attached[1]?.light).toEqual({ kind: "directional", intensity: 2 });

    // "A directional light shines along its component's world forward axis,
    // and `quatLookAt` is the rotation that turns `FORWARD` onto the direction
    // given": the actor gave a rotation alone, and the component inherits it
    // through an identity offset, so the light's world forward is exactly the
    // direction the page named, at unit length.
    const world = attached[1]?.worldTransform();
    if (world === undefined) throw new Error("no directional light");
    const heading = quatRotate(world.rotation, FORWARD);
    const declared = normalize(vec3(-0.4, -1, -0.6));
    expect(heading.x).toBeCloseTo(declared.x, 6);
    expect(heading.y).toBeCloseTo(declared.y, 6);
    expect(heading.z).toBeCloseTo(declared.z, 6);
    expect(length(heading)).toBeCloseTo(1, 6);

    // "so the light falls down and into the field from the upper right": it
    // travels downward, leftward, and away from the camera, which puts its
    // source above, to the right, and in front of the field.
    expect(heading.y).toBeLessThan(0);
    expect(heading.x).toBeLessThan(0);
    expect(heading.z).toBeLessThan(0);
  });

  it("aims the hint along the ball's heading through the same collision world", async () => {
    await engine.initialize();
    await engine.advance(1);

    // The ball serves at (0, -1.5, 0) heading (0.6, 1, 0) · 6 and travels
    // along its own ray, so the aim point is invariant while the heading
    // holds. One frame in, the ball is at (0.06, -1.4, 0); the ray climbs
    // 0.6 units of x for every unit of y and first meets the underside of the
    // bottom brick row (y = 1.75) at x = 0.06 + 3.15 · 0.6 = 1.95, inside the
    // brick centered on x = 1.6, which spans 0.85 to 2.35.
    const hint = engine.world.actors().at(-1);
    expect(hint?.transform.position.x).toBeCloseTo(1.95, 6);
    expect(hint?.transform.position.y).toBeCloseTo(1.75, 6);
    expect(hint?.transform.position.z).toBeCloseTo(0, 6);
  });

  it("reads the same collision world by raycast: the nearest hit, bounded, with the ball left out", async () => {
    await engine.initialize();
    await engine.advance(1);
    const world = engine.world;
    const ball = world.find(Ball);
    const hint = world.actors().at(-1);
    if (ball === null || hint === undefined) {
      throw new Error("no ball or no hint in the arena");
    }

    // The mode's own query, run again from the test against the same collision
    // world: "the hit's `point` is where the ray meets the nearest collider the
    // query answers", and the mode wrote exactly that onto the hint.
    const origin = ball.transform.position;
    const heading = normalize(ball.velocity);
    const options = { ...QUERY, ignore: [ball] };
    const aim = world.collision.raycast(origin, heading, 40, options);
    expect(aim?.point).toEqual(hint.transform.position);
    expect(aim?.actor).toBeInstanceOf(Brick);
    // Met on the underside of the bottom brick row, so the surface normal
    // there points down at the climbing ray.
    expect(aim?.normal.y).toBeCloseTo(-1, 6);
    expect(aim?.distance).toBeCloseTo((1.75 - origin.y) / heading.y, 6);

    // "`distance` bounds the ray's length, in world units": the same ray cut
    // short of the brick row answers nothing at all.
    expect(world.collision.raycast(origin, heading, 3, options)).toBeNull();

    // "and so is every collider owned by an actor `ignore` names": naming every
    // brick lets the ray through the wall of them to the top wall behind, which
    // it meets at x = 0.06 + 5.9 * 0.6.
    const past = world.collision.raycast(origin, heading, 40, {
      ...QUERY,
      ignore: [ball, ...world.ofType(Brick)],
    });
    expect(past?.actor).toBe(world.actors()[1]);
    expect(past?.point.x).toBeCloseTo(3.6, 6);
    expect(past?.point.y).toBeCloseTo(4.5, 6);
  });

  it("holds the hint where the ray answers nothing and where the ball has stopped", async () => {
    await engine.initialize();
    await engine.advance(1);
    const world = engine.world;
    const ball = world.find(Ball);
    const hint = world.actors().at(-1);
    if (ball === null || hint === undefined) {
      throw new Error("no ball or no hint in the arena");
    }
    const aimed = { ...hint.transform.position };

    // Turned to face out of the play plane, the ball's ray leaves the field
    // through the open front and meets nothing inside the forty units the mode
    // bounds it by, so `raycast` answers `null` and the mode leaves the hint
    // where the last answer put it.
    ball.velocity = vec3(0, 0, SPEED);
    await engine.advance(1);
    expect(hint.transform.position).toEqual(aimed);

    // A stopped ball has no heading — "the zero vector normalizes to the zero
    // vector", which is no ray at all — so the mode's own guard returns before
    // it asks the collision world anything, and neither the ball nor its
    // marker moves again.
    const resting = { ...ball.transform.position };
    ball.velocity = vec3(0, 0, 0);
    await engine.advance(1);
    expect(ball.transform.position).toEqual(resting);
    expect(hint.transform.position).toEqual(aimed);
  });

  it("reports a pair produced by this frame's movement in that frame, moving nothing", async () => {
    // This subscriber outruns the mode's (initialize has not run yet), so it
    // reads the ball where the collision pass found it — before the game's
    // reflect response moves it.
    const seen: {
      aIsBrick: boolean;
      ballAt: Vec3;
      brickAt: Vec3;
      ownedByA: boolean;
      ownedByB: boolean;
      manifold: Manifold;
    }[] = [];
    engine.events.on("hit", ({ a, b, colliders, manifold }) => {
      if (!(b instanceof Ball)) return;
      seen.push({
        aIsBrick: a instanceof Brick,
        ballAt: { ...b.transform.position },
        brickAt: { ...a.transform.position },
        ownedByA: a.component(ColliderComponent) === colliders[0],
        ownedByB: b.component(ColliderComponent) === colliders[1],
        manifold,
      });
    });
    const destroyed: Actor[] = [];
    engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor));

    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    // Posed one frame's travel short of the brick centered on (0, 2, 0),
    // whose box spans y 1.75 to 2.25, rising straight at it: this frame's
    // movement is what makes the pair.
    pose(ball, vec3(0, 1.5, 0), vec3(0, SPEED, 0));
    await engine.advance(1);

    // The pass ran after the tick and reported the pair the tick produced, in
    // the same frame, with the ball still at its ticked position: the engine
    // moved nothing.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aIsBrick).toBe(true);
    expect(seen[0]?.ballAt.y).toBeCloseTo(1.5 + SPEED * DT, 6);
    // "It reported the two actors, their colliders, and the manifold, and
    // moved nothing": `colliders` is in the pair's own order, and the brick is
    // exactly where the level declared it — the engine pushed neither side
    // out of the other.
    expect(seen[0]?.ownedByA).toBe(true);
    expect(seen[0]?.ownedByB).toBe(true);
    expect(seen[0]?.brickAt.x).toBeCloseTo(0, 6);
    expect(seen[0]?.brickAt.y).toBeCloseTo(2, 6);
    // The manifold points from `a` — the brick — down toward the ball beneath
    // it, and its depth is the overlap this frame's movement drove in.
    expect(seen[0]?.manifold.normal.x).toBeCloseTo(0, 6);
    expect(seen[0]?.manifold.normal.y).toBeCloseTo(-1, 6);
    expect(seen[0]?.manifold.depth).toBeCloseTo(
      1.5 + SPEED * DT + BALL_RADIUS - 1.75,
      6,
    );
    // The play is on the z = 0 plane and every box is centered there and
    // deeper than the ball is wide, so the normal lies in the XY plane.
    expect(seen[0]?.manifold.normal.z).toBe(0);
    expect(seen[0]?.manifold.point.z).toBeCloseTo(0, 6);

    // Every consequence was the game's: `reflect` backed the ball out along
    // the flipped normal by the depth and mirrored its velocity, and the mode
    // destroyed the brick it struck.
    expect(ball.transform.position.y).toBeCloseTo(1.75 - BALL_RADIUS, 6);
    expect(ball.velocity.y).toBe(-SPEED);
    // The game did nothing to hold the ball in the plane; the manifold did.
    expect(ball.transform.position.z).toBe(0);
    expect(ball.velocity.z).toBe(0);

    expect(engine.world.ofType(Brick)).toHaveLength(26);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toBeInstanceOf(Brick);
    expect(destroyed[0]?.transform.position.x).toBeCloseTo(0, 6);
    expect(destroyed[0]?.transform.position.y).toBeCloseTo(2, 6);

    // The pass ran before the mode ticked, so the mode's raycast this frame
    // already used the heading `reflect` had just written: straight down from
    // the ball onto the paddle's top face at y = -3.45, rather than up at the
    // brick row the ball had been climbing toward.
    const hint = engine.world.actors().at(-1);
    expect(hint?.transform.position.x).toBeCloseTo(0, 6);
    expect(hint?.transform.position.y).toBeCloseTo(-3.45, 6);
  });

  it("reflects off the paddle: lower id first, one blocking hit, speed kept", async () => {
    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    const hits: { lowerFirst: boolean; normal: Vec3 }[] = [];
    engine.events.on("hit", ({ a, b, manifold }) =>
      hits.push({ lowerFirst: a.id < b.id, normal: manifold.normal }),
    );

    // Dropped straight onto the paddle's center. The paddle's box is centered
    // on (0, -3.6, 0) and 0.3 deep in y, so its top face is at -3.45: three
    // frames of 6/60 put the ball's center at -3.3, one twentieth of a unit
    // inside the ball's own radius of the face.
    pose(ball, vec3(0, -3, 0), vec3(0, -SPEED, 0));
    await engine.advance(3);

    // The paddle was declared before the ball, so it is `a` and the normal
    // points from it up toward the ball; the mode flipped it for the ball.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.lowerFirst).toBe(true);
    expect(hits[0]?.normal.x).toBeCloseTo(0, 6);
    expect(hits[0]?.normal.y).toBeCloseTo(1, 6);
    expect(hits[0]?.normal.z).toBeCloseTo(0, 6);

    // Backed out to rest on the surface, velocity mirrored, speed unchanged.
    expect(ball.transform.position.y).toBeCloseTo(-3.45 + BALL_RADIUS, 6);
    expect(ball.velocity.y).toBe(SPEED);
    expect(length(ball.velocity)).toBeCloseTo(SPEED, 6);

    // The blocking pair separated, so the following frames find nothing.
    await engine.advance(3);
    expect(hits).toHaveLength(1);
  });

  it("answers an unlisted channel with ignore, and takes the stronger of the two", async () => {
    await engine.initialize();
    const world = engine.world;
    const ball = world.find(Ball);
    const leftWall = world.actors()[2];
    const paddle = world.actors()[4];
    const bricks = world.ofType(Brick);
    const [onPaddle, onBrick, under] = bricks;
    if (
      ball === null ||
      leftWall === undefined ||
      paddle === undefined ||
      onPaddle === undefined ||
      onBrick === undefined ||
      under === undefined
    ) {
      throw new Error("breaker did not open fully posed");
    }

    const reported: { name: string; a: Actor; b: Actor }[] = [];
    engine.events.on("hit", ({ a, b }) => reported.push({ name: "hit", a, b }));
    engine.events.on("overlap:begin", ({ a, b }) =>
      reported.push({ name: "overlap:begin", a, b }),
    );

    // Two pairs the response maps leave at `ignore`, driven straight through
    // each other. A brick's map names `ball` alone and the paddle bar's names
    // `ball` alone, so brick-against-paddle is unlisted on both sides; a
    // brick's map does not name `brick` either, so brick-against-brick is
    // unlisted on both sides too. "A pair both sides ignore is never tested."
    onPaddle.transform.position = { ...paddle.transform.position };
    onBrick.transform.position = { ...under.transform.position };

    // One pair both sides answer `block`, made by this frame's movement: the
    // ball's map answers `wall` with `block` and the wall bar's answers `ball`
    // with `block`. The left wall's box spans x -8.5 to -8.0.
    pose(ball, vec3(-7.85, 0, 0), vec3(-SPEED, 0, 0));
    await engine.advance(1);

    // Both ignored pairs really are interpenetrating: a query that answers
    // `brick`, `paddle`, and nothing else finds the two bodies sharing each
    // volume. The pass declined to test them all the same.
    const anything = {
      channel: CHANNEL.ball,
      responses: { [CHANNEL.brick]: "block", [CHANNEL.paddle]: "block" },
    } as const;
    const { shape } = BRICK_COLLIDER;
    const onTheBar = world.collision.query(
      shape,
      paddle.transform.position,
      undefined,
      anything,
    );
    expect(
      onTheBar.map((found) => found.actor).sort((x, y) => x.id - y.id),
    ).toEqual([paddle, onPaddle]);
    const stacked = world.collision.query(
      shape,
      under.transform.position,
      undefined,
      anything,
    );
    expect(
      stacked.map((found) => found.actor).sort((x, y) => x.id - y.id),
    ).toEqual([onBrick, under]);

    // Nothing but the blocking pair was reported: the two interpenetrating
    // ignore pairs never entered the pass at all.
    expect(reported).toHaveLength(1);
    expect(reported[0]?.name).toBe("hit");
    expect(reported[0]?.a).toBe(leftWall);
    expect(reported[0]?.b).toBe(ball);
    expect(onPaddle.alive).toBe(true);
    expect(onBrick.alive).toBe(true);

    // The wall is `a`, so its normal points out of the wall toward the ball;
    // the mode flipped it and the ball left along +X at the speed it arrived.
    expect(ball.transform.position.x).toBeCloseTo(-8 + BALL_RADIUS, 6);
    expect(ball.velocity.x).toBe(SPEED);

    // The third answer, `overlap`, is the one the floor establishes from a
    // single side; the trigger test below drives it.
  });

  it("spends the reflection once: the into guard makes repeats cost nothing", async () => {
    await engine.initialize();
    const ball = engine.world.find(Ball);
    if (ball === null) throw new Error("no ball in the arena");

    // First report: the ball moves into the surface, so the velocity mirrors.
    ball.reflect(vec3(0, 1, 0), 0.5);
    expect(ball.velocity).toEqual({ x: SPEED * 0.6, y: -SPEED, z: 0 });
    expect(ball.transform.position.y).toBeCloseTo(SERVE.y - 0.5, 6);

    // A blocking pair emits `hit` on every frame it is found. A later frame
    // reporting the same pair still backs the ball out, but the ball now moves
    // away from the surface — `into <= 0` — so the frame costs the velocity
    // nothing.
    ball.reflect(vec3(0, 1, 0), 0.2);
    expect(ball.velocity).toEqual({ x: SPEED * 0.6, y: -SPEED, z: 0 });
    expect(ball.transform.position.y).toBeCloseTo(SERVE.y - 0.7, 6);
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

    // The floor's box is centered on (0, -4.75, 0) and half a unit deep, so
    // its top face is at -4.5 and the ball penetrates once its center passes
    // -4.3. Dropped from -4.05 clear of the paddle, three frames of 6/60 put
    // it at -4.35; the two frames before that leave it outside.
    const drop = (): void => pose(ball, vec3(5, -4.05, 0), vec3(0, -SPEED, 0));

    drop();
    await engine.advance(2);
    expect(begins).toHaveLength(0);

    // The pair settles on `overlap` — the ball leaves `floor` unlisted, the
    // floor answers the ball with `overlap`, and the pair takes the stronger —
    // so it begins once, costs a life, and serves.
    await engine.advance(1);
    expect(begins).toHaveLength(1);
    expect(begins[0]?.aIsFloor).toBe(true); // declared before the ball
    expect(mode.lives).toBe(2);
    expect(ball.transform.position).toEqual(SERVE);
    expect(ball.velocity).toEqual({ x: SPEED * 0.6, y: SPEED, z: 0 });

    // The serve moved the ball off the floor, so the next frame's pass stops
    // finding the pair and emits the end.
    await engine.advance(1);
    expect(ends).toHaveLength(1);

    // The second life spends exactly as the first did.
    drop();
    await engine.advance(3);
    expect(begins).toHaveLength(2);
    expect(mode.lives).toBe(1);
    expect(ball.transform.position).toEqual(SERVE);
    await engine.advance(1);
    expect(ends).toHaveLength(2);

    // The third crossing ends the match instead of serving.
    drop();
    await engine.advance(3);
    expect(begins).toHaveLength(3);
    expect(mode.lives).toBe(0);
    expect(engine.world.state.phase).toBe("over");
    expect(phases).toEqual(["playing", "over"]);

    // No serve rescues the ball this time, and the floor never stopped it: it
    // keeps falling straight through the slab at undiminished speed.
    expect(ball.transform.position.y).toBeCloseTo(-4.05 - SPEED * 3 * DT, 6);
    expect(ball.velocity.y).toBe(-SPEED);
    await engine.advance(4);
    expect(ball.transform.position.y).toBeCloseTo(-4.05 - SPEED * 7 * DT, 6);
    expect(ball.velocity.y).toBe(-SPEED);
    expect(ends).toHaveLength(2);

    // Nothing blocked anywhere in the run — the floor reports the crossing
    // without stopping the ball, and the descent touches nothing else.
    expect(blocked).toHaveLength(0);

    // The pair is still overlapping when the world closes, and closing emits
    // the end the pass will never reach.
    engine.destroy();
    expect(ends).toHaveLength(3);
    expect(ends[2]?.aIsFloor).toBe(true);
  });

  it("ends the floor's overlap when the floor is destroyed, with the ball still inside it", async () => {
    const ends: { a: Actor; b: Actor }[] = [];
    engine.events.on("overlap:end", ({ a, b }) => ends.push({ a, b }));

    await engine.initialize();
    const world = engine.world;
    const mode = world.mode as BreakerMode;
    const ball = world.find(Ball);
    const floor = world.find(Floor);
    if (ball === null || floor === null) {
      throw new Error("no ball or no floor in the arena");
    }

    // All three lives spent on the same crossing. The first two serve the ball
    // clear, and each serve's separation is what emits that life's end; the
    // third sets the phase instead, so the ball is left inside the slab and the
    // pass goes on finding the pair.
    for (let life = 0; life < 3; life += 1) {
      pose(ball, vec3(5, -4.05, 0), vec3(0, -SPEED, 0));
      await engine.advance(3);
    }
    expect(mode.lives).toBe(0);
    expect(ends).toHaveLength(2);

    // "`overlap:end` ... is also emitted when either actor is destroyed": a
    // destroyed actor's colliders are left out of the pass, so the frame after
    // the floor is destroyed reports the end the ball never moved to earn.
    floor.destroy();
    await engine.advance(1);
    expect(ends).toHaveLength(3);
    expect(ends[2]?.a).toBe(floor);
    expect(ends[2]?.b).toBe(ball);
  });

  it("takes the ball out of the plane when the surface it meets is out of the plane", async () => {
    const seen: Manifold[] = [];
    engine.events.on("hit", ({ manifold }) => seen.push(manifold));

    await engine.initialize();
    const ball = engine.world.find(Ball);
    const brick = engine.world.ofType(Brick)[0];
    if (ball === null || brick === undefined) {
      throw new Error("no ball or no brick in the arena");
    }

    // One brick moved clear of the wall of bricks and tilted thirty degrees
    // about X, so its underside no longer faces straight down.
    const tilt = Math.PI / 6;
    brick.transform.position = vec3(0, -2, 0);
    brick.transform.rotation = quatFromAxisAngle(vec3(1, 0, 0), tilt);

    // Rising straight at it, exactly as the in-plane case rose at the wall.
    pose(ball, vec3(0, -2.55, 0), vec3(0, SPEED, 0));
    await engine.advance(1);

    // The normal is the tilted face's own outward direction, so it carries a
    // z component the in-plane collisions never produce.
    expect(seen).toHaveLength(1);
    const manifold = seen[0];
    if (manifold === undefined) throw new Error("no manifold");
    expect(manifold.normal.x).toBeCloseTo(0, 6);
    expect(manifold.normal.y).toBeCloseTo(-Math.cos(tilt), 6);
    expect(manifold.normal.z).toBeCloseTo(-Math.sin(tilt), 6);
    expect(manifold.depth).toBeGreaterThan(0);

    // The same `reflect`, unchanged, uses the normal whole: the ball backs out
    // along all three axes and leaves along the reflected direction, out of
    // the plane it had never left.
    const flipped = scale(manifold.normal, -1);
    expect(ball.transform.position.z).toBeCloseTo(
      -flipped.z * manifold.depth,
      6,
    );
    expect(ball.transform.position.z).toBeLessThan(0);
    expect(ball.velocity.y).toBeCloseTo(
      SPEED - 2 * SPEED * Math.cos(tilt) ** 2,
      6,
    );
    expect(ball.velocity.z).toBeCloseTo(
      -2 * SPEED * Math.cos(tilt) * Math.sin(tilt),
      6,
    );
    expect(ball.velocity.z).not.toBe(0);
    // A reflection is a mirror, so the speed the ball leaves with is the speed
    // it arrived with.
    expect(length(ball.velocity)).toBeCloseTo(SPEED, 6);
  });
});
