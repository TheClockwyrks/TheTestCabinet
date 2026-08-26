/**
 * Actors: the things in a world.
 *
 * An actor carries a transform, holds components, and takes part in every frame
 * in spawn order. A game writes its own actors by subclassing {@link Actor},
 * attaching components in the constructor, and overriding the lifecycle methods
 * it needs; the engine constructs each one, applies the spec it was spawned
 * from, ticks it, renders its components, and ends its play.
 *
 * The lifecycle rules a subclass leans on, stated once:
 *
 * - **A constructor runs before the actor has a world.** It attaches components
 *   and sets defaults; anything that reads the world belongs in `beginPlay`.
 *   `world` is assigned once the constructor has returned and before
 *   `beginPlay` runs.
 * - **Every actor a level declares exists before any of their `beginPlay`
 *   runs**, and those calls run in spawn order, so an actor finds its peers
 *   there — through `world.byTag`, `world.ofType`, or `world.find` — regardless
 *   of declaration order.
 * - **Destruction is deferred.** `destroy` marks the actor: `alive` becomes
 *   `false` at once (it stops ticking, rendering, and colliding immediately),
 *   and it leaves the world at the end of the frame, so a tick never observes a
 *   half-removed world.
 *
 * The class itself owns everything actor-local — the component list, the tags,
 * the alive bit — while the world's side of the contract (ids, spawn order,
 * the deferred removal, the `actor:spawned` / `actor:destroyed` events) is
 * driven through the internal wiring seams at the bottom of this module, which
 * the worlds subsystem calls and a game never sees.
 *
 * Everything here mirrors the `actors` API page under
 * `docs/engines/structured-3d/apis/` — that page is the specification, and a
 * member that disagrees with it is wrong.
 */

import type { Component, ComponentClass } from "./components";
import type { Controller } from "./controllers";
import type { Transform } from "./math";
import type { World } from "./worlds";

/**
 * An actor class the world can construct: no constructor arguments. The world
 * constructs it and then applies the spec it was spawned from, so a spec's
 * `configure` callback supplies whatever the instance needs before it begins
 * play.
 */
export type ActorClass<A extends Actor = Actor> = new () => A;

/**
 * Why an actor's, a component's, or a controller's play ended: `"destroyed"`
 * when the object itself was destroyed or detached, `"level-closed"` when the
 * world it belonged to closed.
 */
export type EndPlayReason = "destroyed" | "level-closed";

/* -------------------------------------------------------------------------- */
/* Module-private lifecycle bookkeeping                                       */
/* -------------------------------------------------------------------------- */

/**
 * The world-side wiring an actor is given when it is attached to a world:
 * where it belongs, the id it was assigned, and the hook `destroy` reports
 * through so the world can queue the removal for the end of the frame.
 */
interface ActorWiring {
  world: World;
  id: number;
  onDestroyed?: (actor: Actor) => void;
}

/**
 * Lifecycle state lives in module-scope weak collections rather than on the
 * classes, for one reason: the public surface of `Actor` and `Component` is
 * specified member for member by the docs, and a game subclasses both, so a
 * private-but-present field is a name a subclass can collide with. Weak keys
 * also mean a destroyed actor's bookkeeping goes with it.
 */
const wiringByActor = new WeakMap<Actor, ActorWiring>();

/** Actors whose `beginPlay` pass has completed. */
const begunActors = new WeakSet<Actor>();

/** Actors whose `endPlay` has run — it runs once, whatever ends the play. */
const endedActors = new WeakSet<Actor>();

/** Components ever handed to `attach` — a component attaches once, for life. */
const attachedComponents = new WeakSet<Component>();

/** Components whose `beginPlay` has run. */
const begunComponents = new WeakSet<Component>();

/** Components whose `endPlay` has run — detach and teardown must not repeat it. */
const endedComponents = new WeakSet<Component>();

/** Runs `component.beginPlay()` once, however many paths reach it. */
function beginComponentPlay(component: Component): void {
  if (begunComponents.has(component)) return;
  begunComponents.add(component);
  component.beginPlay();
}

/** Runs `component.endPlay(reason)` once, however many paths reach it. */
function endComponentPlay(component: Component, reason: EndPlayReason): void {
  if (endedComponents.has(component)) return;
  endedComponents.add(component);
  component.endPlay(reason);
}

/* -------------------------------------------------------------------------- */
/* Actor                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A thing in the world: a transform, a set of tags, and the components it is
 * assembled from.
 *
 * The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
 * overrides only what it needs.
 */
export class Actor {
  /**
   * The world the actor belongs to. Assigned by the engine after construction
   * and before `beginPlay`, so it is present for every line of code that runs
   * after construction.
   */
  declare readonly world: World;

  /** Unique within the world, assigned in spawn order from `1`. */
  declare readonly id: number;

  /**
   * The actor's own position, orientation, and scale, in world units,
   * composing scale, then rotation, then translation — the TRS order. Mutable
   * in place: movement is an assignment to `transform.position` or its
   * fields, and a turn is an assignment to `transform.rotation`, built with
   * `quatFromAxisAngle`. A spec's `Partial<Transform>` is written over these
   * defaults, each present field replacing the whole value.
   */
  readonly transform: Transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };

  /** `false` from the moment {@link destroy} is called. */
  readonly alive: boolean = true;

  /** Defaults to `true`. A `false` actor and its components skip their tick. */
  tickEnabled = true;

  /**
   * Defaults to `false`. A `true` actor ticks with its components while the
   * world is paused, which is how a pause menu drives itself.
   */
  tickWhenPaused = false;

  /**
   * The attached components, in attachment order.
   *
   * The backing array, typed read-only, rather than a copy: the render and
   * tick passes read this every frame for every actor, so the accessor must
   * not allocate. A pass that mutates while it walks — a component's tick
   * detaching a sibling — snapshots first, at the call site that knows it
   * will.
   */
  private readonly componentList: Component[] = [];

  /** The tags the actor carries, live. */
  private readonly tagSet = new Set<string>();

  /** The attached components, in attachment order. */
  get components(): readonly Component[] {
    return this.componentList;
  }

  /** The tags the actor carries. */
  get tags(): ReadonlySet<string> {
    return this.tagSet;
  }

  /** Runs once, after the actor has a world. The base does nothing. */
  beginPlay(): void {}

  /**
   * Runs once per frame, with the frame's delta in seconds, after every
   * controller has ticked and before the collision pass. The base does
   * nothing.
   */
  tick(dt: number): void {
    void dt;
  }

  /**
   * Runs once, with `"destroyed"` when the actor was destroyed and
   * `"level-closed"` when its world closed. The base does nothing.
   */
  endPlay(reason: EndPlayReason): void {
    void reason;
  }

  /**
   * Attaches the component and returns it. Attaching after `beginPlay` runs
   * the component's `beginPlay` before returning.
   *
   * A component belongs to exactly one actor for its lifetime, so handing one
   * to `attach` a second time — the same actor's or another's, before or
   * after a detach — is refused rather than silently rewiring it.
   */
  attach<C extends Component>(component: C): C {
    if (attachedComponents.has(component)) {
      throw new Error(
        "a component attaches to exactly one actor for its lifetime; " +
          "construct a new component instead of re-attaching this one",
      );
    }
    attachedComponents.add(component);

    // `actor` is assigned here, before `beginPlay` — the readonly is the
    // game's contract, not the engine's.
    (component as { actor: Actor }).actor = this;
    this.componentList.push(component);

    // During the level build every component begins play in the actor's own
    // begin-play pass; a component attached after that pass begins at once.
    if (begunActors.has(this)) beginComponentPlay(component);

    return component;
  }

  /**
   * Runs the component's `endPlay("destroyed")` and removes it. The component
   * is still attached while its `endPlay` runs, so it can read the actor it
   * is leaving; a component this actor does not hold is left alone.
   */
  detach(component: Component): void {
    const at = this.componentList.indexOf(component);
    if (at === -1) return;

    endComponentPlay(component, "destroyed");

    // The list may have shifted under `endPlay` (a component detaching a
    // sibling from its own teardown), so find the entry again before removing.
    const index = this.componentList.indexOf(component);
    if (index !== -1) this.componentList.splice(index, 1);
  }

  /** The first attached component that is an instance of `type`, or `null`. */
  component<C extends Component>(type: ComponentClass<C>): C | null {
    for (const candidate of this.componentList) {
      if (candidate instanceof type) return candidate;
    }
    return null;
  }

  /**
   * Every attached component that is an instance of `type`, in attachment
   * order, as a fresh array the caller owns.
   */
  componentsOf<C extends Component>(type: ComponentClass<C>): readonly C[] {
    return this.componentList.filter(
      (candidate): candidate is C => candidate instanceof type,
    );
  }

  /** Adds a tag to the actor. */
  addTag(tag: string): void {
    this.tagSet.add(tag);
  }

  /** Removes a tag from the actor. */
  removeTag(tag: string): void {
    this.tagSet.delete(tag);
  }

  /** Whether the actor carries the tag. */
  hasTag(tag: string): boolean {
    return this.tagSet.has(tag);
  }

  /**
   * Marks the actor. `alive` becomes `false` at once — a destroyed actor stops
   * ticking, rendering, and colliding immediately — and the actor leaves the
   * world at the end of the frame, when each component's and then the actor's
   * `endPlay("destroyed")` run and `actor:destroyed` is emitted.
   *
   * Idempotent: destroying a dead actor changes nothing and reports nothing.
   */
  destroy(): void {
    if (!this.alive) return;
    (this as { alive: boolean }).alive = false;
    wiringByActor.get(this)?.onDestroyed?.(this);
  }
}

/* -------------------------------------------------------------------------- */
/* Pawn                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An actor a controller may drive.
 *
 * A pawn is an actor in every other respect — it carries a transform, holds
 * components, and ticks in spawn order alongside everything else in the world.
 * {@link possessedBy} and {@link unpossessed} are notifications; possession
 * itself is the controller's call, and the base implementations do nothing.
 */
export class Pawn extends Actor {
  /**
   * The controller holding this pawn, or `null`. Written by the possession
   * machinery; a pawn reads it and never assigns it.
   */
  readonly controller: Controller | null = null;

  /** Notification that `controller` has taken the pawn. The base does nothing. */
  possessedBy(controller: Controller): void {
    void controller;
  }

  /** Notification that the pawn has been released. The base does nothing. */
  unpossessed(): void {}
}

/* -------------------------------------------------------------------------- */
/* Internal wiring seams                                                      */
/* -------------------------------------------------------------------------- */

/*
 * The functions below are the worlds subsystem's half of the actor lifecycle.
 * They are exported from this module for the engine's own wiring and are not
 * part of the package's public surface (the root entry point does not export
 * them); a game drives an actor only through the class members above.
 */

/**
 * Internal: give `actor` its world and its id, before its `beginPlay` runs.
 *
 * Called once per actor, by `world.spawn` and the level build, between
 * construction and the spec's application. `onDestroyed` is invoked from
 * {@link Actor.destroy} exactly once, at the moment the actor is marked, which
 * is where the world queues the deferred end-of-frame removal.
 *
 * @throws if `actor` already belongs to a world — an actor spawns once.
 */
export function attachActorToWorld(
  actor: Actor,
  world: World,
  id: number,
  onDestroyed?: (actor: Actor) => void,
): void {
  if (wiringByActor.has(actor)) {
    throw new Error("actor already belongs to a world; an actor spawns once");
  }
  wiringByActor.set(actor, { world, id, onDestroyed });
  (actor as { world: World }).world = world;
  (actor as { id: number }).id = id;
}

/**
 * Internal: run the actor's begin-play pass — the actor's own `beginPlay`,
 * then each attached component's, in attachment order — and mark the actor
 * begun, so a component attached from then on begins play inside `attach`.
 *
 * A component attached *during* the pass (from the actor's `beginPlay` or
 * from a sibling component's) is picked up by the same pass, each component
 * exactly once. Idempotent: a second call finds everything already begun.
 */
export function beginActorPlay(actor: Actor): void {
  if (!begunActors.has(actor)) actor.beginPlay();

  // Scan to a fixpoint rather than walking a snapshot: a component's
  // `beginPlay` may attach another component (which must still begin) or
  // detach one (which must not be visited through a stale index).
  let pending = firstUnbegun(actor);
  while (pending !== null) {
    beginComponentPlay(pending);
    pending = firstUnbegun(actor);
  }

  begunActors.add(actor);
}

/** The first attached component whose `beginPlay` has not run, or `null`. */
function firstUnbegun(actor: Actor): Component | null {
  for (const component of actor.components) {
    if (!begunComponents.has(component)) return component;
  }
  return null;
}

/** Internal: whether {@link beginActorPlay} has completed for `actor`. */
export function actorHasBegunPlay(actor: Actor): boolean {
  return begunActors.has(actor);
}

/**
 * Internal: run the actor's end-play pass — each attached component's
 * `endPlay(reason)` in attachment order, then the actor's own — each exactly
 * once. Called by the world at the end of the frame for a destroyed actor
 * (`"destroyed"`), and for every actor it holds when it closes
 * (`"level-closed"`); the reverse-spawn-order walk across actors is the
 * caller's.
 *
 * A component already ended by `detach` is skipped, and the whole pass is
 * idempotent, so an actor destroyed and then swept by a closing world ends
 * play once.
 */
export function endActorPlay(actor: Actor, reason: EndPlayReason): void {
  if (endedActors.has(actor)) return;
  endedActors.add(actor);

  // Fixpoint scan, for the same reason begin play uses one: a component's
  // teardown may detach a sibling, and the sibling must still end exactly once.
  let pending = firstUnended(actor);
  while (pending !== null) {
    endComponentPlay(pending, reason);
    pending = firstUnended(actor);
  }

  actor.endPlay(reason);
}

/** The first attached component whose `endPlay` has not run, or `null`. */
function firstUnended(actor: Actor): Component | null {
  for (const component of actor.components) {
    if (!endedComponents.has(component)) return component;
  }
  return null;
}
