/**
 * The engine's one event stream: the map of what can be announced, the
 * subscriber-facing interface a game and a validator are handed, and the
 * broadcaster the subsystems emit through.
 *
 * The map lives here rather than in `contract.ts` because five of its payloads
 * name framework classes — an `Actor` spawned, a `Controller` that took a
 * `Pawn`, the two `ColliderComponent`s a pair was found between — and the
 * contract module is deliberately free of those, so that it stays a leaf whose
 * only import is `three`. Everything that names a framework class therefore
 * gathers here instead, in the one module every subsystem that emits already
 * has to reach for.
 *
 * There is exactly one bus per engine. It is reachable as `engine.events`, as
 * `world.events`, and as the `events` field on the game instance and on each
 * API object the framework hands a game, and those are the same object rather
 * than the same shape — a subscriber that registered before `engine.initialize`
 * therefore watches the start level being built, and keeps watching across
 * every transition after it, because the bus outlives every world.
 *
 * The split between the two halves is what stops a game from broadcasting
 * engine events of its own invention: {@link EngineEvents} declares only `on`,
 * and that is the type every seam hands out, while `emit` and `clear` exist
 * only on the concrete {@link EngineEventBus} the engine holds privately.
 */

import type { Actor, Pawn } from "./actors";
import type { ColliderComponent } from "./collision";
import type { Manifold, MatchPhase, Vec3 } from "./contract";
import type { Controller } from "./controllers";

/* -------------------------------------------------------------------------- */
/* The map                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every event the engine publishes, and what each one carries.
 *
 * The map is the specification of the stream: an event name is a key of this
 * type, and `on` reads the payload out of it, so a subscriber that misspells an
 * event or destructures a field the payload does not carry is a compile error
 * rather than a handler that never runs.
 *
 * The events divide into five groups by who emits them. The asset root emits
 * the two `asset:` events, the audio bus the three `cue:` events and
 * `audio:unlocked`, the engine's transition sequence the three `world:` events,
 * a world the two `actor:` events, a controller `possession:changed` and a game
 * mode `match:phase`, and the collision pass the two `overlap:` events and
 * `hit`. Nothing here is a command: every one of them reports something that
 * has already happened, and a handler that throws changes nothing about it.
 */
export interface EngineEventMap {
  /** A loader's value arrived. */
  "asset:loaded": { path: string; url: string };
  /** A loader refused the path, or the fetch, the status, or the decode failed. */
  "asset:failed": { path: string; url: string; reason: string };
  /**
   * `world.audio.play` ran, on a muted bus as well as an audible one. `at` is
   * the world point a positional cue was placed at, `null` for an unpositioned
   * one.
   */
  "cue:played": { cue: string; t: number; gain: number; at: Vec3 | null };
  /** `world.audio.loop` started a cue looping. `at` as for `cue:played`. */
  "cue:looped": { cue: string; t: number; gain: number; at: Vec3 | null };
  /** A running loop ended, by `world.audio.stop` or by a redeclaration. */
  "cue:stopped": { cue: string; t: number };
  /** The engine opened the audio context, on the first pointerdown or keydown. */
  "audio:unlocked": Record<string, never>;
  /** A transition began, carrying the outgoing level name and the incoming one. */
  "world:opening": { from: string | null; to: string };
  /** The outgoing world's game mode has ended play. */
  "world:closed": { level: string };
  /** The incoming world is built and its game mode has begun play. */
  "world:opened": { level: string };
  /** An actor was spawned into the world. */
  "actor:spawned": { actor: Actor };
  /** An actor was destroyed. */
  "actor:destroyed": { actor: Actor };
  /** A controller took a pawn or released the one it held. */
  "possession:changed": {
    controller: Controller;
    pawn: Pawn | null;
    previous: Pawn | null;
  };
  /** `setPhase` set a phase the game mode did not already hold. */
  "match:phase": { phase: MatchPhase; previous: MatchPhase };
  /** The first frame the collision pass found an overlapping pair. */
  "overlap:begin": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  /**
   * The first frame the pass stopped finding an overlapping pair, and when
   * either actor is destroyed or the world closes.
   */
  "overlap:end": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  /** Every frame the pass finds a blocking pair, with the manifold between them. */
  hit: {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
}

/* -------------------------------------------------------------------------- */
/* The subscriber's half                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The broadcaster as a subscriber sees it: one method, and the function that
 * undoes it.
 *
 * Handlers run synchronously at the moment the event happens, so a subscriber
 * sees the frame the event belongs to rather than a batch delivered at the far
 * side of it. That is what makes a check like "the goal scored on the frame the
 * ball crossed the line" expressible at all.
 */
export interface EngineEvents {
  /**
   * Subscribe `handler` to `event`, and return the function that removes it.
   *
   * The returned function is idempotent, so a teardown path that runs twice
   * does not unsubscribe a stranger that took the vacated slot.
   */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/* -------------------------------------------------------------------------- */
/* The bus                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A handler with its payload erased.
 *
 * `never` in the parameter position is the one type every concrete
 * `(payload: EngineEventMap[K]) => void` is assignable to, which lets the bins
 * be stored heterogeneously without a cast on the way *in*. The cast happens on
 * the way out, in {@link EngineEventBus.emit}, where the bin's key proves the
 * payload type.
 */
type ErasedHandler = (payload: never) => void;

/** What a handler for `event` is called with. */
type Handler<K extends keyof EngineEventMap> = (
  payload: EngineEventMap[K],
) => void;

/**
 * The signature every subsystem's emit seam narrows from.
 *
 * A subsystem that announces one event — the game mode's `match:phase`, a
 * controller's `possession:changed` — declares its own single-entry emitter and
 * takes this one unchanged, because a generic function over the whole map is
 * assignable to any narrowing of it. That is what lets the engine hand each
 * subsystem the same bus without either side importing the other.
 */
export type EngineEventEmitter = <K extends keyof EngineEventMap>(
  event: K,
  payload: EngineEventMap[K],
) => void;

/**
 * The engine's event broadcaster: the one channel through which a subsystem
 * reports something that happened, and the one place a caller watches it from.
 *
 * This exists in place of the accumulating logs an engine of this shape usually
 * grows — a list of cues played, a list of assets loaded — because those logs
 * are unbounded by construction. Broadcasting inverts that: the engine holds
 * handlers, the subscriber holds whatever it decided was worth keeping, and the
 * bound on what is retained becomes the subscriber's own business rather than a
 * limit the engine has to guess at.
 *
 * Two properties are enforced here rather than asked of the subsystems:
 *
 * - **Dispatch is synchronous.** A handler runs at the moment of the emit,
 *   inside the frame the event belongs to, so a subscriber can attribute the
 *   event to that frame. Deferring to a microtask would move every event to the
 *   far side of the frame and lose exactly that.
 * - **A throwing handler is contained.** The emitter is a subsystem mid-frame,
 *   emitting as the last step of work it has already committed to. A
 *   subscriber's bug must not become the audio bus's failure to play a cue, so
 *   the error goes to the console — where an unhandled error would have gone
 *   anyway — and the remaining handlers still run.
 */
export class EngineEventBus implements EngineEvents {
  /**
   * Subscribers by event name, in subscription order.
   *
   * An array rather than a `Set` for two reasons: order is part of the
   * contract, and subscribing the same function twice is a legitimate thing for
   * two independent observers sharing a helper to do — each of their
   * unsubscribes should then remove one of the two, which set semantics cannot
   * express.
   */
  private readonly bins = new Map<keyof EngineEventMap, ErasedHandler[]>();

  /**
   * Subscribe to `event`, and return the function that removes the handler.
   *
   * The returned function is idempotent: calling it a second time does nothing.
   * Unsubscribing is normally a teardown step and teardown runs twice more
   * often than anyone intends; were it not idempotent, the second call would
   * find the slot reoccupied by whatever subscribed after it and silently
   * unsubscribe a stranger.
   */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: Handler<K>,
  ): () => void {
    const bin = this.bins.get(event);
    if (bin) {
      bin.push(handler);
    } else {
      this.bins.set(event, [handler]);
    }

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;

      const current = this.bins.get(event);
      if (!current) return;

      // By identity, and only the first match, so a duplicate subscription of
      // the same function survives its sibling's removal.
      const at = current.indexOf(handler);
      if (at !== -1) current.splice(at, 1);

      // Drop the empty bin so the map's size tracks live subscriptions rather
      // than the set of events that have ever had one.
      if (current.length === 0) this.bins.delete(event);
    };
  }

  /**
   * Broadcast `payload` to every handler subscribed to `event`, in subscription
   * order, before returning.
   *
   * Dispatch walks a *snapshot* of the bin. A handler is free to subscribe or
   * unsubscribe — its own subscription included — without disturbing the
   * dispatch already in progress: a handler added during it does not receive
   * this event, and one removed during it still does. A nested emit is fine for
   * the same reason: the inner dispatch gets its own snapshot and completes
   * before the outer one resumes.
   */
  emit<K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void {
    const bin = this.bins.get(event);
    if (!bin || bin.length === 0) return;

    // Sound because the bins are keyed by event name: everything in this bin
    // was registered through `on` for this same `K`.
    const snapshot = bin.slice() as Array<Handler<K>>;

    for (const handler of snapshot) {
      try {
        handler(payload);
      } catch (error) {
        // Per handler, so one throwing subscriber does not cost the rest of
        // them the event, and reported rather than swallowed — a subscriber's
        // bug is still a bug, it just is not the emitting subsystem's problem.
        console.error(`structured-3d: an "${event}" handler threw`, error);
      }
    }
  }

  /**
   * Drop every subscription.
   *
   * `engine.destroy()` calls this. A handler typically closes over the caller's
   * own scene or test fixture, so leaving the bus subscribed after teardown
   * keeps that scope alive and lets a stale handler observe a successor
   * engine's events.
   */
  clear(): void {
    this.bins.clear();
  }
}
