import { describe, expect, it } from "vitest";
import type { ActorClass } from "./actors";
import {
  Actor,
  Pawn,
  actorHasBegunPlay,
  attachActorToWorld,
  beginActorPlay,
  endActorPlay,
} from "./actors";
import type { Component, ComponentClass } from "./components";
import type { EndPlayReason } from "./contract";
import type { Controller } from "./controllers";
import {
  QUAT_IDENTITY,
  VEC3_ONE,
  VEC3_ZERO,
  quatFromEuler,
  vec3,
} from "./math";
import type { World } from "./worlds";

/**
 * A stand-in world. The actor module never calls into the world — it only
 * carries the reference the wiring assigned — so an empty object cast to the
 * interface is the whole double.
 */
function fakeWorld(): World {
  return {} as World;
}

/**
 * A stand-in controller, for the two possession notifications a pawn carries.
 * The base implementations do nothing with it, so nothing is read off it.
 */
function fakeController(): Controller {
  return {} as Controller;
}

/**
 * A stand-in for `Component`.
 *
 * The component module lands in the next phase. Until it does the double is
 * written against what the actor module actually touches: it assigns `actor`,
 * calls `beginPlay` and `endPlay`, and selects with `instanceof`. That is the
 * whole of the seam between the two classes, so a fuller double would only
 * duplicate the specification of a class this suite does not test.
 */
class TestComponent {
  declare readonly actor: Actor;

  beginPlay(): void {}

  endPlay(reason: EndPlayReason): void {
    void reason;
  }
}

/** A stand-in component's class, as `component` and `componentsOf` select by. */
type TestComponentClass<C extends TestComponent> = new (...args: never[]) => C;

/*
 * `Actor`'s component members are typed against the real `Component`, which the
 * next phase declares. The four helpers below hold every cast from the stand-in
 * to it, in one place, so the tests themselves read as ordinary calls and keep
 * compiling unchanged once the real class arrives.
 */

/** `actor.attach`, handing the stand-in back at its own type. */
function attach<C extends TestComponent>(actor: Actor, component: C): C {
  return actor.attach(component as unknown as Component) as unknown as C;
}

/** `actor.detach`, for a stand-in. */
function detach(actor: Actor, component: TestComponent): void {
  actor.detach(component as unknown as Component);
}

/** `actor.component`, for a stand-in class. */
function findComponent<C extends TestComponent>(
  actor: Actor,
  type: TestComponentClass<C>,
): C | null {
  const selector = type as unknown as ComponentClass<Component>;
  return actor.component(selector) as unknown as C | null;
}

/** `actor.componentsOf`, for a stand-in class. */
function findComponents<C extends TestComponent>(
  actor: Actor,
  type: TestComponentClass<C>,
): readonly C[] {
  const selector = type as unknown as ComponentClass<Component>;
  return actor.componentsOf(selector) as unknown as readonly C[];
}

/**
 * A component that writes each lifecycle call into a shared log, so a test
 * asserts ordering across an actor and several components with one array.
 */
class LogComponent extends TestComponent {
  constructor(
    private readonly log: string[],
    private readonly name: string,
  ) {
    super();
  }

  override beginPlay(): void {
    this.log.push(`${this.name}:begin`);
  }

  override endPlay(reason: EndPlayReason): void {
    this.log.push(`${this.name}:end:${reason}`);
  }
}

/** An actor that logs its own lifecycle beside its components'. */
class LogActor extends Actor {
  constructor(readonly log: string[] = []) {
    super();
  }

  override beginPlay(): void {
    this.log.push("actor:begin");
  }

  override endPlay(reason: EndPlayReason): void {
    this.log.push(`actor:end:${reason}`);
  }
}

describe("Actor defaults", () => {
  it("starts at the identity transform", () => {
    const actor = new Actor();

    expect(actor.transform).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("gives every actor its own nested records, not the frozen math constants", () => {
    const first = new Actor();
    const second = new Actor();

    expect(first.transform.position).not.toBe(second.transform.position);
    expect(first.transform.position).not.toBe(VEC3_ZERO);
    expect(first.transform.rotation).not.toBe(QUAT_IDENTITY);
    expect(first.transform.scale).not.toBe(VEC3_ONE);

    first.transform.position.x = 5;

    expect(second.transform.position.x).toBe(0);
    expect(VEC3_ZERO.x).toBe(0);
  });

  it("is alive, ticking, and not ticking-while-paused", () => {
    const actor = new Actor();

    expect(actor.alive).toBe(true);
    expect(actor.tickEnabled).toBe(true);
    expect(actor.tickWhenPaused).toBe(false);
  });

  it("holds no components and no tags", () => {
    const actor = new Actor();

    expect(actor.components).toEqual([]);
    expect(actor.tags.size).toBe(0);
  });

  it("has do-nothing base lifecycle methods", () => {
    const actor = new Actor();

    expect(() => actor.beginPlay()).not.toThrow();
    expect(() => actor.tick(1 / 60)).not.toThrow();
    expect(() => actor.endPlay("destroyed")).not.toThrow();
  });

  it("keeps the transform mutable in place, whole records and single fields alike", () => {
    const actor = new Actor();
    const rotation = quatFromEuler(0, Math.PI / 2, 0);

    actor.transform.position = vec3(3, 4, -5);
    actor.transform.rotation = rotation;
    actor.transform.scale.y = 2;

    expect(actor.transform.position).toEqual({ x: 3, y: 4, z: -5 });
    expect(actor.transform.rotation).toBe(rotation);
    expect(actor.transform.scale).toEqual({ x: 1, y: 2, z: 1 });
  });
});

describe("ActorClass", () => {
  it("names a zero-argument constructor, which is what a level spec holds", () => {
    class Brick extends Actor {}
    const type: ActorClass<Brick> = Brick;

    const brick = new type();

    expect(brick).toBeInstanceOf(Brick);
    expect(brick).toBeInstanceOf(Actor);
  });
});

describe("Actor.attach", () => {
  it("returns the component it was given, so a field assigns and attaches in one statement", () => {
    const actor = new Actor();
    const component = new TestComponent();

    expect(attach(actor, component)).toBe(component);
  });

  it("assigns the component's actor before anything else runs on it", () => {
    const actor = new Actor();
    const component = attach(actor, new TestComponent());

    expect(component.actor).toBe(actor);
  });

  it("lists components in attachment order", () => {
    const actor = new Actor();
    const first = attach(actor, new TestComponent());
    const second = attach(actor, new TestComponent());
    const third = attach(actor, new TestComponent());

    expect(actor.components).toEqual([first, second, third]);
  });

  it("does not run beginPlay while the actor has not begun play", () => {
    const log: string[] = [];
    const actor = new Actor();

    attach(actor, new LogComponent(log, "a"));

    expect(log).toEqual([]);
  });

  it("runs beginPlay before returning once the actor has begun play", () => {
    const log: string[] = [];
    const actor = new LogActor(log);
    attachActorToWorld(actor, fakeWorld(), 1);
    beginActorPlay(actor);

    attach(actor, new LogComponent(log, "late"));

    expect(log).toEqual(["actor:begin", "late:begin"]);
  });

  it("refuses to attach the same component twice", () => {
    const actor = new Actor();
    const component = attach(actor, new TestComponent());

    expect(() => attach(actor, component)).toThrow(/exactly one actor/);
  });

  it("refuses to attach a component another actor already holds", () => {
    const component = new TestComponent();
    attach(new Actor(), component);

    expect(() => attach(new Actor(), component)).toThrow(/exactly one actor/);
  });

  it("refuses to re-attach a detached component — one actor for its lifetime", () => {
    const actor = new Actor();
    const component = attach(actor, new TestComponent());
    detach(actor, component);

    expect(() => attach(new Actor(), component)).toThrow(/exactly one actor/);
  });
});

describe("Actor.detach", () => {
  it('runs endPlay("destroyed") and then removes the component', () => {
    const log: string[] = [];
    const actor = new Actor();
    const component = attach(actor, new LogComponent(log, "a"));

    detach(actor, component);

    expect(log).toEqual(["a:end:destroyed"]);
    expect(actor.components).toEqual([]);
  });

  it("keeps the component attached while its endPlay runs, so it can read the actor it is leaving", () => {
    const actor = new Actor();
    let attachedDuringEnd: boolean | null = null;

    class Watcher extends TestComponent {
      override endPlay(): void {
        attachedDuringEnd = this.actor.components.includes(
          this as unknown as Component,
        );
      }
    }

    detach(actor, attach(actor, new Watcher()));

    expect(attachedDuringEnd).toBe(true);
  });

  it("leaves a component this actor does not hold alone", () => {
    const log: string[] = [];
    const actor = new Actor();
    const stranger = new LogComponent(log, "stranger");

    expect(() => detach(actor, stranger)).not.toThrow();
    expect(log).toEqual([]);
  });

  it("survives a component detaching a sibling from its own teardown", () => {
    const log: string[] = [];
    const actor = new Actor();
    const second = attach(actor, new LogComponent(log, "second"));

    class Chained extends TestComponent {
      override endPlay(): void {
        log.push("first:end");
        detach(actor, second);
      }
    }
    const first = new Chained();
    attach(actor, first);
    // Move the chained component in front so its teardown removes a later entry.
    detach(actor, first);

    expect(log).toEqual(["first:end", "second:end:destroyed"]);
    expect(actor.components).toEqual([]);
  });
});

describe("Actor.component and Actor.componentsOf", () => {
  class Body extends TestComponent {}
  class Trim extends TestComponent {}

  it("finds the first component of a type, in attachment order", () => {
    const actor = new Actor();
    const first = attach(actor, new Body());
    attach(actor, new Body());

    expect(findComponent(actor, Body)).toBe(first);
  });

  it("returns null when no component matches", () => {
    const actor = new Actor();
    attach(actor, new Body());

    expect(findComponent(actor, Trim)).toBeNull();
  });

  it("matches subclasses, because selection is instanceof", () => {
    class Armored extends Body {}
    const actor = new Actor();
    const armored = attach(actor, new Armored());

    expect(findComponent(actor, Body)).toBe(armored);
  });

  it("lists every match in attachment order and nothing else", () => {
    const actor = new Actor();
    const a = attach(actor, new Body());
    attach(actor, new Trim());
    const b = attach(actor, new Body());

    expect(findComponents(actor, Body)).toEqual([a, b]);
    expect(findComponents(actor, Trim)).toHaveLength(1);
  });

  it("returns a fresh array from componentsOf, so the caller may keep it", () => {
    const actor = new Actor();
    attach(actor, new Body());
    const kept = findComponents(actor, Body);

    attach(actor, new Body());

    expect(kept).toHaveLength(1);
    expect(findComponents(actor, Body)).toHaveLength(2);
  });
});

describe("Actor tags", () => {
  it("adds, reports, and removes tags", () => {
    const actor = new Actor();

    actor.addTag("brick");
    expect(actor.hasTag("brick")).toBe(true);
    expect(actor.tags.has("brick")).toBe(true);

    actor.removeTag("brick");
    expect(actor.hasTag("brick")).toBe(false);
    expect(actor.tags.size).toBe(0);
  });

  it("treats a duplicate add and a missing remove as no-ops", () => {
    const actor = new Actor();

    actor.addTag("brick");
    actor.addTag("brick");
    expect(actor.tags.size).toBe(1);

    expect(() => actor.removeTag("absent")).not.toThrow();
  });
});

describe("Actor.destroy", () => {
  it("flips alive at once", () => {
    const actor = new Actor();

    actor.destroy();

    expect(actor.alive).toBe(false);
  });

  it("does not run endPlay — removal is deferred to the world's end of frame", () => {
    const actor = new LogActor();

    actor.destroy();

    expect(actor.log).toEqual([]);
  });

  it("leaves the transform and the components readable, for the rest of the frame", () => {
    const actor = new Actor();
    const body = attach(actor, new TestComponent());
    actor.transform.position = vec3(1, 2, 3);

    actor.destroy();

    expect(actor.components).toEqual([body]);
    expect(actor.transform.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("reports to the world's onDestroyed hook exactly once", () => {
    const actor = new Actor();
    const reported: Actor[] = [];
    attachActorToWorld(actor, fakeWorld(), 1, (a) => reported.push(a));

    actor.destroy();
    actor.destroy();

    expect(reported).toEqual([actor]);
    expect(actor.alive).toBe(false);
  });

  it("works on an actor that never joined a world", () => {
    const actor = new Actor();

    expect(() => actor.destroy()).not.toThrow();
    expect(actor.alive).toBe(false);
  });
});

describe("attachActorToWorld", () => {
  it("assigns the world and the id before beginPlay", () => {
    const world = fakeWorld();
    const actor = new Actor();

    attachActorToWorld(actor, world, 7);

    expect(actor.world).toBe(world);
    expect(actor.id).toBe(7);
  });

  it("refuses a second wiring — an actor spawns once", () => {
    const actor = new Actor();
    attachActorToWorld(actor, fakeWorld(), 1);

    expect(() => attachActorToWorld(actor, fakeWorld(), 2)).toThrow(
      /spawns once/,
    );
  });
});

describe("beginActorPlay", () => {
  it("runs the actor's beginPlay, then each component's, in attachment order", () => {
    const log: string[] = [];
    const actor = new LogActor(log);
    attach(actor, new LogComponent(log, "a"));
    attach(actor, new LogComponent(log, "b"));
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["actor:begin", "a:begin", "b:begin"]);
    expect(actorHasBegunPlay(actor)).toBe(true);
  });

  it("reports an actor as not begun until the pass has run", () => {
    const actor = new Actor();
    attachActorToWorld(actor, fakeWorld(), 1);

    expect(actorHasBegunPlay(actor)).toBe(false);
  });

  it("gives the actor its world before its beginPlay reads it", () => {
    const world = fakeWorld();
    let seen: World | null = null;

    class Reader extends Actor {
      override beginPlay(): void {
        seen = this.world;
      }
    }

    const actor = new Reader();
    attachActorToWorld(actor, world, 1);
    beginActorPlay(actor);

    expect(seen).toBe(world);
  });

  it("begins a component attached from the actor's own beginPlay, exactly once", () => {
    const log: string[] = [];

    class Grower extends Actor {
      override beginPlay(): void {
        log.push("actor:begin");
        attach(this, new LogComponent(log, "grown"));
      }
    }

    const actor = new Grower();
    attach(actor, new LogComponent(log, "built"));
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["actor:begin", "built:begin", "grown:begin"]);
  });

  it("begins a component attached from a sibling component's beginPlay", () => {
    const log: string[] = [];
    const actor = new Actor();

    class Chainer extends TestComponent {
      override beginPlay(): void {
        log.push("chainer:begin");
        attach(this.actor, new LogComponent(log, "chained"));
      }
    }

    attach(actor, new Chainer());
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["chainer:begin", "chained:begin"]);
  });

  it("is idempotent — a second pass begins nothing again", () => {
    const log: string[] = [];
    const actor = new LogActor(log);
    attach(actor, new LogComponent(log, "a"));
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);
    beginActorPlay(actor);

    expect(log).toEqual(["actor:begin", "a:begin"]);
  });
});

describe("endActorPlay", () => {
  function begunActor(log: string[]): LogActor {
    const actor = new LogActor(log);
    attachActorToWorld(actor, fakeWorld(), 1);
    return actor;
  }

  it("runs each component's endPlay, then the actor's, with the reason", () => {
    const log: string[] = [];
    const actor = begunActor(log);
    attach(actor, new LogComponent(log, "a"));
    attach(actor, new LogComponent(log, "b"));
    beginActorPlay(actor);
    log.length = 0;

    endActorPlay(actor, "level-closed");

    expect(log).toEqual([
      "a:end:level-closed",
      "b:end:level-closed",
      "actor:end:level-closed",
    ]);
  });

  it('passes "destroyed" through for a destroyed actor\'s teardown', () => {
    const log: string[] = [];
    const actor = begunActor(log);
    attach(actor, new LogComponent(log, "a"));
    beginActorPlay(actor);
    log.length = 0;

    actor.destroy();
    endActorPlay(actor, "destroyed");

    expect(log).toEqual(["a:end:destroyed", "actor:end:destroyed"]);
  });

  it("skips a component already ended by detach", () => {
    const log: string[] = [];
    const actor = begunActor(log);
    const detached = attach(actor, new LogComponent(log, "detached"));
    attach(actor, new LogComponent(log, "kept"));
    beginActorPlay(actor);
    detach(actor, detached);
    log.length = 0;

    endActorPlay(actor, "level-closed");

    expect(log).toEqual(["kept:end:level-closed", "actor:end:level-closed"]);
  });

  it("is idempotent — end play runs once whatever ends it", () => {
    const log: string[] = [];
    const actor = begunActor(log);
    attach(actor, new LogComponent(log, "a"));
    beginActorPlay(actor);
    log.length = 0;

    endActorPlay(actor, "destroyed");
    endActorPlay(actor, "level-closed");

    expect(log).toEqual(["a:end:destroyed", "actor:end:destroyed"]);
  });

  it("survives a component detaching a sibling during teardown", () => {
    const log: string[] = [];
    const actor = begunActor(log);

    class Sweeper extends TestComponent {
      constructor(private readonly victim: () => TestComponent) {
        super();
      }

      override endPlay(): void {
        log.push("sweeper:end");
        detach(this.actor, this.victim());
      }
    }

    const victim = new LogComponent(log, "victim");
    attach(actor, new Sweeper(() => victim));
    attach(actor, victim);
    beginActorPlay(actor);
    log.length = 0;

    endActorPlay(actor, "level-closed");

    // The sweeper's detach ends the victim with "destroyed"; the pass then
    // finds it already ended and moves on to the actor.
    expect(log).toEqual([
      "sweeper:end",
      "victim:end:destroyed",
      "actor:end:level-closed",
    ]);
  });
});

describe("Pawn", () => {
  it("is an actor holding no controller", () => {
    const pawn = new Pawn();

    expect(pawn).toBeInstanceOf(Actor);
    expect(pawn.controller).toBeNull();
    expect(pawn.alive).toBe(true);
  });

  it("has do-nothing base possession notifications", () => {
    const pawn = new Pawn();

    expect(() => pawn.possessedBy(fakeController())).not.toThrow();
    expect(() => pawn.unpossessed()).not.toThrow();
  });

  it("carries a transform, components, and tags like any actor", () => {
    const pawn = new Pawn();
    const body = attach(pawn, new TestComponent());
    pawn.addTag("rover");
    pawn.transform.position = vec3(0, 1.8, 0);

    expect(pawn.components).toEqual([body]);
    expect(pawn.hasTag("rover")).toBe(true);
    expect(pawn.transform.position).toEqual({ x: 0, y: 1.8, z: 0 });
  });

  it("takes part in the same lifecycle as any other actor", () => {
    const log: string[] = [];

    class LogPawn extends Pawn {
      override beginPlay(): void {
        log.push("pawn:begin");
      }

      override endPlay(reason: EndPlayReason): void {
        log.push(`pawn:end:${reason}`);
      }
    }

    const pawn = new LogPawn();
    attach(pawn, new LogComponent(log, "wheel"));
    attachActorToWorld(pawn, fakeWorld(), 3);

    beginActorPlay(pawn);
    endActorPlay(pawn, "level-closed");

    expect(log).toEqual([
      "pawn:begin",
      "wheel:begin",
      "wheel:end:level-closed",
      "pawn:end:level-closed",
    ]);
    expect(pawn.id).toBe(3);
  });
});
