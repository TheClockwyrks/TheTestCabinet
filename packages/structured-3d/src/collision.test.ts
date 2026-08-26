import { describe, expect, it } from "vitest";
import type { Transform, Vec3 } from "./math";
import { quatFromAxisAngle } from "./math";
import { Actor, attachActorToWorld } from "./actors";
import type { World } from "./worlds";
import type { Shape3 } from "./components";
import type { CollisionEventMap, Manifold } from "./collision";
import { ColliderComponent, CollisionSystem } from "./collision";

/**
 * The collision module in isolation: response resolution, the six pair kinds'
 * manifolds, the pass's events and exclusions, and the query surface — over
 * real actors carrying real colliders, with every manifold expectation derived
 * by hand in the comments so a wrong number is caught as arithmetic, not taken
 * on faith from the implementation. Where the pass sits in the frame (after
 * ticks and timers, before the game mode) and how a paused world skips it
 * belong to the engine and world suites; this suite only checks that `pass()`
 * itself does what one run of the pass is documented to do.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The identity rotation, spelled out where a fixture needs one. */
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** A transform at `(x, y, z)` with identity rotation and unit scale. */
function at(x: number, y: number, z: number): Transform {
  return {
    position: { x, y, z },
    rotation: { ...IDENTITY },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/**
 * The world actors are wired into. Collision reads an actor's id, liveness,
 * transform, and components and never its world, so a bare object standing in
 * for the type is all `attachActorToWorld` needs to hand out an id — the world
 * itself is the world suite's subject.
 */
const WORLD = {} as World;

/**
 * A real {@link Actor} with an explicit `id` and placement, because the
 * lower-id rule is about ids and these tests hand them out directly rather
 * than driving a level build to assign them in spawn order.
 *
 * The transform's fields are written over the actor's own record rather than
 * replacing it, because `transform` is the actor's readonly backing value and
 * the colliders attached below compose against exactly that object.
 */
function actor(id: number, transform: Transform = at(0, 0, 0)): Actor {
  const made = new Actor();
  attachActorToWorld(made, WORLD, id);
  made.transform.position = transform.position;
  made.transform.rotation = transform.rotation;
  made.transform.scale = transform.scale;
  return made;
}

/** One emitted event with its payload, the discriminated union of the three. */
type Logged = {
  [K in keyof CollisionEventMap]: { event: K; payload: CollisionEventMap[K] };
}[keyof CollisionEventMap];

/** A system over the given actors, logging every event it emits in order. */
function makeSystem(actors: readonly Actor[]): {
  system: CollisionSystem;
  log: Logged[];
} {
  const log: Logged[] = [];
  const system = new CollisionSystem({
    actors: () => actors,
    emit: (event, payload) => {
      log.push({ event, payload } as Logged);
    },
  });
  return { system, log };
}

/** The `hit` payloads out of the log, in emission order. */
function hits(log: readonly Logged[]): CollisionEventMap["hit"][] {
  return log.flatMap((entry) => (entry.event === "hit" ? [entry.payload] : []));
}

/** The event names alone, for order assertions. */
function names(log: readonly Logged[]): string[] {
  return log.map((entry) => entry.event);
}

/**
 * Runs one pass over two blocking colliders — actor 1 carrying `aShape` at
 * `aTransform`, actor 2 carrying `bShape` at `bTransform` — and returns the
 * manifold reported, or `null` when no hit was emitted. The manifold arrives
 * oriented lower-id-first, from `colliders[0]` toward `colliders[1]`, which is
 * what every hand-derived expectation below is written in.
 */
function pairManifold(
  aShape: Shape3,
  aTransform: Transform,
  bShape: Shape3,
  bTransform: Transform,
): Manifold | null {
  const a = actor(1, aTransform);
  const b = actor(2, bTransform);
  a.attach(
    new ColliderComponent({ shape: aShape, responses: { default: "block" } }),
  );
  b.attach(new ColliderComponent({ shape: bShape }));
  const { system, log } = makeSystem([a, b]);
  system.pass();
  const found = hits(log);
  return found.length === 1 ? found[0]!.manifold : null;
}

/** Componentwise closeness for a vector, to six places like the 2D suites. */
function expectVec(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
}

/* -------------------------------------------------------------------------- */
/* Response resolution                                                        */
/* -------------------------------------------------------------------------- */

describe("resolving a pair", () => {
  /** Two unit spheres a half unit apart, so every declared pair penetrates. */
  function pair(
    aResponses: ConstructorParameters<typeof ColliderComponent>[0]["responses"],
    bResponses: ConstructorParameters<typeof ColliderComponent>[0]["responses"],
    channels: { a?: string; b?: string } = {},
  ): { log: Logged[] } {
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(1.5, 0, 0));
    a.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        channel: channels.a,
        responses: aResponses,
      }),
    );
    b.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        channel: channels.b,
        responses: bResponses,
      }),
    );
    const { system, log } = makeSystem([a, b]);
    system.pass();
    return { log };
  }

  it("blocks from one side's declaration alone, so scenery stays bare", () => {
    // The wall names no responses and the ball still blocks against it,
    // because the ball answers `wall` with "block".
    const { log } = pair({ wall: "block" }, undefined, {
      a: "ball",
      b: "wall",
    });
    expect(names(log)).toEqual(["hit"]);
  });

  it("takes the stronger of the two answers, block over overlap", () => {
    // The docs' example: a collider on `ball` answering `wall` with "block"
    // against a wall answering `ball` with "overlap" resolves to "block".
    const { log } = pair(
      { wall: "block" },
      { ball: "overlap" },
      { a: "ball", b: "wall" },
    );
    expect(names(log)).toEqual(["hit"]);
  });

  it("takes overlap over ignore", () => {
    const { log } = pair({ default: "overlap" }, { default: "ignore" });
    expect(names(log)).toEqual(["overlap:begin"]);
  });

  it("never tests a pair neither side answers, however deeply they intersect", () => {
    const { log } = pair(undefined, undefined);
    expect(log).toEqual([]);
  });

  it("never tests a pair both sides declare ignore", () => {
    const { log } = pair({ default: "ignore" }, { default: "ignore" });
    expect(log).toEqual([]);
  });

  it("treats a channel named after an Object.prototype member as unlisted", () => {
    // "constructor" is an own-property lookup, not a walk up the prototype
    // chain, so a collider on that channel is ignored rather than answered
    // with a function.
    const { log } = pair(undefined, undefined, {
      a: "constructor",
      b: "constructor",
    });
    expect(log).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* ColliderComponent                                                          */
/* -------------------------------------------------------------------------- */

describe("ColliderComponent", () => {
  it('defaults to the "default" channel and an empty response map', () => {
    const collider = new ColliderComponent({
      shape: { kind: "sphere", radius: 1 },
    });
    expect(collider.channel).toBe("default");
    expect(collider.responses).toEqual({});
  });

  it("copies the responses record, so mutating the argument later changes nothing", () => {
    const responses: Record<string, "block"> = { wall: "block" };
    const collider = new ColliderComponent({
      shape: { kind: "sphere", radius: 1 },
      responses,
    });
    responses["goal"] = "block";
    expect(collider.responses).toEqual({ wall: "block" });
  });
});

/* -------------------------------------------------------------------------- */
/* Manifolds, one pair kind at a time                                         */
/* -------------------------------------------------------------------------- */

describe("the manifold", () => {
  it("separates two spheres along their center line", () => {
    // Radii 2 + 2 = 4, centers 3 apart: depth 1, normal +x from the lower id,
    // point on the axis at aCenter + (aRadius - depth / 2) = 1.5.
    const m = pairManifold(
      { kind: "sphere", radius: 2 },
      at(0, 0, 0),
      { kind: "sphere", radius: 2 },
      at(3, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(1, 6);
    expectVec(m!.point, { x: 1.5, y: 0, z: 0 });
  });

  it("reports the fixed (1, 0, 0) normal for concentric spheres", () => {
    const m = pairManifold(
      { kind: "sphere", radius: 2 },
      at(5, 5, 5),
      { kind: "sphere", radius: 1 },
      at(5, 5, 5),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(3, 6);
  });

  it("does not report a pair exactly touching, which has zero depth", () => {
    // Unit spheres exactly 2 apart share one point and penetrate nowhere.
    const m = pairManifold(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(2, 0, 0),
    );
    expect(m).toBeNull();
  });

  it("separates a sphere outside a box through the closest boundary point", () => {
    // Box half extent 2, sphere center at x = 2.5 with radius 1: closest
    // boundary point (2, 0, 0), gap 0.5, depth 0.5, normal from the sphere
    // toward the box, so -x.
    const m = pairManifold(
      { kind: "sphere", radius: 1 },
      at(2.5, 0, 0),
      { kind: "box", size: { x: 4, y: 4, z: 4 } },
      at(0, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: -1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(0.5, 6);
    expectVec(m!.point, { x: 2, y: 0, z: 0 });
  });

  it("separates a sphere inside a box through the face with least clearance", () => {
    // Center at (1.5, 0, 0) inside a half-2 box: x clearance 0.5 beats y and
    // z at 2, so the sphere leaves through +x; depth is radius plus the
    // clearance, 0.5 + 0.5 = 1, and the sphere-toward-box normal is -x.
    const m = pairManifold(
      { kind: "sphere", radius: 0.5 },
      at(1.5, 0, 0),
      { kind: "box", size: { x: 4, y: 4, z: 4 } },
      at(0, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: -1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(1, 6);
    expectVec(m!.point, { x: 2, y: 0, z: 0 });
  });

  it("separates two axis-aligned boxes along the axis of least overlap", () => {
    // Half-1 boxes 1.5 apart on x: overlap 0.5 on x against 2 on y and z.
    const m = pairManifold(
      { kind: "box", size: { x: 2, y: 2, z: 2 } },
      at(0, 0, 0),
      { kind: "box", size: { x: 2, y: 2, z: 2 } },
      at(1.5, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(0.5, 6);
  });

  it("measures a rotated box by its projection, not its axis-aligned extent", () => {
    // The second box is rotated 45° about z, so its projection radius on x is
    // cos 45° + sin 45° = √2. Overlap on x: 1 + √2 - 2.2 ≈ 0.214, smaller
    // than every other separating axis, so it is the manifold.
    const b = actor(2, {
      position: { x: 2.2, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
      scale: { x: 1, y: 1, z: 1 },
    });
    const a = actor(1, at(0, 0, 0));
    a.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
        responses: { default: "block" },
      }),
    );
    b.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
      }),
    );
    const { system, log } = makeSystem([a, b]);
    system.pass();
    const found = hits(log);
    expect(found).toHaveLength(1);
    expectVec(found[0]!.manifold.normal, { x: 1, y: 0, z: 0 });
    expect(found[0]!.manifold.depth).toBeCloseTo(1 + Math.SQRT2 - 2.2, 6);
  });

  it("reports no hit for oriented boxes whose axis-aligned bounds alone overlap", () => {
    // The rotated box's corners point along the diagonals: at (2.3, 2.3) its
    // axis-aligned bounds reach into the first box's, but the rotated box's
    // own face axis (the diagonal) separates them: distance 2.3·√2 ≈ 3.25
    // against radii 1 + √2 ≈ 2.41.
    const m = pairManifold(
      { kind: "box", size: { x: 2, y: 2, z: 2 } },
      at(0, 0, 0),
      { kind: "box", size: { x: 2, y: 2, z: 2 } },
      {
        position: { x: 2.3, y: 2.3, z: 0 },
        rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
        scale: { x: 1, y: 1, z: 1 },
      },
    );
    expect(m).toBeNull();
  });

  it("collides a sphere with a capsule as a sphere around the nearest axis point", () => {
    // Capsule on the y axis, caps at y = ±2, radius 1; sphere at (1.5, 1, 0)
    // radius 1. Nearest axis point (0, 1, 0), distance 1.5 against radii 2:
    // depth 0.5, sphere-toward-capsule normal -x, point on the center line at
    // sphereCenter + normal · (radius - depth / 2) = (0.75, 1, 0).
    const m = pairManifold(
      { kind: "sphere", radius: 1 },
      at(1.5, 1, 0),
      { kind: "capsule", radius: 1, height: 4 },
      at(0, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: -1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(0.5, 6);
    expectVec(m!.point, { x: 0.75, y: 1, z: 0 });
  });

  it("collides two capsules at the closest points of their axis segments", () => {
    // A vertical capsule (caps ±1 on y, radius 0.5) against a horizontal one
    // along x at height 1.8: closest points (0, 1, 0) and (0, 1.8, 0),
    // distance 0.8 against radii 1, depth 0.2, normal +y.
    const m = pairManifold(
      { kind: "capsule", radius: 0.5, height: 2 },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.5, height: 2 },
      {
        position: { x: 0, y: 1.8, z: 0 },
        rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
        scale: { x: 1, y: 1, z: 1 },
      },
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 0, y: 1, z: 0 });
    expect(m!.depth).toBeCloseTo(0.2, 6);
    expectVec(m!.point, { x: 0, y: 1.4, z: 0 });
  });

  it("rotates a capsule's axis with its actor, which is what makes it oriented", () => {
    // Upright, the capsule's segment is 1.6 from the sphere and out of reach;
    // rotated 90° about z its caps sit at x = ±1, the nearest 0.6 from the
    // sphere's center, inside the combined radius 1: depth 0.4, and the
    // capsule (lower id) pushes out toward the sphere along +x.
    const upright = pairManifold(
      { kind: "capsule", radius: 0.5, height: 2 },
      at(0, 0, 0),
      { kind: "sphere", radius: 0.5 },
      at(1.6, 0, 0),
    );
    expect(upright).toBeNull();

    const m = pairManifold(
      { kind: "capsule", radius: 0.5, height: 2 },
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
        scale: { x: 1, y: 1, z: 1 },
      },
      { kind: "sphere", radius: 0.5 },
      at(1.6, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(0.4, 6);
  });

  it("separates a capsule brushing a box along the line to the closest boundary point", () => {
    // Vertical capsule at x = 1.3, radius 0.5, against a half-1 box: every
    // axis point is 0.3 outside the +x face, depth 0.5 - 0.3 = 0.2, and the
    // box-toward-capsule normal is +x. The flat closest-point profile
    // resolves toward the segment's start, the -y cap, so the reported
    // boundary point is (1, -1, 0).
    const m = pairManifold(
      { kind: "box", size: { x: 2, y: 2, z: 2 } },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.5, height: 2 },
      at(1.3, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(0.2, 6);
    expectVec(m!.point, { x: 1, y: -1, z: 0 });
  });

  it("separates a capsule inside a box through the face nearest its deepest point", () => {
    // Capsule segment from (1.5, -1, 0) to (1.5, 1, 0) wholly inside a
    // half-2 box: the x clearance 0.5 is smallest everywhere along the axis,
    // so the pair separates through the +x face with depth radius plus
    // clearance, 0.5 + 0.5 = 1.
    const m = pairManifold(
      { kind: "box", size: { x: 4, y: 4, z: 4 } },
      at(0, 0, 0),
      { kind: "capsule", radius: 0.5, height: 2 },
      at(1.5, 0, 0),
    );
    expect(m).not.toBeNull();
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
    expect(m!.depth).toBeCloseTo(1, 6);
    expect(m!.point.x).toBeCloseTo(2, 6);
  });

  it("orients the pair by actor id, not by enumeration order", () => {
    // The same two spheres, enumerated higher-id first: the report still puts
    // the lower id at `a` and points the normal from its collider toward the
    // other's — here +x, from actor 1 at the origin toward actor 2.
    const first = actor(2, at(1.5, 0, 0));
    const second = actor(1, at(0, 0, 0));
    const c2 = first.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    const c1 = second.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system, log } = makeSystem([first, second]);
    system.pass();
    const found = hits(log);
    expect(found).toHaveLength(1);
    expect(found[0]!.a).toBe(second);
    expect(found[0]!.b).toBe(first);
    expect(found[0]!.colliders).toEqual([c1, c2]);
    expectVec(found[0]!.manifold.normal, { x: 1, y: 0, z: 0 });
  });

  it("scales a sphere's radius by the largest scale factor's magnitude", () => {
    // Unit spheres 2.5 apart do not touch — until one actor is scaled
    // (2, 1, 1), which takes the radius to 2 and the pair 0.5 deep.
    const unscaled = pairManifold(
      { kind: "sphere", radius: 1 },
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(2.5, 0, 0),
    );
    expect(unscaled).toBeNull();

    const m = pairManifold(
      { kind: "sphere", radius: 1 },
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: { ...IDENTITY },
        scale: { x: 2, y: 1, z: 1 },
      },
      { kind: "sphere", radius: 1 },
      at(2.5, 0, 0),
    );
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 6);
  });

  it("positions a collider by its offset composed with the actor's transform", () => {
    // The collider sits 2 above its actor, so it reaches a sphere at
    // (0, 2.5, 0) that the actor's own position never touches: centers 0.5
    // apart against radii 1, depth 0.5 along -y from the offset collider.
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(0, 2.5, 0));
    const offset = a.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 0.5 },
        responses: { default: "block" },
      }),
    );
    offset.offset.position.y = 2;
    b.attach(new ColliderComponent({ shape: { kind: "sphere", radius: 0.5 } }));
    const { system, log } = makeSystem([a, b]);
    system.pass();
    const found = hits(log);
    expect(found).toHaveLength(1);
    expectVec(found[0]!.manifold.normal, { x: 0, y: 1, z: 0 });
    expect(found[0]!.manifold.depth).toBeCloseTo(0.5, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* The pass                                                                   */
/* -------------------------------------------------------------------------- */

describe("the pass", () => {
  /** A blocking or overlapping unit-sphere pair the pass tests each call. */
  function spherePair(response: "block" | "overlap"): {
    a: Actor;
    b: Actor;
    ca: ColliderComponent;
    cb: ColliderComponent;
    system: CollisionSystem;
    log: Logged[];
  } {
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(1.5, 0, 0));
    const ca = a.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: response },
      }),
    );
    const cb = b.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system, log } = makeSystem([a, b]);
    return { a, b, ca, cb, system, log };
  }

  it("emits hit on every pass a blocking pair persists, so a resting body is pushed again", () => {
    const { system, log } = spherePair("block");
    system.pass();
    system.pass();
    system.pass();
    expect(names(log)).toEqual(["hit", "hit", "hit"]);
  });

  it("emits overlap:begin once and stays silent while the pair persists", () => {
    const { system, log } = spherePair("overlap");
    system.pass();
    system.pass();
    system.pass();
    expect(names(log)).toEqual(["overlap:begin"]);
  });

  it("emits overlap:end on the first pass that stops finding the pair", () => {
    const { b, ca, cb, system, log } = spherePair("overlap");
    system.pass();
    b.transform.position.x = 10;
    system.pass();
    system.pass();
    expect(names(log)).toEqual(["overlap:begin", "overlap:end"]);
    const end = log[1]!;
    // The end reports the same actors and colliders the begin did.
    expect(end.payload.colliders).toEqual([ca, cb]);
  });

  it("ends a held overlap when its actor is destroyed", () => {
    const { b, system, log } = spherePair("overlap");
    system.pass();
    b.destroy();
    system.pass();
    expect(names(log)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends a held overlap when its collider is disabled", () => {
    const { cb, system, log } = spherePair("overlap");
    system.pass();
    cb.enabled = false;
    system.pass();
    expect(names(log)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends every held overlap when the world closes, and holds nothing after", () => {
    const { system, log } = spherePair("overlap");
    system.pass();
    system.close();
    system.close();
    expect(names(log)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("re-begins an overlap that ended and then returned", () => {
    const { b, system, log } = spherePair("overlap");
    system.pass();
    b.transform.position.x = 10;
    system.pass();
    b.transform.position.x = 1.5;
    system.pass();
    expect(names(log)).toEqual([
      "overlap:begin",
      "overlap:end",
      "overlap:begin",
    ]);
  });

  it("excludes a destroyed actor from the pass at once", () => {
    const { a, system, log } = spherePair("block");
    a.destroy();
    system.pass();
    expect(log).toEqual([]);
  });

  it("excludes a disabled collider from the pass", () => {
    const { ca, system, log } = spherePair("block");
    ca.enabled = false;
    system.pass();
    expect(log).toEqual([]);
  });

  it("never pairs two colliders on the same actor, which are one body", () => {
    const solo = actor(1, at(0, 0, 0));
    solo.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    solo.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    const { system, log } = makeSystem([solo]);
    system.pass();
    expect(log).toEqual([]);
  });

  it("leaves a degenerate shape out of the pass entirely", () => {
    const { ca, system, log } = spherePair("block");
    ca.shape = { kind: "sphere", radius: 0 };
    system.pass();
    expect(log).toEqual([]);
    // A zero side degenerates a box the same way.
    ca.shape = { kind: "box", size: { x: 0, y: 5, z: 5 } };
    system.pass();
    expect(log).toEqual([]);
  });

  it("collides a zero-height capsule as the sphere it is", () => {
    const m = pairManifold(
      { kind: "capsule", radius: 1, height: 0 },
      at(0, 0, 0),
      { kind: "sphere", radius: 1 },
      at(1.5, 0, 0),
    );
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 6);
    expectVec(m!.normal, { x: 1, y: 0, z: 0 });
  });

  it("reads the shape as it stands when it runs, which is what sizing in configure relies on", () => {
    // The pair starts out of reach; growing the shape mid-scenario is enough,
    // because the pass reads the mutable field fresh — the configure idiom.
    const { ca, system, log } = spherePair("block");
    ca.shape = { kind: "sphere", radius: 0.1 };
    system.pass();
    expect(log).toEqual([]);
    ca.shape = { kind: "sphere", radius: 1 };
    system.pass();
    expect(names(log)).toEqual(["hit"]);
  });

  it("reads the channel and the responses as they stand too, so a pair can be retuned mid-run", () => {
    // The same two shapes throughout: only the filter changes, and each pass
    // reports whatever the filter says at the moment it runs.
    const { ca, cb, system, log } = spherePair("block");

    // Withdrawing the one declaration leaves the pair ignored by both sides.
    ca.responses = {};
    system.pass();
    expect(log).toEqual([]);

    // The other side declares instead: one side is enough, either side.
    cb.responses = { default: "overlap" };
    system.pass();
    expect(names(log)).toEqual(["overlap:begin"]);

    // Moving the first collider onto a channel the declaration says nothing
    // about drops the pair back to ignore, and the held overlap ends.
    ca.channel = "ball";
    system.pass();
    expect(names(log)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("puts the lower id first in an overlap edge as well as in a hit", () => {
    // The lower-id rule is the pair's, not the hit's: the same two actors
    // enumerated higher-id first still report `a` as the lower id.
    const first = actor(2, at(1.5, 0, 0));
    const second = actor(1, at(0, 0, 0));
    const c2 = first.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    const c1 = second.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system, log } = makeSystem([first, second]);
    system.pass();
    expect(names(log)).toEqual(["overlap:begin"]);
    expect(log[0]!.payload.a).toBe(second);
    expect(log[0]!.payload.b).toBe(first);
    expect(log[0]!.payload.colliders).toEqual([c1, c2]);
  });

  it("keeps reporting the rest of the pass after a handler destroys an actor", () => {
    // The colliders are snapshotted at the top of the pass, so a handler that
    // destroys an actor changes the next pass rather than the one it is
    // interrupting — which is what lets a handler respond without having to
    // reason about the pairs still to come.
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(1.5, 0, 0));
    // Far enough from b (2.12 apart against radii 2) that only a meets it.
    const c = actor(3, at(0, 1.5, 0));
    for (const owner of [a, b, c]) {
      owner.attach(
        new ColliderComponent({
          shape: { kind: "sphere", radius: 1 },
          responses: { default: "block" },
        }),
      );
    }
    const seen: number[][] = [];
    const system = new CollisionSystem({
      actors: () => [a, b, c],
      emit: (_event, payload) => {
        seen.push([payload.a.id, payload.b.id]);
        c.destroy();
      },
    });
    system.pass();
    expect(seen).toEqual([
      [1, 2],
      [1, 3],
    ]);

    // Next pass, the destroyed actor is gone and only the surviving pair reports.
    seen.length = 0;
    system.pass();
    expect(seen).toEqual([[1, 2]]);
  });

  it("reports a depth that separates the pair exactly, which is what a push-out applies", () => {
    // Unit spheres 1.5 apart penetrate 0.5 along +x. Moving the second out by
    // `normal * depth` leaves them exactly touching, which the pass does not
    // report; moving it a shade less leaves them penetrating and reported.
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(1.5, 0, 0));
    a.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    b.attach(new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }));
    const { system, log } = makeSystem([a, b]);
    system.pass();
    const { manifold } = hits(log)[0]!;

    // A shade short of the depth still leaves them penetrating.
    b.transform.position.x = 1.5 + manifold.normal.x * manifold.depth * 0.99;
    log.length = 0;
    system.pass();
    expect(names(log)).toEqual(["hit"]);

    // The whole depth separates them, and a pair exactly touching is silent.
    b.transform.position.x = 1.5 + manifold.normal.x * manifold.depth;
    log.length = 0;
    system.pass();
    expect(log).toEqual([]);
  });

  it("emits this frame's begins before its ends", () => {
    // One overlap separates while another arrives on the same pass: the new
    // pair's begin is emitted with the found pairs, the old pair's end after.
    const a = actor(1, at(0, 0, 0));
    const b = actor(2, at(1.5, 0, 0));
    const c = actor(3, at(100, 0, 0));
    a.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    b.attach(new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }));
    c.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    const { system, log } = makeSystem([a, b, c]);
    system.pass();
    expect(names(log)).toEqual(["overlap:begin"]);
    b.transform.position.x = 200;
    c.transform.position.x = 1.5;
    system.pass();
    expect(names(log)).toEqual([
      "overlap:begin",
      "overlap:begin",
      "overlap:end",
    ]);
    expect(log[1]!.payload.b.id).toBe(3);
    expect(log[2]!.payload.b.id).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

describe("overlaps", () => {
  it("reports the colliders intersecting one of the actor's, with their owners", () => {
    const mover = actor(1, at(0, 0, 0));
    const near = actor(2, at(1.5, 0, 0));
    const far = actor(3, at(50, 0, 0));
    mover.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    const nearCollider = near.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    far.attach(new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }));
    const { system } = makeSystem([mover, near, far]);
    const found = system.overlaps(mover);
    expect(found).toEqual([{ actor: near, collider: nearCollider }]);
  });

  it("leaves out a pair the responses resolve to ignore", () => {
    const mover = actor(1, at(0, 0, 0));
    const near = actor(2, at(1.5, 0, 0));
    mover.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    near.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system } = makeSystem([mover, near]);
    expect(system.overlaps(mover)).toEqual([]);
  });

  it("reports a collider once even when it touches two of the actor's colliders", () => {
    const mover = actor(1, at(0, 0, 0));
    const near = actor(2, at(0, 0, 0));
    mover.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    mover.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 2 },
        responses: { default: "overlap" },
      }),
    );
    near.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system } = makeSystem([mover, near]);
    expect(system.overlaps(mover)).toHaveLength(1);
  });

  it("answers nothing for a destroyed actor", () => {
    const mover = actor(1, at(0, 0, 0));
    const near = actor(2, at(1.5, 0, 0));
    mover.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    near.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system } = makeSystem([mover, near]);
    mover.destroy();
    expect(system.overlaps(mover)).toEqual([]);
  });
});

describe("query", () => {
  it("reports what the shape touches when placed at the point", () => {
    const inside = actor(1, at(2, 0, 0));
    const outside = actor(2, at(10, 0, 0));
    const insideCollider = inside.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    outside.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system } = makeSystem([inside, outside]);
    const caught = system.query(
      { kind: "sphere", radius: 2 },
      { x: 0, y: 0, z: 0 },
      { responses: { default: "overlap" } },
    );
    expect(caught).toEqual([{ actor: inside, collider: insideCollider }]);
  });

  it("filters by the both-directions rule, so one side is enough either way", () => {
    const target = actor(1, at(1, 0, 0));
    target.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        channel: "enemy",
        responses: { blast: "overlap" },
      }),
    );
    const { system } = makeSystem([target]);
    // The query declares nothing; the collider answers the query's channel.
    const seen = system.query(
      { kind: "sphere", radius: 1 },
      { x: 0, y: 0, z: 0 },
      { channel: "blast" },
    );
    expect(seen).toHaveLength(1);
    // Neither side answers: the collider is invisible to the query.
    const unseen = system.query(
      { kind: "sphere", radius: 1 },
      { x: 0, y: 0, z: 0 },
      { channel: "shout" },
    );
    expect(unseen).toEqual([]);
  });

  it('defaults the query to the "default" channel', () => {
    const listens = actor(1, at(0, 0, 0));
    const silent = actor(2, at(0, 0, 0));
    listens.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    silent.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    const { system } = makeSystem([listens, silent]);
    const seen = system.query(
      { kind: "sphere", radius: 1 },
      { x: 0, y: 0, z: 0 },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.actor).toBe(listens);
  });

  it("skips every collider owned by an actor named in ignore", () => {
    const self = actor(1, at(0, 0, 0));
    self.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "overlap" },
      }),
    );
    const { system } = makeSystem([self]);
    const seen = system.query(
      { kind: "sphere", radius: 1 },
      { x: 0, y: 0, z: 0 },
      { responses: { default: "overlap" }, ignore: [self] },
    );
    expect(seen).toEqual([]);
  });

  it("places the shape with identity orientation whatever the touched collider's is", () => {
    // A long thin box rotated 90° about z stands along y; a query sphere at
    // (2.5, 0, 0) reaches only 0.5 from its surface if the rotation is
    // honored on the collider — and misses entirely if it were not, since
    // the unrotated box reaches x = 5.
    const post = actor(1, {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      scale: { x: 1, y: 1, z: 1 },
    });
    post.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 10, y: 2, z: 2 } },
        responses: { default: "overlap" },
      }),
    );
    const { system } = makeSystem([post]);
    // Rotated, the box spans x ∈ [-1, 1]: a radius-2 sphere at x = 2.5 reaches.
    expect(
      system.query({ kind: "sphere", radius: 2 }, { x: 2.5, y: 0, z: 0 }),
    ).toHaveLength(1);
    // A radius-1 sphere at the same point does not.
    expect(
      system.query({ kind: "sphere", radius: 1 }, { x: 2.5, y: 0, z: 0 }),
    ).toEqual([]);
  });
});

describe("raycast", () => {
  /** A sphere at (5, 0, 0) and a box at (10, 0, 0), both answering "default". */
  function corridor(): {
    sphereActor: Actor;
    boxActor: Actor;
    system: CollisionSystem;
  } {
    const sphereActor = actor(1, at(5, 0, 0));
    const boxActor = actor(2, at(10, 0, 0));
    sphereActor.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    boxActor.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
        responses: { default: "block" },
      }),
    );
    const { system } = makeSystem([sphereActor, boxActor]);
    return { sphereActor, boxActor, system };
  }

  const ORIGIN = { x: 0, y: 0, z: 0 };
  const PLUS_X = { x: 1, y: 0, z: 0 };

  it("returns the nearest hit with its point, normal, and distance", () => {
    // The sphere's near surface is at x = 4: distance 4, entry normal -x.
    const { sphereActor, system } = corridor();
    const hit = system.raycast(ORIGIN, PLUS_X, 100);
    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(sphereActor);
    expect(hit!.distance).toBeCloseTo(4, 6);
    expectVec(hit!.point, { x: 4, y: 0, z: 0 });
    expectVec(hit!.normal, { x: -1, y: 0, z: 0 });
  });

  it("reports a box hit with the entered face's outward normal", () => {
    // Past the sphere via ignore, the box's near face is at x = 9.
    const { sphereActor, boxActor, system } = corridor();
    const hit = system.raycast(ORIGIN, PLUS_X, 100, { ignore: [sphereActor] });
    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(boxActor);
    expect(hit!.distance).toBeCloseTo(9, 6);
    expectVec(hit!.point, { x: 9, y: 0, z: 0 });
    expectVec(hit!.normal, { x: -1, y: 0, z: 0 });
  });

  it("bounds the ray at distance, so a far collider is out of reach", () => {
    const { system } = corridor();
    expect(system.raycast(ORIGIN, PLUS_X, 3)).toBeNull();
  });

  it("answers a ray from inside a shape at distance zero, facing back along the ray", () => {
    const { system } = corridor();
    const hit = system.raycast({ x: 5, y: 0, z: 0 }, PLUS_X, 100);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBe(0);
    expectVec(hit!.point, { x: 5, y: 0, z: 0 });
    expectVec(hit!.normal, { x: -1, y: 0, z: 0 });
  });

  it("hits a capsule's cylindrical side where the ray meets the swept radius", () => {
    // Vertical capsule at x = 3, radius 1: the side is met at x = 2, and the
    // surface normal there points straight back at the origin.
    const capsuleActor = actor(1, at(3, 0, 0));
    capsuleActor.attach(
      new ColliderComponent({
        shape: { kind: "capsule", radius: 1, height: 2 },
        responses: { default: "block" },
      }),
    );
    const { system } = makeSystem([capsuleActor]);
    const hit = system.raycast(ORIGIN, PLUS_X, 100);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(2, 6);
    expectVec(hit!.point, { x: 2, y: 0, z: 0 });
    expectVec(hit!.normal, { x: -1, y: 0, z: 0 });
  });

  it("hits a capsule's cap as the sphere it is", () => {
    // Straight down at the top cap, whose center is (3, 1, 0): the surface
    // is met at y = 2, distance 3 from y = 5, normal +y.
    const capsuleActor = actor(1, at(3, 0, 0));
    capsuleActor.attach(
      new ColliderComponent({
        shape: { kind: "capsule", radius: 1, height: 2 },
        responses: { default: "block" },
      }),
    );
    const { system } = makeSystem([capsuleActor]);
    const hit = system.raycast(
      { x: 3, y: 5, z: 0 },
      { x: 0, y: -1, z: 0 },
      100,
    );
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(3, 6);
    expectVec(hit!.point, { x: 3, y: 2, z: 0 });
    expectVec(hit!.normal, { x: 0, y: 1, z: 0 });
  });

  it("filters by channel and responses like every other collision question", () => {
    const wall = actor(1, at(5, 0, 0));
    wall.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
        channel: "wall",
      }),
    );
    const { system } = makeSystem([wall]);
    // The vision query answers `wall` with "block": the wall is seen.
    expect(
      system.raycast(ORIGIN, PLUS_X, 100, {
        channel: "vision",
        responses: { wall: "block" },
      }),
    ).not.toBeNull();
    // A query that says nothing about walls sees nothing: the wall declares
    // no answer for `vision` either, so resolution stays at ignore.
    expect(
      system.raycast(ORIGIN, PLUS_X, 100, { channel: "vision" }),
    ).toBeNull();
  });
});

describe("raycastAll", () => {
  it("reports every hit in increasing distance, one per collider", () => {
    // The corridor again, enumerated box-first to show the sort is by
    // distance rather than by enumeration.
    const boxActor = actor(1, at(10, 0, 0));
    const sphereActor = actor(2, at(5, 0, 0));
    boxActor.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
        responses: { default: "block" },
      }),
    );
    sphereActor.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: 1 },
        responses: { default: "block" },
      }),
    );
    const { system } = makeSystem([boxActor, sphereActor]);
    const found = system.raycastAll(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      100,
    );
    expect(found.map((hit) => hit.actor)).toEqual([sphereActor, boxActor]);
    expect(found[0]!.distance).toBeCloseTo(4, 6);
    expect(found[1]!.distance).toBeCloseTo(9, 6);
  });

  it("leaves out a collider past the distance bound", () => {
    const near = actor(1, at(5, 0, 0));
    const far = actor(2, at(50, 0, 0));
    for (const target of [near, far]) {
      target.attach(
        new ColliderComponent({
          shape: { kind: "sphere", radius: 1 },
          responses: { default: "block" },
        }),
      );
    }
    const { system } = makeSystem([near, far]);
    const found = system.raycastAll(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      10,
    );
    expect(found.map((hit) => hit.actor)).toEqual([near]);
  });
});

/* -------------------------------------------------------------------------- */
/* bounds()                                                                   */
/* -------------------------------------------------------------------------- */

describe("bounds", () => {
  it("encloses a sphere at its world position", () => {
    const owner = actor(1, at(3, 4, 5));
    const collider = owner.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 2 } }),
    );
    expect(collider.bounds()).toEqual({
      min: { x: 1, y: 2, z: 3 },
      max: { x: 5, y: 6, z: 7 },
    });
  });

  it("encloses a rotated box by its projection, √2 wide for a 45° unit box", () => {
    const owner = actor(1, {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
      scale: { x: 1, y: 1, z: 1 },
    });
    const collider = owner.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
      }),
    );
    const bounds = collider.bounds();
    expectVec(bounds.min, { x: -Math.SQRT2, y: -Math.SQRT2, z: -1 });
    expectVec(bounds.max, { x: Math.SQRT2, y: Math.SQRT2, z: 1 });
  });

  it("encloses a rotated capsule along its world axis", () => {
    // Rotated 90° about z, the capsule lies along x: caps at x = ±1 swept by
    // radius 0.5 reach ±1.5 on x and ±0.5 on y and z.
    const owner = actor(1, {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      scale: { x: 1, y: 1, z: 1 },
    });
    const collider = owner.attach(
      new ColliderComponent({
        shape: { kind: "capsule", radius: 0.5, height: 2 },
      }),
    );
    const bounds = collider.bounds();
    expectVec(bounds.min, { x: -1.5, y: -0.5, z: -0.5 });
    expectVec(bounds.max, { x: 1.5, y: 0.5, z: 0.5 });
  });

  it("scales a capsule's height by the y factor and its radius by the largest", () => {
    // Scale (1, 2, 1): the half height doubles to 2 and the radius doubles to
    // 1 (largest factor), so the capsule spans y ∈ ±3 and x, z ∈ ±1.
    const owner = actor(1, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { ...IDENTITY },
      scale: { x: 1, y: 2, z: 1 },
    });
    const collider = owner.attach(
      new ColliderComponent({
        shape: { kind: "capsule", radius: 0.5, height: 2 },
      }),
    );
    const bounds = collider.bounds();
    expectVec(bounds.min, { x: -1, y: -3, z: -1 });
    expectVec(bounds.max, { x: 1, y: 3, z: 1 });
  });

  it("encloses the shape at the component's world transform, offset included", () => {
    // The collider sits 3 along the actor's local +x; the actor is turned 90°
    // about z, so the offset carries the sphere to (0, 3, 0) and the bounds
    // follow it rather than staying on the actor.
    const owner = actor(1, {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      scale: { x: 1, y: 1, z: 1 },
    });
    const collider = owner.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
    );
    collider.offset.position.x = 3;
    const bounds = collider.bounds();
    expectVec(bounds.min, { x: -1, y: 2, z: -1 });
    expectVec(bounds.max, { x: 1, y: 4, z: 1 });
  });

  it("answers for a degenerate shape as the zero-sized box where it is", () => {
    const owner = actor(1, at(2, 2, 2));
    const collider = owner.attach(
      new ColliderComponent({ shape: { kind: "sphere", radius: 0 } }),
    );
    expect(collider.bounds()).toEqual({
      min: { x: 2, y: 2, z: 2 },
      max: { x: 2, y: 2, z: 2 },
    });
  });
});
