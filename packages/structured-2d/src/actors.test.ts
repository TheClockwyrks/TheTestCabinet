import { describe, expect, it } from "vitest";
import {
  Actor,
  Pawn,
  actorHasBegunPlay,
  attachActorToWorld,
  beginActorPlay,
  endActorPlay,
} from "./actors";
import { Component } from "./components";
import type { EndPlayReason, World } from "./contract";
import { Controller } from "./controllers";

/**
 * A stand-in world. The actor module never calls into the world — it only
 * carries the reference the wiring assigned — so an empty object cast to the
 * interface is the whole double.
 */
function fakeWorld(): World {
  return {} as World;
}

/**
 * A component that writes each lifecycle call into a shared log, so a test
 * asserts ordering across an actor and several components with one array.
 */
class LogComponent extends Component {
  constructor(
    private readonly log: string[],
    private readonly name: string,
  ) {
    super();
  }

  override beginPlay(): void {
    this.log.push(`${this.name}:begin`);
  }

  override tick(dt: number): void {
    this.log.push(`${this.name}:tick:${dt}`);
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
  it("starts at the documented transform defaults", () => {
    const actor = new Actor();

    expect(actor.transform).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
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

  it("keeps the transform mutable in place", () => {
    const actor = new Actor();

    actor.transform.x = 24;
    actor.transform.rotation = Math.PI;

    expect(actor.transform.x).toBe(24);
    expect(actor.transform.rotation).toBe(Math.PI);
  });
});

describe("Actor.attach", () => {
  it("returns the component it was given, so a field assigns and attaches in one statement", () => {
    const actor = new Actor();
    const component = new Component();

    expect(actor.attach(component)).toBe(component);
  });

  it("assigns the component's actor before anything else runs on it", () => {
    const actor = new Actor();
    const component = actor.attach(new Component());

    expect(component.actor).toBe(actor);
  });

  it("lists components in attachment order", () => {
    const actor = new Actor();
    const first = actor.attach(new Component());
    const second = actor.attach(new Component());
    const third = actor.attach(new Component());

    expect(actor.components).toEqual([first, second, third]);
  });

  it("does not run beginPlay while the actor has not begun play", () => {
    const log: string[] = [];
    const actor = new Actor();

    actor.attach(new LogComponent(log, "a"));

    expect(log).toEqual([]);
  });

  it("runs beginPlay before returning once the actor has begun play", () => {
    const log: string[] = [];
    const actor = new LogActor(log);
    attachActorToWorld(actor, fakeWorld(), 1);
    beginActorPlay(actor);

    actor.attach(new LogComponent(log, "late"));

    expect(log).toEqual(["actor:begin", "late:begin"]);
  });

  it("refuses to attach the same component twice", () => {
    const actor = new Actor();
    const component = actor.attach(new Component());

    expect(() => actor.attach(component)).toThrow(/exactly one actor/);
  });

  it("refuses to attach a component another actor already holds", () => {
    const component = new Component();
    new Actor().attach(component);

    expect(() => new Actor().attach(component)).toThrow(/exactly one actor/);
  });

  it("refuses to re-attach a detached component — one actor for its lifetime", () => {
    const actor = new Actor();
    const component = actor.attach(new Component());
    actor.detach(component);

    expect(() => new Actor().attach(component)).toThrow(/exactly one actor/);
  });
});

describe("Actor.detach", () => {
  it('runs endPlay("destroyed") and then removes the component', () => {
    const log: string[] = [];
    const actor = new Actor();
    const component = actor.attach(new LogComponent(log, "a"));

    actor.detach(component);

    expect(log).toEqual(["a:end:destroyed"]);
    expect(actor.components).toEqual([]);
  });

  it("keeps the component attached while its endPlay runs, so it can read the actor it is leaving", () => {
    const actor = new Actor();
    let attachedDuringEnd: boolean | null = null;

    class Watcher extends Component {
      override endPlay(): void {
        attachedDuringEnd = this.actor.components.includes(this);
      }
    }

    actor.detach(actor.attach(new Watcher()));

    expect(attachedDuringEnd).toBe(true);
  });

  it("leaves a component this actor does not hold alone", () => {
    const log: string[] = [];
    const actor = new Actor();
    const stranger = new LogComponent(log, "stranger");

    expect(() => actor.detach(stranger)).not.toThrow();
    expect(log).toEqual([]);
  });

  it("survives a component detaching a sibling from its own teardown", () => {
    const log: string[] = [];
    const actor = new Actor();
    const second = actor.attach(new LogComponent(log, "second"));

    class Chained extends Component {
      override endPlay(): void {
        log.push("first:end");
        actor.detach(second);
      }
    }
    const first = new Chained();
    actor.attach(first);
    // Move the chained component in front so its teardown removes a later entry.
    actor.detach(first);

    expect(log).toEqual(["first:end", "second:end:destroyed"]);
    expect(actor.components).toEqual([]);
  });
});

describe("Actor.component and Actor.componentsOf", () => {
  class Body extends Component {}
  class Trim extends Component {}

  it("finds the first component of a type, in attachment order", () => {
    const actor = new Actor();
    const first = actor.attach(new Body());
    actor.attach(new Body());

    expect(actor.component(Body)).toBe(first);
  });

  it("returns null when no component matches", () => {
    const actor = new Actor();
    actor.attach(new Body());

    expect(actor.component(Trim)).toBeNull();
  });

  it("matches subclasses, because selection is instanceof", () => {
    class Armored extends Body {}
    const actor = new Actor();
    const armored = actor.attach(new Armored());

    expect(actor.component(Body)).toBe(armored);
  });

  it("lists every match in attachment order and nothing else", () => {
    const actor = new Actor();
    const a = actor.attach(new Body());
    actor.attach(new Trim());
    const b = actor.attach(new Body());

    expect(actor.componentsOf(Body)).toEqual([a, b]);
    expect(actor.componentsOf(Trim)).toHaveLength(1);
  });

  it("returns a fresh array from componentsOf, so the caller may keep it", () => {
    const actor = new Actor();
    actor.attach(new Body());
    const kept = actor.componentsOf(Body);

    actor.attach(new Body());

    expect(kept).toHaveLength(1);
    expect(actor.componentsOf(Body)).toHaveLength(2);
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
    actor.attach(new LogComponent(log, "a"));
    actor.attach(new LogComponent(log, "b"));
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["actor:begin", "a:begin", "b:begin"]);
    expect(actorHasBegunPlay(actor)).toBe(true);
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
        this.attach(new LogComponent(log, "grown"));
      }
    }

    const actor = new Grower();
    actor.attach(new LogComponent(log, "built"));
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["actor:begin", "built:begin", "grown:begin"]);
  });

  it("begins a component attached from a sibling component's beginPlay", () => {
    const log: string[] = [];
    const actor = new Actor();

    class Chainer extends Component {
      override beginPlay(): void {
        log.push("chainer:begin");
        this.actor.attach(new LogComponent(log, "chained"));
      }
    }

    actor.attach(new Chainer());
    attachActorToWorld(actor, fakeWorld(), 1);

    beginActorPlay(actor);

    expect(log).toEqual(["chainer:begin", "chained:begin"]);
  });

  it("is idempotent — a second pass begins nothing again", () => {
    const log: string[] = [];
    const actor = new LogActor(log);
    actor.attach(new LogComponent(log, "a"));
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
    actor.attach(new LogComponent(log, "a"));
    actor.attach(new LogComponent(log, "b"));
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
    actor.attach(new LogComponent(log, "a"));
    beginActorPlay(actor);
    log.length = 0;

    actor.destroy();
    endActorPlay(actor, "destroyed");

    expect(log).toEqual(["a:end:destroyed", "actor:end:destroyed"]);
  });

  it("skips a component already ended by detach", () => {
    const log: string[] = [];
    const actor = begunActor(log);
    const detached = actor.attach(new LogComponent(log, "detached"));
    actor.attach(new LogComponent(log, "kept"));
    beginActorPlay(actor);
    actor.detach(detached);
    log.length = 0;

    endActorPlay(actor, "level-closed");

    expect(log).toEqual(["kept:end:level-closed", "actor:end:level-closed"]);
  });

  it("is idempotent — end play runs once whatever ends it", () => {
    const log: string[] = [];
    const actor = begunActor(log);
    actor.attach(new LogComponent(log, "a"));
    beginActorPlay(actor);
    log.length = 0;

    endActorPlay(actor, "destroyed");
    endActorPlay(actor, "level-closed");

    expect(log).toEqual(["a:end:destroyed", "actor:end:destroyed"]);
  });

  it("survives a component detaching a sibling during teardown", () => {
    const log: string[] = [];
    const actor = begunActor(log);

    class Sweeper extends Component {
      constructor(private readonly victim: () => Component) {
        super();
      }

      override endPlay(): void {
        log.push("sweeper:end");
        this.actor.detach(this.victim());
      }
    }

    const victim = new LogComponent(log, "victim");
    actor.attach(new Sweeper(() => victim));
    actor.attach(victim);
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

    expect(() => pawn.possessedBy(new Controller())).not.toThrow();
    expect(() => pawn.unpossessed()).not.toThrow();
  });

  it("carries a transform, components, and tags like any actor", () => {
    const pawn = new Pawn();
    const body = pawn.attach(new Component());
    pawn.addTag("paddle");
    pawn.transform.y = 180;

    expect(pawn.components).toEqual([body]);
    expect(pawn.hasTag("paddle")).toBe(true);
    expect(pawn.transform.y).toBe(180);
  });
});
