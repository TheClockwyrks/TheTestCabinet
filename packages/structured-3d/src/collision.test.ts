import { describe, expect, it } from "vitest";
import {
  ColliderComponent,
  CollisionSystem,
  type CollisionEventMap,
  type CollisionHitEvent,
  type CollisionPairEvent,
} from "./collision";
import { QUAT_IDENTITY, UP, quatFromAxisAngle } from "./math";
import type { Actor } from "./actors";
import type {
  ColliderOptions,
  ColliderShape,
  Manifold,
  Quat,
  Transform,
  Vec3,
} from "./contract";

/**
 * The suite drives the system through fakes rather than through the real
 * `Actor`, `EngineWorld`, and `EventBus`, because those are separate subsystems
 * with their own suites and their scaffolds may still throw. The system's
 * documented inputs are narrow — a list of live actors whose components include
 * colliders, each collider positioned by its `worldTransform()` — so a fake
 * actor is a plain record carrying the two fields `Component.worldTransform`
 * and the pass actually read, and the colliders themselves are the real class
 * with the real composition running underneath them.
 */
interface FakeActor {
  id: number;
  alive: boolean;
  transform: Transform;
  components: ColliderComponent[];
}

/** One event the fake broadcaster recorded, in emission order. */
interface Emitted {
  event: keyof CollisionEventMap;
  payload: CollisionPairEvent | CollisionHitEvent;
}

/** A full transform from a position, for fakes and stubs. */
function at(
  x: number,
  y: number,
  z: number,
  rest?: Partial<Transform>,
): Transform {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    ...rest,
  };
}

/** A vector, spelled the way the assertions below read best. */
function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Component-wise closeness, the shape almost every geometry assertion takes. */
function expectVec3(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

/** A fake world: actors in spawn order, a recording emitter, and the system. */
function makeWorld() {
  const actors: FakeActor[] = [];
  const events: Emitted[] = [];
  let nextId = 1;

  const system = new CollisionSystem({
    actors: () => actors as unknown as readonly Actor[],
    emit: (event, payload) => {
      events.push({ event, payload });
    },
  });

  /** Spawns a fake actor at a position, ids assigned in spawn order. */
  function actor(x = 0, y = 0, z = 0): FakeActor {
    const spawned: FakeActor = {
      id: nextId,
      alive: true,
      transform: at(x, y, z),
      components: [],
    };
    nextId += 1;
    actors.push(spawned);
    return spawned;
  }

  /**
   * Attaches a real `ColliderComponent` to a fake actor and wires the actor
   * back, so the component's own `worldTransform()` — the documented
   * composition of the actor's transform with the component's `offset` — is
   * what positions the shape, rather than a stub standing in for it.
   */
  function collider(
    owner: FakeActor,
    options: ColliderOptions,
  ): ColliderComponent {
    const component = new ColliderComponent(options);
    (component as { actor: Actor }).actor = owner as unknown as Actor;
    owner.components.push(component);
    return component;
  }

  return { actors, events, system, actor, collider };
}

/** A lone collider on a lone actor, for `bounds()` and the shape helpers. */
function lone(shape: ColliderShape, transform: Transform): ColliderComponent {
  const world = makeWorld();
  const owner = world.actor();
  owner.transform = transform;
  return world.collider(owner, { shape });
}

/** The event names in emission order, the shape most ordering tests assert. */
function names(events: readonly Emitted[]): string[] {
  return events.map((e) => e.event);
}

/** The manifold of the only hit emitted so far, asserting there is exactly one. */
function onlyHit(events: readonly Emitted[]): CollisionHitEvent {
  const hits = events.filter((e) => e.event === "hit");
  expect(hits).toHaveLength(1);
  return hits[0]!.payload as CollisionHitEvent;
}

/**
 * The manifold between two lone colliders, oriented from the first toward the
 * second: the first actor is spawned first and so carries the lower `id`, which
 * is the order the pass reports and orients by.
 */
function between(
  first: ColliderShape,
  firstAt: Transform,
  second: ColliderShape,
  secondAt: Transform,
): Manifold | null {
  const world = makeWorld();
  const a = world.actor();
  a.transform = firstAt;
  world.collider(a, { shape: first, channel: "a", responses: { b: "block" } });
  const b = world.actor();
  b.transform = secondAt;
  world.collider(b, { shape: second, channel: "b" });
  world.system.pass();
  const hits = world.events.filter((e) => e.event === "hit");
  if (hits.length === 0) return null;
  expect(hits).toHaveLength(1);
  return (hits[0]!.payload as CollisionHitEvent).manifold;
}

/** A rotation of `turns` quarter-turns about `axis`, for the oriented shapes. */
function turn(axis: Vec3, quarters: number): Quat {
  return quatFromAxisAngle(axis, (quarters * Math.PI) / 2);
}

const BOX_1: ColliderShape = { kind: "box", width: 2, height: 2, depth: 2 };

/* -------------------------------------------------------------------------- */

describe("ColliderComponent", () => {
  it('defaults the channel to "default" and the responses to empty', () => {
    const component = new ColliderComponent({
      shape: { kind: "sphere", radius: 4 },
    });

    expect(component.channel).toBe("default");
    expect(component.responses).toEqual({});
  });

  it("keeps the channel and responses it was given", () => {
    const component = new ColliderComponent({
      shape: { kind: "sphere", radius: 8 },
      channel: "ball",
      responses: { wall: "block", goal: "overlap" },
    });

    expect(component.channel).toBe("ball");
    expect(component.responses).toEqual({ wall: "block", goal: "overlap" });
  });

  it("copies the responses record it was constructed from", () => {
    const responses = { wall: "block" } as const;
    const component = new ColliderComponent({
      shape: { kind: "sphere", radius: 8 },
      responses,
    });

    component.responses["goal"] = "overlap";

    expect(responses).toEqual({ wall: "block" });
  });

  it("holds the shape it was given, by reference, so a game can mutate it", () => {
    const shape: ColliderShape = { kind: "capsule", radius: 1, height: 2 };
    const component = new ColliderComponent({ shape });

    expect(component.shape).toBe(shape);
  });

  it("is enabled by default, with the identity offset", () => {
    const component = new ColliderComponent({
      shape: { kind: "sphere", radius: 1 },
    });

    expect(component.enabled).toBe(true);
    expect(component.offset.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(component.offset.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(component.offset.scale).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe("ColliderComponent.bounds", () => {
  it("encloses a sphere at the component's world transform", () => {
    const component = lone({ kind: "sphere", radius: 2 }, at(1, 2, 3));

    expect(component.bounds()).toEqual({
      min: { x: -1, y: 0, z: 1 },
      max: { x: 3, y: 4, z: 5 },
    });
  });

  it("encloses a box by its half extents on each axis", () => {
    const component = lone(
      { kind: "box", width: 2, height: 4, depth: 6 },
      at(0, 0, 0),
    );

    expect(component.bounds()).toEqual({
      min: { x: -1, y: -2, z: -3 },
      max: { x: 1, y: 2, z: 3 },
    });
  });

  it("encloses a rotated box by its rotated corners", () => {
    const component = lone(
      BOX_1,
      at(0, 0, 0, { rotation: quatFromAxisAngle(UP, Math.PI / 4) }),
    );

    const bounds = component.bounds();
    expectVec3(bounds.min, v(-Math.SQRT2, -1, -Math.SQRT2));
    expectVec3(bounds.max, v(Math.SQRT2, 1, Math.SQRT2));
  });

  it("spans height plus two radii along a capsule's own axis", () => {
    const component = lone(
      { kind: "capsule", radius: 0.5, height: 2 },
      at(0, 0, 0),
    );

    expect(component.bounds()).toEqual({
      min: { x: -0.5, y: -1.5, z: -0.5 },
      max: { x: 0.5, y: 1.5, z: 0.5 },
    });
  });

  it("lays a capsule down when its transform turns it", () => {
    const component = lone(
      { kind: "capsule", radius: 0.5, height: 2 },
      at(0, 0, 0, { rotation: turn(v(0, 0, 1), 1) }),
    );

    const bounds = component.bounds();
    expectVec3(bounds.min, v(-1.5, -0.5, -0.5));
    expectVec3(bounds.max, v(1.5, 0.5, 0.5));
  });

  it("scales a sphere by the largest of the three factors", () => {
    const component = lone(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0, { scale: { x: 2, y: 3, z: 1 } }),
    );

    expect(component.bounds()).toEqual({
      min: { x: -3, y: -3, z: -3 },
      max: { x: 3, y: 3, z: 3 },
    });
  });

  it("scales a box's extents per axis", () => {
    const component = lone(BOX_1, at(0, 0, 0, { scale: { x: 2, y: 3, z: 4 } }));

    expect(component.bounds()).toEqual({
      min: { x: -2, y: -3, z: -4 },
      max: { x: 2, y: 3, z: 4 },
    });
  });

  it("scales a capsule's height by Y and its radius by the largest factor", () => {
    const component = lone(
      { kind: "capsule", radius: 1, height: 2 },
      at(0, 0, 0, { scale: { x: 1, y: 2, z: 3 } }),
    );

    expect(component.bounds()).toEqual({
      min: { x: -3, y: -5, z: -3 },
      max: { x: 3, y: 5, z: 3 },
    });
  });

  it("takes a negative scale as the volume it is drawn as", () => {
    const component = lone(
      BOX_1,
      at(0, 0, 0, { scale: { x: -2, y: 1, z: 1 } }),
    );

    expect(component.bounds()).toEqual({
      min: { x: -2, y: -1, z: -1 },
      max: { x: 2, y: 1, z: 1 },
    });
  });

  it("moves with the component's offset", () => {
    const component = lone({ kind: "sphere", radius: 1 }, at(0, 0, 0));
    component.offset.position = { x: 5, y: 0, z: 0 };

    expect(component.bounds()).toEqual({
      min: { x: 4, y: -1, z: -1 },
      max: { x: 6, y: 1, z: 1 },
    });
  });

  it("answers for a degenerate shape with a zero-sized box at its position", () => {
    const component = lone({ kind: "sphere", radius: 0 }, at(2, 3, 4));

    expect(component.bounds()).toEqual({
      min: { x: 2, y: 3, z: 4 },
      max: { x: 2, y: 3, z: 4 },
    });
  });
});

describe("resolving a pair", () => {
  /** Two spheres deep inside each other, so only the resolution decides. */
  function pair(
    a: Pick<ColliderOptions, "channel" | "responses">,
    b: Pick<ColliderOptions, "channel" | "responses">,
  ) {
    const world = makeWorld();
    const first = world.actor(0, 0, 0);
    world.collider(first, { shape: { kind: "sphere", radius: 1 }, ...a });
    const second = world.actor(0.5, 0, 0);
    world.collider(second, { shape: { kind: "sphere", radius: 1 }, ...b });
    return world;
  }

  it("lets one side alone establish a block, so bare scenery still blocks", () => {
    const world = pair(
      { channel: "ball", responses: { wall: "block" } },
      { channel: "wall" },
    );

    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("takes the stronger of the two answers, block over overlap", () => {
    const world = pair(
      { channel: "ball", responses: { wall: "overlap" } },
      { channel: "wall", responses: { ball: "block" } },
    );

    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("never tests a pair neither side names", () => {
    const world = pair({ channel: "ball" }, { channel: "wall" });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("leaves a pair both sides declare ignore alone", () => {
    const world = pair(
      { channel: "ball", responses: { wall: "ignore" } },
      { channel: "wall", responses: { ball: "ignore" } },
    );

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("settles on overlap when the stronger answer is overlap", () => {
    const world = pair(
      { channel: "ball", responses: { goal: "overlap" } },
      { channel: "goal", responses: { ball: "ignore" } },
    );

    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin"]);
  });

  it("answers for the default channel of a collider constructed without one", () => {
    const world = pair({ responses: {} }, { responses: { default: "block" } });

    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("treats a channel named after an Object.prototype member as unlisted", () => {
    const world = pair(
      { channel: "constructor" },
      { channel: "wall", responses: {} },
    );

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("reads responses as they stand when the pass runs", () => {
    const world = makeWorld();
    const first = world.actor(0, 0, 0);
    const collider = world.collider(first, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
    });
    const second = world.actor(0.5, 0, 0);
    world.collider(second, {
      shape: { kind: "sphere", radius: 1 },
      channel: "wall",
    });

    world.system.pass();
    expect(world.events).toEqual([]);

    collider.responses["wall"] = "block";
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("reads the shape as it stands when the pass runs", () => {
    const world = makeWorld();
    const first = world.actor(0, 0, 0);
    const collider = world.collider(first, {
      shape: { kind: "sphere", radius: 0.1 },
      channel: "ball",
      responses: { wall: "block" },
    });
    const second = world.actor(3, 0, 0);
    world.collider(second, {
      shape: { kind: "sphere", radius: 1 },
      channel: "wall",
    });

    world.system.pass();
    expect(world.events).toEqual([]);

    collider.shape = { kind: "sphere", radius: 2.5 };
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });
});

describe("the hit event", () => {
  /** A blocking pair of spheres, the first at `ax`, the second at `bx`. */
  function blocking(ax: number, bx: number) {
    const world = makeWorld();
    const first = world.actor(ax, 0, 0);
    const a = world.collider(first, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { wall: "block" },
    });
    const second = world.actor(bx, 0, 0);
    const b = world.collider(second, {
      shape: { kind: "sphere", radius: 1 },
      channel: "wall",
    });
    return { ...world, first, second, a, b };
  }

  it("reports the lower-id actor first with the colliders in the same order", () => {
    const world = blocking(0, 1.5);

    world.system.pass();

    const hit = onlyHit(world.events);
    expect(hit.a).toBe(world.first);
    expect(hit.b).toBe(world.second);
    expect(hit.colliders).toEqual([world.a, world.b]);
  });

  it("reports the lower-id actor first even when it was enumerated second", () => {
    const world = blocking(0, 1.5);
    // A world is free to hand actors over in any order; the report is stated in
    // terms of the id, so swapping the two must swap the report with them.
    world.first.id = 9;
    world.second.id = 2;

    world.system.pass();

    const hit = onlyHit(world.events);
    expect(hit.a).toBe(world.second);
    expect(hit.b).toBe(world.first);
    expect(hit.colliders).toEqual([world.b, world.a]);
    // Oriented by the report: from the second collider's sphere toward the
    // first's, which is the other way down the axis.
    expectVec3(hit.manifold.normal, v(-1, 0, 0));
  });

  it("carries the sphere-sphere manifold exactly", () => {
    const world = blocking(0, 1.5);

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    expectVec3(manifold.normal, v(1, 0, 0));
    expect(manifold.depth).toBeCloseTo(0.5, 6);
    expectVec3(manifold.point, v(0.75, 0, 0));
  });

  it("emits on every frame the pair persists, with the manifold as it stands", () => {
    const world = blocking(0, 1.5);

    world.system.pass();
    world.second.transform = at(1.2, 0, 0);
    world.system.pass();

    const hits = world.events.filter((e) => e.event === "hit");
    expect(hits).toHaveLength(2);
    expect((hits[0]!.payload as CollisionHitEvent).manifold.depth).toBeCloseTo(
      0.5,
      6,
    );
    expect((hits[1]!.payload as CollisionHitEvent).manifold.depth).toBeCloseTo(
      0.8,
      6,
    );
  });

  it("stops once the shapes separate", () => {
    const world = blocking(0, 1.5);

    world.system.pass();
    world.second.transform = at(9, 0, 0);
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("does not report a pair that merely touches", () => {
    const world = blocking(0, 2);

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("leaves out a destroyed actor at once", () => {
    const world = blocking(0, 1.5);
    world.second.alive = false;

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("leaves out a disabled collider", () => {
    const world = blocking(0, 1.5);
    world.b.enabled = false;

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("never pairs two colliders on the same actor", () => {
    const world = makeWorld();
    const owner = world.actor(0, 0, 0);
    world.collider(owner, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { ball: "block" },
    });
    world.collider(owner, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
    });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("reports pairs in enumeration order: spawn order, then attachment order", () => {
    const world = makeWorld();
    const mover = world.actor(0, 0, 0);
    world.collider(mover, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { wall: "block" },
    });
    const wall = world.actor(0, 0, 0);
    const near = world.collider(wall, {
      shape: { kind: "sphere", radius: 0.5 },
      channel: "wall",
    });
    const far = world.collider(wall, {
      shape: { kind: "sphere", radius: 0.6 },
      channel: "wall",
    });

    world.system.pass();

    const hits = world.events.filter((e) => e.event === "hit");
    expect(hits).toHaveLength(2);
    expect((hits[0]!.payload as CollisionHitEvent).colliders[1]).toBe(near);
    expect((hits[1]!.payload as CollisionHitEvent).colliders[1]).toBe(far);
  });

  it("positions a collider by its offset, so one actor carries several", () => {
    const world = makeWorld();
    const owner = world.actor(0, 0, 0);
    const offsetCollider = world.collider(owner, {
      shape: { kind: "sphere", radius: 0.5 },
      channel: "ball",
      responses: { wall: "block" },
    });
    offsetCollider.offset.position = { x: 4, y: 0, z: 0 };
    const wall = world.actor(4.5, 0, 0);
    world.collider(wall, {
      shape: { kind: "sphere", radius: 0.5 },
      channel: "wall",
    });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    expect(manifold.depth).toBeCloseTo(0.5, 6);
    expectVec3(manifold.normal, v(1, 0, 0));
  });
});

describe("overlap begin and end", () => {
  function overlapping(bx: number) {
    const world = makeWorld();
    const first = world.actor(0, 0, 0);
    const a = world.collider(first, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { goal: "overlap" },
    });
    const second = world.actor(bx, 0, 0);
    const b = world.collider(second, {
      shape: { kind: "sphere", radius: 1 },
      channel: "goal",
    });
    return { ...world, first, second, a, b };
  }

  it("begins on the first frame the pair is found, once", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin"]);
  });

  it("reports the lower-id actor first", () => {
    const world = overlapping(1.5);

    world.system.pass();

    const payload = world.events[0]!.payload;
    expect(payload.a).toBe(world.first);
    expect(payload.b).toBe(world.second);
    expect(payload.colliders).toEqual([world.a, world.b]);
  });

  it("ends on the first frame the pair is no longer found, once", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.second.transform = at(9, 0, 0);
    world.system.pass();
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends with the same actors and colliders it began with", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.second.transform = at(9, 0, 0);
    world.system.pass();

    expect(world.events[1]!.payload).toEqual(world.events[0]!.payload);
  });

  it("ends when either actor is destroyed", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.second.alive = false;
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends when the collider is disabled", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.b.enabled = false;
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("begins again after an end when the pair re-enters", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.second.transform = at(9, 0, 0);
    world.system.pass();
    world.second.transform = at(1.5, 0, 0);
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:end",
      "overlap:begin",
    ]);
  });

  it("emits a frame's begins before its ends", () => {
    const world = overlapping(1.5);
    const late = world.actor(9, 0, 0);
    world.collider(late, {
      shape: { kind: "sphere", radius: 1 },
      channel: "goal",
    });

    world.system.pass();
    world.second.transform = at(20, 0, 0);
    late.transform = at(1.5, 0, 0);
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:begin",
      "overlap:end",
    ]);
  });

  it("ends the overlap and starts hitting when the pair escalates to block", () => {
    const world = overlapping(1.5);

    world.system.pass();
    world.a.responses["goal"] = "block";
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "hit",
      "overlap:end",
    ]);
  });

  it("emits no overlap edges for a blocking pair", () => {
    const world = overlapping(1.5);
    world.a.responses["goal"] = "block";

    world.system.pass();
    world.system.pass();

    expect(names(world.events)).toEqual(["hit", "hit"]);
  });
});

describe("close", () => {
  it("ends every held pair when the world closes", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0, 0);
    world.collider(ball, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { goal: "overlap" },
    });
    for (const x of [0.5, -0.5]) {
      const goal = world.actor(x, 0, 0);
      world.collider(goal, {
        shape: { kind: "sphere", radius: 1 },
        channel: "goal",
      });
    }

    world.system.pass();
    world.system.close();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:begin",
      "overlap:end",
      "overlap:end",
    ]);
  });

  it("is idempotent, and a later pass begins afresh", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0, 0);
    world.collider(ball, {
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses: { goal: "overlap" },
    });
    const goal = world.actor(0.5, 0, 0);
    world.collider(goal, {
      shape: { kind: "sphere", radius: 1 },
      channel: "goal",
    });

    world.system.pass();
    world.system.close();
    world.system.close();
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:end",
      "overlap:begin",
    ]);
  });

  it("does nothing with no held pairs", () => {
    const world = makeWorld();

    world.system.close();

    expect(world.events).toEqual([]);
  });
});

describe("manifold geometry: spheres", () => {
  it("separates two spheres along the line between their centers", () => {
    const manifold = between(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(0, 1.5, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, 1, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
    expectVec3(manifold!.point, v(0, 0.75, 0));
  });

  it("gives concentric spheres a fixed arbitrary normal and the full depth", () => {
    const manifold = between(
      { kind: "sphere", radius: 1 },
      at(3, 3, 3),
      { kind: "sphere", radius: 2 },
      at(3, 3, 3),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(3, 6);
  });

  it("scales a sphere by the largest factor, so a grown actor reaches further", () => {
    const far = at(0, 0, 3);
    expect(
      between(
        { kind: "sphere", radius: 1 },
        at(0, 0, 0),
        { kind: "sphere", radius: 1 },
        far,
      ),
    ).toBeNull();

    const manifold = between(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0, { scale: { x: 1, y: 2.5, z: 1 } }),
      { kind: "sphere", radius: 1 },
      far,
    );

    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
  });
});

describe("manifold geometry: spheres and boxes", () => {
  it("separates a sphere from the closest point of a box it meets face on", () => {
    const manifold = between(
      { kind: "sphere", radius: 1 },
      at(1.5, 0, 0),
      BOX_1,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
    expectVec3(manifold!.point, v(1, 0, 0));
  });

  it("separates a sphere meeting a box's corner along the diagonal", () => {
    const manifold = between(
      { kind: "sphere", radius: 1 },
      at(1.5, 1.5, 1),
      BOX_1,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    const root = Math.SQRT1_2;
    expectVec3(manifold!.normal, v(-root, -root, 0));
    expect(manifold!.depth).toBeCloseTo(1 - Math.hypot(0.5, 0.5), 6);
    expectVec3(manifold!.point, v(1, 1, 1));
  });

  it("reports the box-first order with the normal the other way round", () => {
    const manifold = between(
      BOX_1,
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(1.5, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
    expectVec3(manifold!.point, v(1, 0, 0));
  });

  it("pushes a sphere whose center is inside a box out through the nearest face", () => {
    const manifold = between(
      { kind: "sphere", radius: 0.5 },
      at(1.5, 0, 0),
      { kind: "box", width: 4, height: 4, depth: 4 },
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(1, 6);
    expectVec3(manifold!.point, v(2, 0, 0));
  });

  it("honors rotation: a turned box reaches where an unturned one does not", () => {
    const long: ColliderShape = { kind: "box", width: 4, height: 1, depth: 1 };
    const sphere: ColliderShape = { kind: "sphere", radius: 0.5 };

    expect(between(sphere, at(0, 0, 2.4), long, at(0, 0, 0))).toBeNull();

    const manifold = between(
      sphere,
      at(0, 0, 2.4),
      long,
      at(0, 0, 0, { rotation: turn(UP, 1) }),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, 0, -1));
    expect(manifold!.depth).toBeCloseTo(0.1, 6);
    expectVec3(manifold!.point, v(0, 0, 2));
  });

  it("does not report a sphere resting exactly on a box's face", () => {
    expect(
      between({ kind: "sphere", radius: 1 }, at(0, 2, 0), BOX_1, at(0, 0, 0)),
    ).toBeNull();
  });

  it("scales a box's extents per axis", () => {
    const sphere: ColliderShape = { kind: "sphere", radius: 0.5 };

    expect(between(sphere, at(2.4, 0, 0), BOX_1, at(0, 0, 0))).toBeNull();

    const manifold = between(
      sphere,
      at(2.4, 0, 0),
      BOX_1,
      at(0, 0, 0, { scale: { x: 2, y: 1, z: 1 } }),
    );

    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeCloseTo(0.1, 6);
  });
});

describe("manifold geometry: boxes", () => {
  it("separates two axis-aligned boxes along the axis of least overlap", () => {
    const manifold = between(BOX_1, at(0, 0, 0), BOX_1, at(1.5, 0.2, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
  });

  it("orients the normal from the first box toward the second, whichever moved", () => {
    const manifold = between(BOX_1, at(0, 0, 0), BOX_1, at(0, -1.5, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, -1, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
  });

  it("puts the contact point between the two deepest corners", () => {
    const manifold = between(BOX_1, at(0, 0, 0), BOX_1, at(1.5, 0, 0));

    expect(manifold).not.toBeNull();
    // The support of the first along +X against the support of the second along
    // -X: their midpoint sits on the shared face.
    expect(manifold!.point.x).toBeCloseTo(0.75, 6);
  });

  it("finds the edge-edge axis a turned box presents", () => {
    // Turned an eighth turn about Y, the box's corner reaches √2 along X, so a
    // gap an unturned pair clears is one the turned pair does not.
    const gap = at(2.2, 0, 0);
    expect(between(BOX_1, at(0, 0, 0), BOX_1, gap)).toBeNull();

    const manifold = between(
      BOX_1,
      at(0, 0, 0, { rotation: quatFromAxisAngle(UP, Math.PI / 4) }),
      BOX_1,
      gap,
    );

    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeCloseTo(Math.SQRT2 + 1 - 2.2, 6);
    expectVec3(manifold!.normal, v(1, 0, 0));
  });

  it("does not report two boxes sharing a face", () => {
    expect(between(BOX_1, at(0, 0, 0), BOX_1, at(2, 0, 0))).toBeNull();
  });

  it("survives a negative scale, which mirrors a box onto itself", () => {
    const manifold = between(
      BOX_1,
      at(0, 0, 0, { scale: { x: -1, y: -1, z: -1 } }),
      BOX_1,
      at(1.5, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
  });
});

describe("manifold geometry: capsules", () => {
  const CAPSULE: ColliderShape = { kind: "capsule", radius: 0.5, height: 2 };

  it("separates a sphere from a capsule along the line to its core", () => {
    const manifold = between(
      { kind: "sphere", radius: 0.5 },
      at(0.4, 0.5, 0),
      CAPSULE,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.6, 6);
    expectVec3(manifold!.point, v(0.2, 0.5, 0));
  });

  it("reads a capsule's cap as a sphere beyond the core's end", () => {
    const manifold = between(
      { kind: "sphere", radius: 0.5 },
      at(0, 1.8, 0),
      CAPSULE,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, -1, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
  });

  it("separates two parallel capsules perpendicular to their axes", () => {
    const manifold = between(CAPSULE, at(0, 0, 0), CAPSULE, at(0.8, 0, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
  });

  it("separates two crossed capsules along the line between their cores", () => {
    const manifold = between(
      CAPSULE,
      at(0, 0, 0),
      CAPSULE,
      at(0, 0, 0.8, { rotation: turn(v(0, 0, 1), 1) }),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, 0, 1));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
    expectVec3(manifold!.point, v(0, 0, 0.4));
  });

  it("gives two capsules sharing a core the concentric fallback", () => {
    const manifold = between(CAPSULE, at(0, 0, 0), CAPSULE, at(0, 0, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(1, 6);
  });

  it("stands a capsule along its actor's local up, and lays it down when turned", () => {
    const sphere: ColliderShape = { kind: "sphere", radius: 0.2 };
    const reach = at(1.1, 0, 0);

    expect(between(sphere, reach, CAPSULE, at(0, 0, 0))).toBeNull();

    const manifold = between(
      sphere,
      reach,
      CAPSULE,
      at(0, 0, 0, { rotation: turn(v(0, 0, 1), 1) }),
    );

    expect(manifold).not.toBeNull();
    expect(manifold!.depth).toBeCloseTo(0.6, 6);
  });

  it("does not report a capsule and a sphere that merely touch", () => {
    expect(
      between(
        { kind: "sphere", radius: 0.5 },
        at(1, 0, 0),
        CAPSULE,
        at(0, 0, 0),
      ),
    ).toBeNull();
  });
});

describe("manifold geometry: capsules and boxes", () => {
  const CAPSULE: ColliderShape = { kind: "capsule", radius: 0.5, height: 2 };

  it("separates a capsule standing beside a box along the face it leans on", () => {
    const manifold = between(CAPSULE, at(1.3, 0, 0), BOX_1, at(0, 0, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
    // The core lies flat against the face, so the contact is its middle rather
    // than whichever end was measured first.
    expectVec3(manifold!.point, v(1, 0, 0));
  });

  it("separates a capsule resting on a box through its lower cap", () => {
    const manifold = between(CAPSULE, at(0, 2.3, 0), BOX_1, at(0, 0, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, -1, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
    expectVec3(manifold!.point, v(0, 1, 0));
  });

  it("reports the box-first order with the normal the other way round", () => {
    const manifold = between(BOX_1, at(0, 0, 0), CAPSULE, at(1.3, 0, 0));

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
  });

  it("pushes a capsule whose core has entered the box out the shortest way", () => {
    const manifold = between(CAPSULE, at(0.6, 0, 0), BOX_1, at(0, 0, 0));

    expect(manifold).not.toBeNull();
    // The core spans the box's whole height, so the way out is sideways: the
    // capsule reaches x = 1.1 and the box x = -1, which is 0.9 of overlap.
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.9, 6);
  });

  it("separates a capsule lying through a box along its shortest side", () => {
    const flat: ColliderShape = { kind: "box", width: 6, height: 1, depth: 6 };
    const manifold = between(
      CAPSULE,
      at(0, 0.2, 0, { rotation: turn(v(0, 0, 1), 1) }),
      flat,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    // Lying along X inside a wide slab, the capsule leaves through the top.
    expectVec3(manifold!.normal, v(0, -1, 0));
    expect(manifold!.depth).toBeCloseTo(0.8, 6);
  });

  it("does not report a capsule resting exactly on a box's face", () => {
    expect(between(CAPSULE, at(0, 2.5, 0), BOX_1, at(0, 0, 0))).toBeNull();
  });

  it("honors a box's rotation against a capsule", () => {
    const wall: ColliderShape = {
      kind: "box",
      width: 0.5,
      height: 4,
      depth: 4,
    };
    const stand = at(2.3, 0, 0);

    expect(between(CAPSULE, stand, wall, at(0, 0, 0))).toBeNull();

    const manifold = between(
      CAPSULE,
      stand,
      wall,
      at(0, 0, 0, { rotation: turn(UP, 1) }),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.2, 6);
    expectVec3(manifold!.point, v(2, 0, 0));
  });
});

describe("degenerate shapes", () => {
  it("give a sphere of no radius no part in the pass", () => {
    expect(
      between({ kind: "sphere", radius: 0 }, at(0, 0, 0), BOX_1, at(0, 0, 0)),
    ).toBeNull();
  });

  it("give a box with a zero side no part in the pass", () => {
    expect(
      between(
        { kind: "sphere", radius: 1 },
        at(0, 0, 0),
        { kind: "box", width: 2, height: 0, depth: 2 },
        at(0, 0, 0),
      ),
    ).toBeNull();
  });

  it("give a capsule of no radius no part in the pass", () => {
    expect(
      between(
        { kind: "capsule", radius: 0, height: 2 },
        at(0, 0, 0),
        BOX_1,
        at(0, 0, 0),
      ),
    ).toBeNull();
  });

  it("keep a capsule of no height, which is a sphere, in it", () => {
    const manifold = between(
      { kind: "capsule", radius: 1, height: 0 },
      at(0, 1.5, 0),
      { kind: "sphere", radius: 1 },
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(0, -1, 0));
    expect(manifold!.depth).toBeCloseTo(0.5, 6);
  });

  it("take a shape scaled to nothing out of the pass", () => {
    expect(
      between(
        { kind: "sphere", radius: 1 },
        at(0, 0, 0, { scale: { x: 0, y: 0, z: 0 } }),
        BOX_1,
        at(0, 0, 0),
      ),
    ).toBeNull();
  });
});

describe("CollisionWorld.overlaps", () => {
  function scene() {
    const world = makeWorld();
    const player = world.actor(0, 0, 0);
    world.collider(player, {
      shape: { kind: "sphere", radius: 1 },
      channel: "player",
      responses: { water: "overlap", wall: "block" },
    });
    const water = world.actor(1, 0, 0);
    const waterCollider = world.collider(water, {
      shape: BOX_1,
      channel: "water",
    });
    const sky = world.actor(1, 0, 0);
    world.collider(sky, { shape: BOX_1, channel: "sky" });
    return { ...world, player, water, waterCollider, sky };
  }

  it("returns the colliders intersecting one of the actor's, with their owners", () => {
    const world = scene();

    const found = world.system.overlaps(world.player as unknown as Actor);

    expect(found).toHaveLength(1);
    expect(found[0]!.actor).toBe(world.water);
    expect(found[0]!.collider).toBe(world.waterCollider);
  });

  it("includes a blocking pair as well as an overlapping one", () => {
    const world = scene();
    const wall = world.actor(0.5, 0, 0);
    world.collider(wall, { shape: BOX_1, channel: "wall" });

    const found = world.system.overlaps(world.player as unknown as Actor);

    expect(found).toHaveLength(2);
    expect(found[1]!.actor).toBe(wall);
  });

  it("applies the both-directions rule, leaving ignored pairs out", () => {
    const world = scene();

    expect(world.system.overlaps(world.sky as unknown as Actor)).toEqual([]);
  });

  it("is answered from the colliders as they stand, not from the last pass", () => {
    const world = scene();
    world.system.pass();
    world.water.transform = at(50, 0, 0);

    expect(world.system.overlaps(world.player as unknown as Actor)).toEqual([]);
  });

  it("reports a collider touching two of the actor's colliders once", () => {
    const world = makeWorld();
    const player = world.actor(0, 0, 0);
    for (const x of [-0.2, 0.2]) {
      const collider = world.collider(player, {
        shape: { kind: "sphere", radius: 1 },
        channel: "player",
        responses: { water: "overlap" },
      });
      collider.offset.position = { x, y: 0, z: 0 };
    }
    const water = world.actor(0, 0, 0);
    world.collider(water, { shape: BOX_1, channel: "water" });

    expect(world.system.overlaps(player as unknown as Actor)).toHaveLength(1);
  });

  it("never reports the actor's own colliders", () => {
    const world = makeWorld();
    const player = world.actor(0, 0, 0);
    world.collider(player, {
      shape: { kind: "sphere", radius: 1 },
      channel: "player",
      responses: { player: "overlap" },
    });
    world.collider(player, {
      shape: { kind: "sphere", radius: 1 },
      channel: "player",
    });

    expect(world.system.overlaps(player as unknown as Actor)).toEqual([]);
  });

  it("answers empty for a destroyed actor, and leaves destroyed owners out", () => {
    const world = scene();

    world.water.alive = false;
    expect(world.system.overlaps(world.player as unknown as Actor)).toEqual([]);

    world.player.alive = false;
    expect(world.system.overlaps(world.player as unknown as Actor)).toEqual([]);
  });

  it("leaves out a disabled collider on either side", () => {
    const world = scene();
    world.waterCollider.enabled = false;

    expect(world.system.overlaps(world.player as unknown as Actor)).toEqual([]);
  });
});

describe("CollisionWorld.query", () => {
  function scene() {
    const world = makeWorld();
    const near = world.actor(0, 0, 0);
    const nearCollider = world.collider(near, {
      shape: { kind: "sphere", radius: 1 },
      channel: "enemy",
    });
    const far = world.actor(20, 0, 0);
    world.collider(far, {
      shape: { kind: "sphere", radius: 1 },
      channel: "enemy",
    });
    return { ...world, near, far, nearCollider };
  }

  it("finds what the shape would touch placed at a point", () => {
    const world = scene();

    const found = world.system.query(
      { kind: "sphere", radius: 2 },
      v(2.5, 0, 0),
      QUAT_IDENTITY,
      { channel: "blast", responses: { enemy: "overlap" } },
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.actor).toBe(world.near);
    expect(found[0]!.collider).toBe(world.nearCollider);
  });

  it("turns the queried shape by the rotation it is given", () => {
    const world = scene();
    const bar: ColliderShape = { kind: "box", width: 8, height: 1, depth: 1 };

    expect(
      world.system.query(bar, v(0, 0, 3.4), QUAT_IDENTITY, {
        channel: "blast",
        responses: { enemy: "overlap" },
      }),
    ).toEqual([]);

    expect(
      world.system.query(bar, v(0, 0, 3.4), turn(UP, 1), {
        channel: "blast",
        responses: { enemy: "overlap" },
      }),
    ).toHaveLength(1);
  });

  it("leaves the shape unrotated when no rotation is given", () => {
    const world = scene();

    const found = world.system.query(
      { kind: "box", width: 8, height: 1, depth: 1 },
      v(3.4, 0, 0),
      undefined,
      { channel: "blast", responses: { enemy: "overlap" } },
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.actor).toBe(world.near);
  });

  it('defaults to the "default" channel with no responses of its own', () => {
    const world = makeWorld();
    const target = world.actor(0, 0, 0);
    world.collider(target, {
      shape: { kind: "sphere", radius: 1 },
      channel: "enemy",
      responses: { default: "overlap" },
    });

    expect(
      world.system.query({ kind: "sphere", radius: 1 }, v(0.5, 0, 0)),
    ).toHaveLength(1);
  });

  it("leaves out every collider owned by an ignored actor", () => {
    const world = scene();

    expect(
      world.system.query(
        { kind: "sphere", radius: 2 },
        v(0, 0, 0),
        QUAT_IDENTITY,
        {
          channel: "blast",
          responses: { enemy: "overlap" },
          ignore: [world.near as unknown as Actor],
        },
      ),
    ).toEqual([]);
  });

  it("includes pairs the resolution leaves at block as well as overlap", () => {
    const world = scene();

    expect(
      world.system.query(
        { kind: "sphere", radius: 2 },
        v(0, 0, 0),
        QUAT_IDENTITY,
        {
          channel: "blast",
          responses: { enemy: "block" },
        },
      ),
    ).toHaveLength(1);
  });

  it("answers empty for a degenerate query shape", () => {
    const world = scene();

    expect(
      world.system.query(
        { kind: "sphere", radius: 0 },
        v(0, 0, 0),
        QUAT_IDENTITY,
        {
          channel: "blast",
          responses: { enemy: "overlap" },
        },
      ),
    ).toEqual([]);
  });

  it("places the queried shape at unit scale, whatever the world holds", () => {
    const world = makeWorld();
    const grown = world.actor(0, 0, 0);
    grown.transform = at(0, 0, 0, { scale: { x: 10, y: 10, z: 10 } });
    world.collider(grown, {
      shape: { kind: "sphere", radius: 1 },
      channel: "enemy",
    });

    // The collider is grown to a radius of ten; the query's own radius of one
    // is exactly one world unit and reaches the grown sphere from 10.5 away.
    expect(
      world.system.query(
        { kind: "sphere", radius: 1 },
        v(10.5, 0, 0),
        QUAT_IDENTITY,
        {
          channel: "blast",
          responses: { enemy: "overlap" },
        },
      ),
    ).toHaveLength(1);
  });
});

describe("CollisionWorld.raycast", () => {
  const OPTIONS = {
    channel: "vision",
    responses: { target: "block" },
  } as const;

  function scene() {
    const world = makeWorld();
    function target(shape: ColliderShape, transform: Transform) {
      const owner = world.actor();
      owner.transform = transform;
      const collider = world.collider(owner, { shape, channel: "target" });
      return { owner, collider };
    }
    return { ...world, target };
  }

  it("returns the nearest hit, so a wall answers before what is behind it", () => {
    const world = scene();
    const behind = world.target({ kind: "sphere", radius: 1 }, at(6, 0, 0));
    const near = world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));

    const hit = world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(near.owner);
    expect(hit!.collider).toBe(near.collider);
    expect(hit!.distance).toBeCloseTo(4, 6);
    expect(behind.owner.id).toBe(1);
  });

  it("carries a sphere's surface point and normal", () => {
    const world = scene();
    world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));

    const hit = world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expectVec3(hit!.point, v(-1, 0, 0));
    expectVec3(hit!.normal, v(-1, 0, 0));
  });

  it("carries a box face's normal, and honors the box's rotation", () => {
    const world = scene();
    const { collider } = world.target(
      { kind: "box", width: 2, height: 2, depth: 6 },
      at(0, 0, 0),
    );

    const straight = world.system.raycast(
      v(0, 0, -8),
      v(0, 0, 1),
      100,
      OPTIONS,
    );
    expect(straight).not.toBeNull();
    expect(straight!.distance).toBeCloseTo(5, 6);
    expectVec3(straight!.normal, v(0, 0, -1));

    collider.actor.transform.rotation = turn(UP, 1);
    const turned = world.system.raycast(v(0, 0, -8), v(0, 0, 1), 100, OPTIONS);
    expect(turned).not.toBeNull();
    expect(turned!.distance).toBeCloseTo(7, 6);
    expectVec3(turned!.normal, v(0, 0, -1));
  });

  it("carries a capsule's cylindrical normal, running out from its core", () => {
    const world = scene();
    world.target({ kind: "capsule", radius: 0.5, height: 2 }, at(0, 0.4, 0));

    const hit = world.system.raycast(v(-5, 0.4, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4.5, 6);
    expectVec3(hit!.point, v(-0.5, 0.4, 0));
    expectVec3(hit!.normal, v(-1, 0, 0));
  });

  it("carries a capsule's cap normal for a ray down its own axis", () => {
    const world = scene();
    world.target({ kind: "capsule", radius: 0.5, height: 2 }, at(0, 0, 0));

    const hit = world.system.raycast(v(0, 5, 0), v(0, -1, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(3.5, 6);
    expectVec3(hit!.point, v(0, 1.5, 0));
    expectVec3(hit!.normal, v(0, 1, 0));
  });

  it("meets a capsule's cap rather than the far wall of its cylinder", () => {
    const world = scene();
    world.target({ kind: "capsule", radius: 0.5, height: 2 }, at(0, 0, 0));

    const hit = world.system.raycast(v(0, 1.4, -5), v(0, 0, 1), 100, OPTIONS);

    expect(hit).not.toBeNull();
    // 1.4 is above the core's end at 1, so the meeting is on the upper
    // hemisphere: √(0.25 − 0.16) back from the cap's center.
    expect(hit!.distance).toBeCloseTo(5 - Math.sqrt(0.25 - 0.16), 6);
    expect(hit!.point.y).toBeCloseTo(1.4, 6);
  });

  it("is bounded by distance", () => {
    const world = scene();
    world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));

    expect(
      world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 3, OPTIONS),
    ).toBeNull();
    expect(
      world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 4, OPTIONS),
    ).not.toBeNull();
  });

  it("passes through colliders the resolution ignores", () => {
    const world = scene();
    world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));
    const seen = world.actor(6, 0, 0);
    world.collider(seen, {
      shape: { kind: "sphere", radius: 1 },
      channel: "glass",
    });

    const hit = world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 100, {
      channel: "vision",
      responses: { glass: "block" },
    });

    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(seen);
  });

  it("skips every collider owned by an ignored actor", () => {
    const world = scene();
    const self = world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));
    const other = world.target({ kind: "sphere", radius: 1 }, at(6, 0, 0));

    const hit = world.system.raycast(v(-5, 0, 0), v(1, 0, 0), 100, {
      ...OPTIONS,
      ignore: [self.owner as unknown as Actor],
    });

    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(other.owner);
  });

  it("reports a ray that starts inside a shape at distance zero, facing back", () => {
    const world = scene();
    world.target({ kind: "sphere", radius: 2 }, at(0, 0, 0));

    const hit = world.system.raycast(v(0, 0, 0), v(0, 0, 1), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBe(0);
    expectVec3(hit!.point, v(0, 0, 0));
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("reports a ray starting inside a box the same way", () => {
    const world = scene();
    world.target({ kind: "box", width: 4, height: 4, depth: 4 }, at(0, 0, 0));

    const hit = world.system.raycast(v(0.5, 0, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBe(0);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("reports a ray starting inside a capsule the same way", () => {
    const world = scene();
    world.target({ kind: "capsule", radius: 1, height: 2 }, at(0, 0, 0));

    const hit = world.system.raycast(v(0, 0.5, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBe(0);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("misses a shape behind the origin, and returns null on nothing", () => {
    const world = scene();
    world.target({ kind: "sphere", radius: 1 }, at(0, 0, 0));

    expect(
      world.system.raycast(v(5, 0, 0), v(1, 0, 0), 100, OPTIONS),
    ).toBeNull();
    expect(
      world.system.raycast(v(0, 9, 0), v(1, 0, 0), 100, OPTIONS),
    ).toBeNull();
  });

  it("misses a box the ray runs alongside", () => {
    const world = scene();
    world.target(BOX_1, at(0, 0, 0));

    expect(
      world.system.raycast(v(-5, 4, 0), v(1, 0, 0), 100, OPTIONS),
    ).toBeNull();
  });
});

describe("CollisionWorld.raycastAll", () => {
  const OPTIONS = {
    channel: "vision",
    responses: { target: "block" },
  } as const;

  function scene(...xs: number[]) {
    const world = makeWorld();
    const owners = xs.map((x) => {
      const owner = world.actor(x, 0, 0);
      world.collider(owner, {
        shape: { kind: "sphere", radius: 1 },
        channel: "target",
      });
      return owner;
    });
    return { ...world, owners };
  }

  it("returns every hit in increasing distance, each at its own entry point", () => {
    const world = scene(6, 0, 3);

    const hits = world.system.raycastAll(v(-5, 0, 0), v(1, 0, 0), 100, OPTIONS);

    expect(hits.map((hit) => hit.actor)).toEqual([
      world.owners[1],
      world.owners[2],
      world.owners[0],
    ]);
    expect(hits.map((hit) => hit.distance)).toEqual([4, 7, 10]);
    expectVec3(hits[1]!.point, v(2, 0, 0));
  });

  it("applies the same filter and bound a raycast does", () => {
    const world = scene(0, 3, 6);

    expect(
      world.system.raycastAll(v(-5, 0, 0), v(1, 0, 0), 8, OPTIONS),
    ).toHaveLength(2);
    expect(
      world.system.raycastAll(v(-5, 0, 0), v(1, 0, 0), 100, {
        channel: "vision",
      }),
    ).toEqual([]);
  });

  it("returns empty when the ray meets nothing", () => {
    const world = scene(0);

    expect(
      world.system.raycastAll(v(0, 9, 0), v(1, 0, 0), 100, OPTIONS),
    ).toEqual([]);
  });
});

describe("the usage page's collision matrix", () => {
  /** The ball, the wall, and the goal, wired exactly as the usage page does. */
  function match() {
    const world = makeWorld();
    const ball = world.actor(0, 0, 0);
    world.collider(ball, {
      shape: { kind: "sphere", radius: 0.5 },
      channel: "ball",
      responses: { wall: "block", paddle: "block", goal: "overlap" },
    });
    const wall = world.actor(0, 0, -4);
    world.collider(wall, {
      shape: { kind: "box", width: 8, height: 4, depth: 0.5 },
      channel: "wall",
    });
    const goal = world.actor(0, 0, 4);
    world.collider(goal, {
      shape: { kind: "box", width: 3, height: 3, depth: 1 },
      channel: "goal",
    });
    return { ...world, ball, wall, goal };
  }

  it("blocks the ball against the wall and overlaps it with the goal", () => {
    const world = match();

    world.ball.transform = at(0, 0, -3.5);
    world.system.pass();
    expect(names(world.events)).toEqual(["hit"]);
    const { manifold } = onlyHit(world.events);
    // The ball is reported first — it spawned first — and the wall lies behind
    // it, so the smallest translation pushes the ball back along +Z.
    expectVec3(manifold.normal, v(0, 0, -1));
    expect(manifold.depth).toBeCloseTo(0.25, 6);
    expectVec3(manifold.point, v(0, 0, -3.75));

    world.ball.transform = at(0, 0, 3.9);
    world.system.pass();
    expect(names(world.events)).toEqual(["hit", "overlap:begin"]);

    world.ball.transform = at(0, 0, 0);
    world.system.pass();
    expect(names(world.events)).toEqual([
      "hit",
      "overlap:begin",
      "overlap:end",
    ]);
  });

  it("never reports the wall against the goal, which name each other nowhere", () => {
    const world = match();
    world.ball.alive = false;

    world.system.pass();

    expect(world.events).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * `first` moved by `by`, which is how the checks below apply the response the
 * engine deliberately does not: a manifold is only worth what a game gets from
 * acting on it.
 */
function movedBy(transform: Transform, by: Vec3): Transform {
  return at(
    transform.position.x + by.x,
    transform.position.y + by.y,
    transform.position.z + by.z,
    { rotation: transform.rotation, scale: transform.scale },
  );
}

/**
 * Whether the pair has come apart once the first collider has taken
 * `factor` of the reported translation — `-normal * depth`, the push-out the
 * usage page writes into every `hit` handler.
 */
function pushedApart(
  manifold: Manifold,
  factor: number,
  first: ColliderShape,
  firstAt: Transform,
  second: ColliderShape,
  secondAt: Transform,
): boolean {
  const travel = manifold.depth * factor;
  const moved = movedBy(firstAt, {
    x: -manifold.normal.x * travel,
    y: -manifold.normal.y * travel,
    z: -manifold.normal.z * travel,
  });
  return between(first, moved, second, secondAt) === null;
}

/**
 * The manifold's whole promise, asserted end to end: the normal is a unit
 * vector, taking the reported translation separates the pair, and taking nine
 * tenths of it does not — so the depth is neither short of what a response
 * needs nor padded beyond the least it could be.
 *
 * A hair past the depth rather than exactly it, because a pair left exactly
 * touching is on the boundary the strict narrow phase draws, and a check
 * standing on that boundary would be measuring rounding rather than geometry.
 */
function expectSeparation(
  first: ColliderShape,
  firstAt: Transform,
  second: ColliderShape,
  secondAt: Transform,
): Manifold {
  const manifold = between(first, firstAt, second, secondAt);
  expect(manifold).not.toBeNull();
  expect(
    Math.hypot(manifold!.normal.x, manifold!.normal.y, manifold!.normal.z),
  ).toBeCloseTo(1, 9);
  expect(manifold!.depth).toBeGreaterThan(0);
  expect(
    pushedApart(manifold!, 1.000001, first, firstAt, second, secondAt),
  ).toBe(true);
  expect(pushedApart(manifold!, 0.9, first, firstAt, second, secondAt)).toBe(
    false,
  );
  return manifold!;
}

describe("what a manifold promises", () => {
  const CAPSULE: ColliderShape = { kind: "capsule", radius: 0.5, height: 2 };

  it("separates two spheres met along a diagonal", () => {
    const manifold = expectSeparation(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(1, 1, 1),
    );

    expect(manifold.depth).toBeCloseTo(2 - Math.sqrt(3), 6);
  });

  it("separates a sphere caught on a box's corner", () => {
    expectSeparation(
      { kind: "sphere", radius: 1 },
      at(1.4, 1.4, 1.4),
      BOX_1,
      at(0, 0, 0),
    );
  });

  it("separates a sphere sunk inside a box", () => {
    expectSeparation(
      { kind: "sphere", radius: 0.5 },
      at(1.5, 0, 0),
      { kind: "box", width: 4, height: 4, depth: 4 },
      at(0, 0, 0),
    );
  });

  it("separates a pair of boxes turned about different axes", () => {
    // No closed form worth writing out; what the pair must satisfy is that the
    // reported translation is the shortest one that pulls them apart, which is
    // exactly what the fifteen-axis search claims to find.
    expectSeparation(
      BOX_1,
      at(0, 0, 0, { rotation: quatFromAxisAngle(UP, Math.PI / 5) }),
      BOX_1,
      at(1.9, 0.4, 0.3, {
        rotation: quatFromAxisAngle(v(1, 0, 0), Math.PI / 3),
      }),
    );
  });

  it("separates two crossed capsules", () => {
    expectSeparation(
      CAPSULE,
      at(0, 0, 0),
      CAPSULE,
      at(0, 0.9, 0.8, { rotation: turn(v(0, 0, 1), 1) }),
    );
  });

  it("separates a sphere sitting on a capsule's own axis", () => {
    // The reduction that answers a capsule — the closest point of its core
    // carries a ball — has nothing left to say when the sphere's center is on
    // the core: the two balls are concentric. Along the axis is the one family
    // of directions that separates nothing, since it slides the sphere down the
    // capsule's length and leaves the core exactly as close as it was.
    const manifold = expectSeparation(
      { kind: "sphere", radius: 0.5 },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.4, height: 2 },
      at(0, 0, 0, { rotation: turn(v(0, 0, 1), 1) }),
    );

    expect(manifold.depth).toBeCloseTo(0.9, 9);
    // The capsule lies along world X, so the normal has no share of it.
    expect(Math.abs(manifold.normal.x)).toBeLessThan(1e-9);
  });

  it("separates two capsules whose cores cross at a shared point", () => {
    const manifold = expectSeparation(
      { kind: "capsule", radius: 0.4, height: 2 },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.4, height: 2 },
      at(0, 0, 0, { rotation: turn(v(0, 0, 1), 1) }),
    );

    expect(manifold.depth).toBeCloseTo(0.8, 9);
    // One core along Y and one along X leave only Z to come apart along.
    expectVec3(
      v(Math.abs(manifold.normal.x), Math.abs(manifold.normal.y), 0),
      v(0, 0, 0),
      9,
    );
    expect(Math.abs(manifold.normal.z)).toBeCloseTo(1, 9);
  });

  it("separates two capsules laid along one line", () => {
    // Parallel cores have no common perpendicular of their own — their cross
    // product is no direction — and any direction across the shared axis
    // separates them.
    const manifold = expectSeparation(
      { kind: "capsule", radius: 0.4, height: 2 },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.4, height: 2 },
      at(0, 0.5, 0),
    );

    expect(manifold.depth).toBeCloseTo(0.8, 9);
    expect(Math.abs(manifold.normal.y)).toBeLessThan(1e-9);
  });

  it("separates a capsule standing against a box", () => {
    expectSeparation(CAPSULE, at(1.3, 0, 0), BOX_1, at(0, 0, 0));
  });

  it("separates a capsule whose core has entered the box", () => {
    // The branch that has no line between the volumes to measure, and so the
    // one whose depth is worth checking against the world rather than against
    // a hand computation of the same formula.
    expectSeparation(CAPSULE, at(0.6, 0, 0), BOX_1, at(0, 0, 0));
  });

  it("separates a capsule driven clean through a box", () => {
    expectSeparation(
      { kind: "capsule", radius: 0.3, height: 4 },
      at(0, 0, 0),
      BOX_1,
      at(0, 0, 0),
    );
  });
});

describe("the contact point of a capsule inside a box", () => {
  it("lies between the capsule's surface and the face it leaves through", () => {
    const manifold = between(
      { kind: "capsule", radius: 0.5, height: 2 },
      at(0.6, 0, 0),
      BOX_1,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    // The capsule's deepest surface point is at x = 0.1 and the face it leaves
    // through at x = 1, so the contact is halfway between them — on the core's
    // own plane, not at a corner of the box the pair never met.
    expectVec3(manifold!.point, v(0.55, 0, 0));
  });

  it("stays on the middle of a core that lies equally deep along the face", () => {
    const manifold = between(
      { kind: "capsule", radius: 0.3, height: 4 },
      at(0, 0, 0),
      BOX_1,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(1, 0, 0));
    expectVec3(manifold!.point, v(-0.35, 0, 0));
  });

  it("follows the deeper end of a tilted core", () => {
    const manifold = between(
      { kind: "capsule", radius: 0.3, height: 1 },
      at(0.6, 0, 0, { rotation: quatFromAxisAngle(v(0, 0, 1), Math.PI / 6) }),
      BOX_1,
      at(0, 0, 0),
    );

    expect(manifold).not.toBeNull();
    expectVec3(manifold!.normal, v(-1, 0, 0));
    expect(manifold!.depth).toBeCloseTo(0.95, 6);
    // The core's upper end sits deepest into the box, so the contact tracks it
    // rather than the core's middle.
    expectVec3(manifold!.point, v(0.525, Math.sqrt(3) / 4, 0));
  });
});
