import { describe, expect, it } from "vitest";
import { ColliderComponent, CollisionSystem } from "./collision";
import type { Actor } from "./actors";
import type { ColliderOptions, EngineEventMap, Transform } from "./contract";

/**
 * The suite drives the system through fakes rather than through the real
 * `Actor`, `EngineWorld`, and `EventBus`, because those are separate
 * subsystems with their own suites and their scaffolds may still throw. The
 * system's documented inputs are narrow — a list of live actors whose
 * components include colliders, each collider positioned by its
 * `worldTransform()` — so a fake actor is a plain record and each collider's
 * `worldTransform` is stubbed to compose the fake's transform with the
 * component's `offset`, exactly the composition the components page documents.
 */
interface FakeActor {
  id: number;
  alive: boolean;
  transform: Transform;
  components: ColliderComponent[];
}

/** One event the fake broadcaster recorded, in emission order. */
interface Emitted {
  event: "overlap:begin" | "overlap:end" | "hit";
  payload: EngineEventMap["overlap:begin"] | EngineEventMap["hit"];
}

/** A full transform from a position, for fakes and stubs. */
function at(x: number, y: number, rest?: Partial<Transform>): Transform {
  return { x, y, rotation: 0, scaleX: 1, scaleY: 1, ...rest };
}

/** The documented composition: offset scaled and rotated into the actor's frame. */
function compose(actor: Transform, offset: Transform): Transform {
  const cos = Math.cos(actor.rotation);
  const sin = Math.sin(actor.rotation);
  const ox = offset.x * actor.scaleX;
  const oy = offset.y * actor.scaleY;
  return {
    x: actor.x + ox * cos - oy * sin,
    y: actor.y + ox * sin + oy * cos,
    rotation: actor.rotation + offset.rotation,
    scaleX: actor.scaleX * offset.scaleX,
    scaleY: actor.scaleY * offset.scaleY,
  };
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
  function actor(x = 0, y = 0): FakeActor {
    const spawned: FakeActor = {
      id: nextId,
      alive: true,
      transform: at(x, y),
      components: [],
    };
    nextId += 1;
    actors.push(spawned);
    return spawned;
  }

  /**
   * Attaches a real `ColliderComponent` to a fake actor, its `worldTransform`
   * stubbed to read the fake's transform live — moving the actor moves the
   * collider, the way the real composition does.
   */
  function collider(
    owner: FakeActor,
    options: ColliderOptions,
  ): ColliderComponent {
    const component = new ColliderComponent(options);
    component.worldTransform = () => compose(owner.transform, component.offset);
    owner.components.push(component);
    return component;
  }

  return { actors, events, system, actor, collider };
}

/** The event names in emission order, the shape most ordering tests assert. */
function names(events: readonly Emitted[]): string[] {
  return events.map((e) => e.event);
}

/** The manifold of the only hit emitted so far, asserting there is exactly one. */
function onlyHit(events: readonly Emitted[]): EngineEventMap["hit"] {
  const hits = events.filter((e) => e.event === "hit");
  expect(hits).toHaveLength(1);
  return hits[0]!.payload as EngineEventMap["hit"];
}

describe("ColliderComponent", () => {
  it('defaults the channel to "default" and the responses to empty', () => {
    const component = new ColliderComponent({
      shape: { kind: "circle", radius: 4 },
    });

    expect(component.channel).toBe("default");
    expect(component.responses).toEqual({});
  });

  it("keeps the channel and responses it was given", () => {
    const component = new ColliderComponent({
      shape: { kind: "circle", radius: 8 },
      channel: "ball",
      responses: { wall: "block", goal: "overlap" },
    });

    expect(component.channel).toBe("ball");
    expect(component.responses).toEqual({ wall: "block", goal: "overlap" });
  });

  it("copies the responses record it was constructed from", () => {
    const responses = { wall: "block" } as const;
    const component = new ColliderComponent({
      shape: { kind: "circle", radius: 8 },
      responses,
    });

    component.responses["goal"] = "overlap";

    // The caller's record is untouched, and the component's own record is the
    // plain mutable object the class declares.
    expect(responses).toEqual({ wall: "block" });
  });

  it("holds the shape it was given, by reference, so a game can mutate it", () => {
    const shape = { kind: "rect", width: 10, height: 4 } as const;
    const component = new ColliderComponent({ shape });

    expect(component.shape).toBe(shape);
  });

  it("is enabled by default, with the identity offset", () => {
    const component = new ColliderComponent({
      shape: { kind: "circle", radius: 1 },
    });

    expect(component.enabled).toBe(true);
    expect(component.offset).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
  });
});

describe("ColliderComponent.bounds", () => {
  it("encloses a circle at the component's world transform", () => {
    const world = makeWorld();
    const owner = world.actor(10, 20);
    const component = world.collider(owner, {
      shape: { kind: "circle", radius: 5 },
    });

    expect(component.bounds()).toEqual({ x: 5, y: 15, width: 10, height: 10 });
  });

  it("encloses a rotated rect by its rotated corners", () => {
    const world = makeWorld();
    const owner = world.actor(0, 0);
    owner.transform.rotation = Math.PI / 2;
    const component = world.collider(owner, {
      shape: { kind: "rect", width: 10, height: 4 },
    });

    const bounds = component.bounds();
    expect(bounds.x).toBeCloseTo(-2);
    expect(bounds.y).toBeCloseTo(-5);
    expect(bounds.width).toBeCloseTo(4);
    expect(bounds.height).toBeCloseTo(10);
  });

  it("scales a circle by the larger scale magnitude", () => {
    const world = makeWorld();
    const owner = world.actor(0, 0);
    owner.transform.scaleX = 3;
    const component = world.collider(owner, {
      shape: { kind: "circle", radius: 2 },
    });

    // A non-uniform scale would make an ellipse; the enclosing circle stands
    // in, so both extents take the larger scale.
    expect(component.bounds()).toEqual({ x: -6, y: -6, width: 12, height: 12 });
  });

  it("moves with the component's offset", () => {
    const world = makeWorld();
    const owner = world.actor(10, 0);
    const component = world.collider(owner, {
      shape: { kind: "circle", radius: 1 },
    });
    component.offset.x = 5;

    expect(component.bounds()).toEqual({ x: 14, y: -1, width: 2, height: 2 });
  });

  it("encloses a polygon's transformed points", () => {
    const world = makeWorld();
    const owner = world.actor(100, 50);
    const component = world.collider(owner, {
      shape: {
        kind: "polygon",
        points: [
          { x: 0, y: -4 },
          { x: 3, y: 2 },
          { x: -3, y: 2 },
        ],
      },
    });

    expect(component.bounds()).toEqual({ x: 97, y: 46, width: 6, height: 6 });
  });
});

describe("resolving a pair", () => {
  it("lets one side alone establish a block, so bare scenery still blocks", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
      responses: { wall: "block" },
    });
    const wall = world.actor(4, 0);
    world.collider(wall, {
      shape: { kind: "rect", width: 10, height: 10 },
      channel: "wall",
    });

    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("takes the stronger of the two answers, block over overlap", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
      responses: { wall: "block" },
    });
    const wall = world.actor(4, 0);
    world.collider(wall, {
      shape: { kind: "rect", width: 10, height: 10 },
      channel: "wall",
      responses: { ball: "overlap" },
    });

    world.system.pass();

    // Block wins, so the pair is a hit and never an overlap edge.
    expect(names(world.events)).toEqual(["hit"]);
  });

  it("never tests a pair neither side names", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, { shape: { kind: "circle", radius: 6 }, channel: "one" });
    const b = world.actor(2, 0);
    world.collider(b, { shape: { kind: "circle", radius: 6 }, channel: "two" });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("leaves a pair both sides declare ignore alone", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 6 },
      channel: "one",
      responses: { two: "ignore" },
    });
    const b = world.actor(2, 0);
    world.collider(b, {
      shape: { kind: "circle", radius: 6 },
      channel: "two",
      responses: { one: "ignore" },
    });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("settles on overlap when the stronger answer is overlap", () => {
    // The example's floor: the floor answers the ball with overlap and the
    // ball says nothing about the floor, so the pair is a trigger.
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
    });
    const floor = world.actor(0, 4);
    world.collider(floor, {
      shape: { kind: "rect", width: 640, height: 16 },
      channel: "floor",
      responses: { ball: "overlap" },
    });

    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin"]);
  });

  it("answers for the default channel of a collider constructed without one", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, { shape: { kind: "circle", radius: 6 } });
    const b = world.actor(2, 0);
    world.collider(b, {
      shape: { kind: "circle", radius: 6 },
      channel: "sensor",
      responses: { default: "block" },
    });

    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("treats a channel named after an Object.prototype member as unlisted", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 6 },
      channel: "constructor",
    });
    const b = world.actor(2, 0);
    world.collider(b, { shape: { kind: "circle", radius: 6 } });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("reads responses as they stand when the pass runs", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    const collider = world.collider(a, {
      shape: { kind: "circle", radius: 6 },
      channel: "one",
    });
    const b = world.actor(2, 0);
    world.collider(b, { shape: { kind: "circle", radius: 6 }, channel: "two" });

    world.system.pass();
    expect(world.events).toEqual([]);

    // Retuned live, the way a level's `configure` retunes a shared class.
    collider.responses["two"] = "block";
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("reads the shape as it stands when the pass runs", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    const collider = world.collider(a, {
      shape: { kind: "circle", radius: 1 },
      responses: { default: "block" },
    });
    const b = world.actor(10, 0);
    world.collider(b, { shape: { kind: "circle", radius: 1 } });

    world.system.pass();
    expect(world.events).toEqual([]);

    collider.shape = { kind: "circle", radius: 12 };
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });
});

describe("the hit event", () => {
  it("reports the lower-id actor first with the colliders in the same order", () => {
    const world = makeWorld();
    // The wall spawns first — a is the wall, whichever side "moved".
    const wall = world.actor(8, 0);
    const wallCollider = world.collider(wall, {
      shape: { kind: "circle", radius: 5 },
      channel: "wall",
    });
    const ball = world.actor(0, 0);
    const ballCollider = world.collider(ball, {
      shape: { kind: "circle", radius: 5 },
      channel: "ball",
      responses: { wall: "block" },
    });

    world.system.pass();

    const hit = onlyHit(world.events);
    expect(hit.a).toBe(wall as unknown as Actor);
    expect(hit.b).toBe(ball as unknown as Actor);
    expect(hit.colliders[0]).toBe(wallCollider);
    expect(hit.colliders[1]).toBe(ballCollider);
    // From the first collider toward the second: the ball sits to the wall's
    // left, so the normal points -x.
    expect(hit.manifold.normal).toEqual({ x: -1, y: 0 });
  });

  it("carries the circle-circle manifold exactly", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    expect(manifold.normal).toEqual({ x: 1, y: 0 });
    expect(manifold.depth).toBeCloseTo(2);
    // The midpoint of the overlapping lens along the axis.
    expect(manifold.point.x).toBeCloseTo(4);
    expect(manifold.point.y).toBeCloseTo(0);
  });

  it("emits on every frame the pair persists, with the manifold as it stands", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const wall = world.actor(8, 0);
    world.collider(wall, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();
    ball.transform.x = 2;
    world.system.pass();

    const hits = world.events.filter((e) => e.event === "hit");
    expect(hits).toHaveLength(2);
    const first = hits[0]!.payload as EngineEventMap["hit"];
    const second = hits[1]!.payload as EngineEventMap["hit"];
    expect(first.manifold.depth).toBeCloseTo(2);
    expect(second.manifold.depth).toBeCloseTo(4);
  });

  it("stops once the shapes separate", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const wall = world.actor(8, 0);
    world.collider(wall, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();
    ball.transform.x = -20;
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });

  it("leaves out a destroyed actor at once", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    a.alive = false;
    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("leaves out a disabled collider", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    const collider = world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    collider.enabled = false;
    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("never pairs two colliders on the same actor", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });

    world.system.pass();

    expect(world.events).toEqual([]);
  });

  it("reports pairs in enumeration order: spawn order, then attachment order", () => {
    const world = makeWorld();
    const mover = world.actor(0, 0);
    world.collider(mover, {
      shape: { kind: "circle", radius: 20 },
      responses: { default: "block" },
    });
    const near = world.actor(5, 0);
    world.collider(near, { shape: { kind: "circle", radius: 1 } });
    const far = world.actor(-5, 0);
    world.collider(far, { shape: { kind: "circle", radius: 1 } });

    world.system.pass();

    const hits = world.events.map((e) => e.payload as EngineEventMap["hit"]);
    expect(names(world.events)).toEqual(["hit", "hit"]);
    expect(hits[0]!.b).toBe(near as unknown as Actor);
    expect(hits[1]!.b).toBe(far as unknown as Actor);
  });
});

describe("overlap begin and end", () => {
  /** A trigger pair: an overlap-resolving circle over a floor. */
  function trigger() {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    const ballCollider = world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
    });
    const floor = world.actor(0, 4);
    const floorCollider = world.collider(floor, {
      shape: { kind: "rect", width: 640, height: 16 },
      channel: "floor",
      responses: { ball: "overlap" },
    });
    return { world, ball, floor, ballCollider, floorCollider };
  }

  it("begins on the first frame the pair is found, once", () => {
    const { world } = trigger();

    world.system.pass();
    world.system.pass();
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin"]);
  });

  it("reports the lower-id actor first", () => {
    const { world, ball, floor, ballCollider, floorCollider } = trigger();

    world.system.pass();

    const payload = world.events[0]!.payload;
    expect(payload.a).toBe(ball as unknown as Actor);
    expect(payload.b).toBe(floor as unknown as Actor);
    expect(payload.colliders[0]).toBe(ballCollider);
    expect(payload.colliders[1]).toBe(floorCollider);
  });

  it("ends on the first frame the pair is no longer found, once", () => {
    const { world, ball } = trigger();

    world.system.pass();
    ball.transform.y = -100;
    world.system.pass();
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends with the same actors and colliders it began with", () => {
    const { world, ball, floor, ballCollider, floorCollider } = trigger();

    world.system.pass();
    ball.transform.y = -100;
    world.system.pass();

    const end = world.events[1]!.payload;
    expect(end.a).toBe(ball as unknown as Actor);
    expect(end.b).toBe(floor as unknown as Actor);
    expect(end.colliders).toEqual([ballCollider, floorCollider]);
  });

  it("ends when either actor is destroyed", () => {
    const { world, ball } = trigger();

    world.system.pass();
    ball.alive = false;
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("ends when the collider is disabled", () => {
    const { world, ballCollider } = trigger();

    world.system.pass();
    ballCollider.enabled = false;
    world.system.pass();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("begins again after an end when the pair re-enters", () => {
    const { world, ball } = trigger();

    world.system.pass();
    ball.transform.y = -100;
    world.system.pass();
    ball.transform.y = 0;
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:end",
      "overlap:begin",
    ]);
  });

  it("emits a frame's begins before its ends", () => {
    const { world, ball } = trigger();
    // A second trigger the ball enters as it leaves the floor.
    const goal = world.actor(0, -104);
    world.collider(goal, {
      shape: { kind: "rect", width: 640, height: 16 },
      channel: "goal",
      responses: { ball: "overlap" },
    });

    world.system.pass();
    ball.transform.y = -100;
    world.system.pass();

    // Frame two finds the goal pair (begin) and loses the floor pair (end).
    expect(names(world.events)).toEqual([
      "overlap:begin",
      "overlap:begin",
      "overlap:end",
    ]);
  });

  it("ends the overlap and starts hitting when the pair escalates to block", () => {
    const { world, ballCollider } = trigger();

    world.system.pass();
    ballCollider.responses["floor"] = "block";
    world.system.pass();

    expect(names(world.events)).toEqual([
      "overlap:begin",
      "hit",
      "overlap:end",
    ]);
  });

  it("a blocking pair emits no overlap edges", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();
    a.transform.x = -100;
    world.system.pass();

    expect(names(world.events)).toEqual(["hit"]);
  });
});

describe("close", () => {
  it("ends every held pair when the world closes", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
    });
    const floor = world.actor(0, 4);
    world.collider(floor, {
      shape: { kind: "rect", width: 640, height: 16 },
      channel: "floor",
      responses: { ball: "overlap" },
    });

    world.system.pass();
    world.system.close();

    expect(names(world.events)).toEqual(["overlap:begin", "overlap:end"]);
  });

  it("is idempotent, and a later pass begins afresh", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      channel: "ball",
    });
    const floor = world.actor(0, 4);
    world.collider(floor, {
      shape: { kind: "rect", width: 640, height: 16 },
      channel: "floor",
      responses: { ball: "overlap" },
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

describe("manifold geometry", () => {
  it("separates a circle from a rect it overlaps from outside", () => {
    const world = makeWorld();
    // The ball sits above a wide wall, dipping 2 units into it.
    const ball = world.actor(0, -9);
    world.collider(ball, {
      shape: { kind: "circle", radius: 6 },
      responses: { default: "block" },
    });
    const wall = world.actor(0, 0);
    world.collider(wall, { shape: { kind: "rect", width: 100, height: 10 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    // Circle first: the normal points from the circle down into the wall.
    expect(manifold.normal.x).toBeCloseTo(0);
    expect(manifold.normal.y).toBeCloseTo(1);
    expect(manifold.depth).toBeCloseTo(2);
    expect(manifold.point.x).toBeCloseTo(0);
    expect(manifold.point.y).toBeCloseTo(-5);
  });

  it("pushes a circle whose center is inside a rect out through the nearest edge", () => {
    const world = makeWorld();
    const ball = world.actor(0, -3);
    world.collider(ball, {
      shape: { kind: "circle", radius: 3 },
      responses: { default: "block" },
    });
    const wall = world.actor(0, 0);
    world.collider(wall, { shape: { kind: "rect", width: 100, height: 10 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    // Nearest edge is the top (2 units away): the circle leaves along -y, so
    // the circle-toward-wall normal is +y, and the depth is the radius plus
    // how far the center already sits inside.
    expect(manifold.normal.x).toBeCloseTo(0);
    expect(manifold.normal.y).toBeCloseTo(1);
    expect(manifold.depth).toBeCloseTo(5);
    expect(manifold.point.x).toBeCloseTo(0);
    expect(manifold.point.y).toBeCloseTo(-5);
  });

  it("separates two rects along the axis of least overlap", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "rect", width: 10, height: 10 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "rect", width: 10, height: 10 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    // 2 units of x overlap against 10 of y: x is the cheapest way out.
    expect(manifold.normal.x).toBeCloseTo(1);
    expect(manifold.normal.y).toBeCloseTo(0);
    expect(manifold.depth).toBeCloseTo(2);
    expect(manifold.point.x).toBeCloseTo(4);
  });

  it("honors rotation: a rotated rect reaches where an unrotated one does not", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "rect", width: 10, height: 10 },
      responses: { default: "block" },
    });
    const b = world.actor(0, 12);
    world.collider(b, { shape: { kind: "rect", width: 10, height: 10 } });

    // Axis-aligned, the gap is 2 units.
    world.system.pass();
    expect(world.events).toEqual([]);

    // Rotated 45°, the corner reaches down to 12 - 5√2 ≈ 4.93, past y = 5.
    b.transform.rotation = Math.PI / 4;
    world.system.pass();

    const { manifold } = onlyHit(world.events);
    expect(manifold.normal.x).toBeCloseTo(0);
    expect(manifold.normal.y).toBeCloseTo(1);
    expect(manifold.depth).toBeCloseTo(5 * Math.SQRT2 - 7);
  });

  it("separates a circle from a triangle", () => {
    const world = makeWorld();
    const ball = world.actor(0, -5.5);
    world.collider(ball, {
      shape: { kind: "circle", radius: 2 },
      responses: { default: "block" },
    });
    const wedge = world.actor(0, 0);
    world.collider(wedge, {
      shape: {
        kind: "polygon",
        points: [
          { x: -4, y: -4 },
          { x: 4, y: -4 },
          { x: 0, y: 4 },
        ],
      },
    });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    // The ball hangs over the wedge's flat top edge (y = -4), 0.5 into it.
    expect(manifold.normal.x).toBeCloseTo(0);
    expect(manifold.normal.y).toBeCloseTo(1);
    expect(manifold.depth).toBeCloseTo(0.5);
    expect(manifold.point.y).toBeCloseTo(-4);
  });

  it("gives concentric circles a fixed arbitrary normal and the full depth", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 3 },
      responses: { default: "block" },
    });
    const b = world.actor(0, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    expect(manifold.normal).toEqual({ x: 1, y: 0 });
    expect(manifold.depth).toBeCloseTo(8);
  });

  it("does not report a pair that merely touches", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    world.collider(a, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const b = world.actor(10, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });
    const c = world.actor(0, 20);
    world.collider(c, {
      shape: { kind: "rect", width: 10, height: 10 },
      responses: { default: "block" },
    });
    const d = world.actor(10, 20);
    world.collider(d, { shape: { kind: "rect", width: 10, height: 10 } });

    world.system.pass();

    // Adjacent tiles sharing an edge must not report a hit per frame.
    expect(world.events).toEqual([]);
  });

  it("survives a negative scale flipping a polygon's winding", () => {
    const world = makeWorld();
    const a = world.actor(0, 0);
    a.transform.scaleX = -1;
    world.collider(a, {
      shape: { kind: "rect", width: 10, height: 10 },
      responses: { default: "block" },
    });
    const b = world.actor(8, 0);
    world.collider(b, { shape: { kind: "circle", radius: 5 } });

    world.system.pass();

    const { manifold } = onlyHit(world.events);
    // The mirrored rect still spans x ∈ [-5, 5]; the normal still points at
    // the circle to its right.
    expect(manifold.normal.x).toBeCloseTo(1);
    expect(manifold.normal.y).toBeCloseTo(0);
    expect(manifold.depth).toBeCloseTo(2);
  });

  it("gives a degenerate shape no part in the pass", () => {
    const world = makeWorld();
    const zeroCircle = world.actor(0, 0);
    world.collider(zeroCircle, {
      shape: { kind: "circle", radius: 0 },
      responses: { default: "block" },
    });
    const flatRect = world.actor(0, 0);
    world.collider(flatRect, {
      shape: { kind: "rect", width: 10, height: 0 },
      responses: { default: "block" },
    });
    const segment = world.actor(0, 0);
    world.collider(segment, {
      shape: {
        kind: "polygon",
        points: [
          { x: -5, y: 0 },
          { x: 5, y: 0 },
        ],
      },
      responses: { default: "block" },
    });
    const solid = world.actor(0, 0);
    world.collider(solid, {
      shape: { kind: "circle", radius: 10 },
      responses: { default: "block" },
    });

    world.system.pass();

    expect(world.events).toEqual([]);
  });
});

describe("CollisionWorld.overlaps", () => {
  it("returns the colliders intersecting one of the actor's, with their owners", () => {
    const world = makeWorld();
    const player = world.actor(0, 0);
    world.collider(player, {
      shape: { kind: "circle", radius: 5 },
      channel: "player",
      responses: { water: "overlap" },
    });
    const pool = world.actor(3, 0);
    const poolCollider = world.collider(pool, {
      shape: { kind: "rect", width: 20, height: 20 },
      channel: "water",
    });
    const farPool = world.actor(100, 0);
    world.collider(farPool, {
      shape: { kind: "rect", width: 20, height: 20 },
      channel: "water",
    });

    const result = world.system.overlaps(player as unknown as Actor);

    expect(result).toEqual([
      { actor: pool as unknown as Actor, collider: poolCollider },
    ]);
  });

  it("applies the both-directions rule, leaving ignored pairs out", () => {
    const world = makeWorld();
    const player = world.actor(0, 0);
    world.collider(player, {
      shape: { kind: "circle", radius: 5 },
      channel: "player",
      responses: { water: "overlap" },
    });
    const ghost = world.actor(0, 0);
    world.collider(ghost, {
      shape: { kind: "circle", radius: 5 },
      channel: "ghost",
    });

    expect(world.system.overlaps(player as unknown as Actor)).toEqual([]);
  });

  it("is answered from the colliders as they stand, not from the last pass", () => {
    const world = makeWorld();
    const player = world.actor(100, 0);
    world.collider(player, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });
    const zone = world.actor(0, 0);
    world.collider(zone, { shape: { kind: "circle", radius: 5 } });

    expect(world.system.overlaps(player as unknown as Actor)).toEqual([]);

    // No pass in between: the query alone sees the move.
    player.transform.x = 3;
    expect(world.system.overlaps(player as unknown as Actor)).toHaveLength(1);
  });

  it("reports a collider touching two of the actor's colliders once", () => {
    const world = makeWorld();
    const body = world.actor(0, 0);
    const head = world.collider(body, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });
    head.offset.y = -4;
    const feet = world.collider(body, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });
    feet.offset.y = 4;
    const zone = world.actor(0, 0);
    world.collider(zone, { shape: { kind: "circle", radius: 20 } });

    expect(world.system.overlaps(body as unknown as Actor)).toHaveLength(1);
  });

  it("never reports the actor's own colliders", () => {
    const world = makeWorld();
    const body = world.actor(0, 0);
    world.collider(body, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });
    world.collider(body, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });

    expect(world.system.overlaps(body as unknown as Actor)).toEqual([]);
  });

  it("answers empty for a destroyed actor, and leaves destroyed owners out", () => {
    const world = makeWorld();
    const player = world.actor(0, 0);
    world.collider(player, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "overlap" },
    });
    const zone = world.actor(0, 0);
    world.collider(zone, { shape: { kind: "circle", radius: 5 } });

    zone.alive = false;
    expect(world.system.overlaps(player as unknown as Actor)).toEqual([]);

    zone.alive = true;
    player.alive = false;
    expect(world.system.overlaps(player as unknown as Actor)).toEqual([]);
  });
});

describe("CollisionWorld.query", () => {
  it("finds what the shape would touch placed at a point", () => {
    const world = makeWorld();
    const near = world.actor(10, 0);
    const nearCollider = world.collider(near, {
      shape: { kind: "circle", radius: 4 },
      channel: "enemy",
    });
    const far = world.actor(200, 0);
    world.collider(far, {
      shape: { kind: "circle", radius: 4 },
      channel: "enemy",
    });

    const caught = world.system.query(
      { kind: "circle", radius: 12 },
      { x: 0, y: 0 },
      { channel: "blast", responses: { enemy: "overlap" } },
    );

    expect(caught).toEqual([
      { actor: near as unknown as Actor, collider: nearCollider },
    ]);
  });

  it('defaults to the "default" channel with no responses of its own', () => {
    const world = makeWorld();
    const listens = world.actor(0, 0);
    const listensCollider = world.collider(listens, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const silent = world.actor(0, 0);
    world.collider(silent, { shape: { kind: "circle", radius: 5 } });

    // Only the collider that answers the query's default channel responds.
    const found = world.system.query(
      { kind: "circle", radius: 5 },
      { x: 0, y: 0 },
    );

    expect(found).toEqual([
      { actor: listens as unknown as Actor, collider: listensCollider },
    ]);
  });

  it("leaves out every collider owned by an ignored actor", () => {
    const world = makeWorld();
    const self = world.actor(0, 0);
    world.collider(self, {
      shape: { kind: "circle", radius: 5 },
      channel: "enemy",
    });
    const other = world.actor(2, 0);
    const otherCollider = world.collider(other, {
      shape: { kind: "circle", radius: 5 },
      channel: "enemy",
    });

    const caught = world.system.query(
      { kind: "circle", radius: 10 },
      { x: 0, y: 0 },
      {
        channel: "blast",
        responses: { enemy: "overlap" },
        ignore: [self as unknown as Actor],
      },
    );

    expect(caught).toEqual([
      { actor: other as unknown as Actor, collider: otherCollider },
    ]);
  });

  it("includes pairs the resolution leaves at block as well as overlap", () => {
    const world = makeWorld();
    const wall = world.actor(0, 0);
    world.collider(wall, {
      shape: { kind: "rect", width: 10, height: 10 },
      channel: "wall",
    });

    const found = world.system.query(
      { kind: "circle", radius: 5 },
      { x: 6, y: 0 },
      {
        channel: "probe",
        responses: { wall: "block" },
      },
    );

    expect(found).toHaveLength(1);
  });

  it("answers empty for a degenerate query shape", () => {
    const world = makeWorld();
    const wall = world.actor(0, 0);
    world.collider(wall, {
      shape: { kind: "rect", width: 10, height: 10 },
      channel: "wall",
    });

    const found = world.system.query(
      { kind: "circle", radius: 0 },
      { x: 0, y: 0 },
      {
        channel: "probe",
        responses: { wall: "block" },
      },
    );

    expect(found).toEqual([]);
  });
});

describe("CollisionWorld.raycast", () => {
  it("returns the nearest hit, so a wall answers before what is behind it", () => {
    const world = makeWorld();
    const guard = world.actor(0, 0);
    world.collider(guard, {
      shape: { kind: "circle", radius: 4 },
      channel: "guard",
    });
    const player = world.actor(60, 0);
    world.collider(player, {
      shape: { kind: "circle", radius: 4 },
      channel: "player",
    });
    const wall = world.actor(30, 0);
    const wallCollider = world.collider(wall, {
      shape: { kind: "rect", width: 4, height: 40 },
      channel: "wall",
    });

    const hit = world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, {
      channel: "vision",
      responses: { player: "block", wall: "block" },
      ignore: [guard as unknown as Actor],
    });

    expect(hit).not.toBeNull();
    expect(hit!.actor).toBe(wall as unknown as Actor);
    expect(hit!.collider).toBe(wallCollider);
    expect(hit!.distance).toBeCloseTo(28);
    expect(hit!.point.x).toBeCloseTo(28);
    expect(hit!.point.y).toBeCloseTo(0);
    expect(hit!.normal.x).toBeCloseTo(-1);
    expect(hit!.normal.y).toBeCloseTo(0);
  });

  it("carries the circle's surface point and normal", () => {
    const world = makeWorld();
    const target = world.actor(20, 0);
    world.collider(target, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });

    const hit = world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 100);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(15);
    expect(hit!.point.x).toBeCloseTo(15);
    expect(hit!.normal.x).toBeCloseTo(-1);
    expect(hit!.normal.y).toBeCloseTo(0);
  });

  it("is bounded by distance", () => {
    const world = makeWorld();
    const target = world.actor(20, 0);
    world.collider(target, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });

    expect(world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 14)).toBeNull();
    expect(
      world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 16),
    ).not.toBeNull();
  });

  it("passes through colliders the resolution ignores", () => {
    const world = makeWorld();
    const ghost = world.actor(10, 0);
    world.collider(ghost, {
      shape: { kind: "circle", radius: 4 },
      channel: "ghost",
    });
    const wall = world.actor(30, 0);
    world.collider(wall, {
      shape: { kind: "circle", radius: 4 },
      channel: "wall",
    });

    const hit = world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, {
      channel: "vision",
      responses: { wall: "block" },
    });

    // The nearer ghost answers no channel of the query's, so the wall is the
    // first thing the ray meets.
    expect(hit!.actor).toBe(wall as unknown as Actor);
  });

  it("reports a ray that starts inside a shape at distance zero, facing back", () => {
    const world = makeWorld();
    const room = world.actor(0, 0);
    world.collider(room, {
      shape: { kind: "rect", width: 100, height: 100 },
      responses: { default: "block" },
    });

    const hit = world.system.raycast({ x: 10, y: 10 }, { x: 1, y: 0 }, 100);

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBe(0);
    expect(hit!.point).toEqual({ x: 10, y: 10 });
    expect(hit!.normal).toEqual({ x: -1, y: 0 });
  });

  it("misses a shape behind the origin, and returns null on nothing", () => {
    const world = makeWorld();
    const behind = world.actor(-20, 0);
    world.collider(behind, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });

    expect(
      world.system.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 100),
    ).toBeNull();
  });
});

describe("CollisionWorld.raycastAll", () => {
  it("returns every hit in increasing distance, each at its own entry point", () => {
    const world = makeWorld();
    // Enumeration order deliberately disagrees with ray order.
    const far = world.actor(60, 0);
    world.collider(far, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });
    const near = world.actor(20, 0);
    world.collider(near, {
      shape: { kind: "circle", radius: 5 },
      responses: { default: "block" },
    });

    const hits = world.system.raycastAll({ x: 0, y: 0 }, { x: 1, y: 0 }, 100);

    expect(hits.map((h) => h.actor)).toEqual([
      near as unknown as Actor,
      far as unknown as Actor,
    ]);
    expect(hits[0]!.distance).toBeCloseTo(15);
    expect(hits[1]!.distance).toBeCloseTo(55);
  });

  it("applies the same filter and bound a raycast does", () => {
    const world = makeWorld();
    const ghost = world.actor(10, 0);
    world.collider(ghost, {
      shape: { kind: "circle", radius: 4 },
      channel: "ghost",
    });
    const wall = world.actor(30, 0);
    world.collider(wall, {
      shape: { kind: "circle", radius: 4 },
      channel: "wall",
    });
    const beyond = world.actor(300, 0);
    world.collider(beyond, {
      shape: { kind: "circle", radius: 4 },
      channel: "wall",
    });

    const hits = world.system.raycastAll({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, {
      channel: "vision",
      responses: { wall: "block" },
    });

    expect(hits.map((h) => h.actor)).toEqual([wall as unknown as Actor]);
  });

  it("returns empty when the ray meets nothing", () => {
    const world = makeWorld();

    expect(
      world.system.raycastAll({ x: 0, y: 0 }, { x: 1, y: 0 }, 100),
    ).toEqual([]);
  });
});

describe("the example's collision matrix", () => {
  // The constants from the collision-and-events example, verbatim, so the
  // documented calling code is known to compile and behave against this
  // implementation.
  const CHANNEL = {
    ball: "ball",
    brick: "brick",
    paddle: "paddle",
    wall: "wall",
    floor: "floor",
  } as const;
  const BLOCK = { [CHANNEL.ball]: "block" } as const;
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
    shape: { kind: "rect", width: 640, height: 16 },
    channel: CHANNEL.floor,
    responses: { [CHANNEL.ball]: "overlap" },
  };

  it("blocks the ball against a brick and overlaps it with the floor", () => {
    const world = makeWorld();
    const ball = world.actor(0, 0);
    world.collider(ball, BALL_COLLIDER);
    const brick = world.actor(0, -10);
    world.collider(brick, BRICK_COLLIDER);
    const floor = world.actor(0, 400);
    world.collider(floor, FLOOR_COLLIDER);

    world.system.pass();
    expect(names(world.events)).toEqual(["hit"]);

    // The ball falls to the floor: the brick pair ends silently (it was a
    // block, not an overlap) and the floor pair begins.
    ball.transform.y = 400;
    world.system.pass();

    expect(names(world.events)).toEqual(["hit", "overlap:begin"]);
  });
});
