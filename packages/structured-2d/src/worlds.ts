/**
 * The world: the live instance of a level description.
 *
 * A level is inert data — the game mode class that will run it, the actors it
 * places, and a load step for the assets and cues it needs. Opening it builds
 * a world, and one world is open at a time: `engine.world` is the one
 * currently open, and it follows every transition.
 *
 * The world owns the live objects (the actors, the controllers, the camera,
 * the collision world, the timers, and the world-scoped diagnostic sources)
 * and is the object a game looks things up through. A transition —
 * `world.open` — is recorded rather than performed, honored after the frame's
 * ticks and collision pass and before the frame renders, and it is
 * asynchronous because the incoming level's `load` is; the fixed sequence is
 * on the Worlds API page:
 *
 * 1. `world:opening` — 2. `instance.worldClosing` — 3. timers cleared, world
 * diagnostic sources dropped — 4. controllers `endPlay("level-closed")` in
 * reverse order — 5. components' then actors' `endPlay("level-closed")` in
 * reverse spawn order — 6. mode `endPlay("level-closed")` — 7. `world:closed`
 * — 8. incoming `load` awaited — 9. mode, then state, then declared actors
 * constructed in order — 10. every declared actor's `beginPlay` in spawn
 * order — 11. mode `beginPlay` — 12. `world:opened`, then
 * `instance.worldOpened`.
 *
 * {@link EngineWorld} is one live world: constructing it is step 9, `begin` is
 * steps 10–11, `close` is steps 4–6 together with step 3's timers, and within
 * a frame it supplies `simulate` (time, controllers, actors, timers),
 * `tickMode`, `flushDestroyed`, and `takeTransition`. The stateful seam that
 * schedules these — holding the world currently open and running the whole
 * transition sequence above in its `open` — is the engine's `WorldDriver`,
 * which the engine module builds over this class, because the sequence threads
 * through collaborators only the engine holds (the broadcaster, the game
 * instance, the diagnostics registries, and the level registry).
 */

import {
  Pawn,
  attachActorToWorld,
  beginActorPlay,
  endActorPlay,
  type Actor,
} from "./actors";
import type {
  ActorClass,
  ActorSpec,
  Camera,
  CollisionWorld,
  DiagnosticValue,
  EngineEventMap,
  EngineEvents,
  FrameInfo,
  InitApi,
  InputReader,
  LevelDefinition,
  SpawnSpec,
  TimerHandle,
  Viewport,
  World,
  WorldAudio,
} from "./contract";
import { PlayerController, type Controller } from "./controllers";
import { bindGameMode, type GameMode, type GameState } from "./game-mode";

/** How the world (and the game mode through it) emits one engine event. */
export type EngineEventEmitter = <K extends keyof EngineEventMap>(
  event: K,
  payload: EngineEventMap[K],
) => void;

/**
 * What an {@link EngineWorld} is built over.
 *
 * Internal: the engine assembles one per level opening. The camera and the
 * collision world are built fresh for each world; the audio bus, the asset
 * loaders, the broadcaster, and the frame and viewport reads are the engine's
 * own, handed through so the world's accessors answer from the live engine.
 */
export interface WorldDeps {
  /** The name the world is opened under. */
  level: string;
  /** The level description the world is built from. */
  definition: LevelDefinition;
  /** What `world.open` was given, or an empty object for the start level. */
  options: Readonly<Record<string, unknown>>;
  /** The world's camera, freshly built at its defaults. */
  camera: Camera;
  /** The world's collision queries, freshly built. */
  collision: CollisionWorld;
  /** The engine's cue bus, presented as `world.audio`. */
  audio: WorldAudio;
  /** The engine's asset loaders. */
  assets: InitApi["assets"];
  /** The engine's broadcaster, for subscribing. */
  events: EngineEvents;
  /** The engine's broadcaster, for emitting. */
  emit: EngineEventEmitter;
  /**
   * Registers a source in the *world* registry — the one `Diagnostics.
   * dropWorldSources` drops when this world closes.
   */
  registerDiagnostic(name: string, source: () => DiagnosticValue): void;
  /** A fresh input reader, one per player controller added. */
  createInputReader(): InputReader;
  /** The engine's frame read, live. */
  frame(): FrameInfo;
  /** The engine's viewport read, live. */
  viewport(): Viewport;
}

/** One deferred `world.open` request, as the engine takes it at end of frame. */
export interface TransitionRequest {
  /** The level named. */
  level: string;
  /** The options given, or the empty object `open` defaults to. */
  options: Readonly<Record<string, unknown>>;
}

/** One scheduled callback against simulated world time. */
interface TimerEntry {
  /** When the callback next runs, in world seconds. */
  dueAt: number;
  /** The repeat period in seconds, or `null` for a one-shot. */
  interval: number | null;
  /** The scheduled callback. */
  fn: () => void;
}

/** One actor `destroy` has marked, awaiting the end-of-frame sweep. */
interface DestroyedEntry {
  /** The actor marked. */
  actor: Actor;
  /**
   * The controller possessing the actor at the moment it was marked, or
   * `null`. Recorded at the mark — where the unpossession happens — so the
   * mode's `pawnDied` reaches this controller even when it has possessed
   * another pawn by the time the flush runs (a mid-frame `restart`).
   */
  controller: Controller | null;
}

/** The transform fields a spec's `Partial<Transform>` may carry. */
const TRANSFORM_FIELDS = ["x", "y", "rotation", "scaleX", "scaleY"] as const;

/**
 * The engine's implementation of the `World` interface.
 *
 * Internal: a game and a validator both speak the `World` type, and the
 * engine alone constructs this class — once per level opening (which
 * constructs the game mode, the game state, and the level's declared actors,
 * in that order), torn down at the transition's close.
 */
export class EngineWorld implements World {
  /** The engine-supplied collaborators, held for the world's lifetime. */
  private readonly deps: WorldDeps;

  /** The constructed game mode. */
  private readonly worldMode: GameMode;

  /** The game state the mode's `gameStateClass` built. */
  private readonly worldState: GameState;

  /** Every actor attached and not yet removed, in spawn order. */
  private readonly actorList: Actor[] = [];

  /** Every controller added, in addition order. */
  private readonly controllerList: Controller[] = [];

  /** The scheduled callbacks, by handle. */
  private readonly timers = new Map<TimerHandle, TimerEntry>();

  /**
   * The actors `destroy` has marked and the end of the frame has not swept
   * yet, each with the controller that possessed it at the mark. Filled
   * through the `onDestroyed` hook the actor wiring carries.
   */
  private readonly destroyedQueue: DestroyedEntry[] = [];

  /** The one stable object `world.diagnostics` returns. */
  private readonly diagnosticsApi: {
    register(name: string, source: () => DiagnosticValue): void;
  };

  /** The next actor id, unique within the world, assigned from `1`. */
  private nextActorId = 1;

  /** The next timer handle, assigned from `1`. */
  private nextTimerHandle = 1;

  /** Seconds of simulated time the world has been stepped by. */
  private timeSeconds = 0;

  /** Whether the world's simulation is suspended. */
  private pausedFlag = false;

  /** The deferred `open` request, the latest call in the frame winning. */
  private pending: TransitionRequest | null = null;

  constructor(deps: WorldDeps) {
    this.deps = deps;
    this.diagnosticsApi = {
      register: (name, source) => {
        deps.registerDiagnostic(name, source);
      },
    };
    // Step 9 of the transition: the mode (which is where `gameStateClass` is
    // read, once), then the state, then the declared actors, in order.
    const mode = new deps.definition.mode();
    const state = new mode.gameStateClass();
    bindGameMode(mode, this, deps.options, state, {
      emit: deps.emit,
      addController: (controller) => {
        this.controllerList.push(controller);
        controller.beginPlay();
      },
      createInputReader: () => deps.createInputReader(),
    });
    this.worldMode = mode;
    this.worldState = state;
    for (const spec of deps.definition.actors ?? []) {
      this.createActor(spec.type, spec);
    }
  }

  /** The name the world was opened under. */
  get level(): string {
    return this.deps.level;
  }

  /** The game mode running this world. */
  get mode(): GameMode {
    return this.worldMode;
  }

  /** The game state the mode built. */
  get state(): GameState {
    return this.worldState;
  }

  /** The world's camera, rebuilt at its defaults with the world. */
  get camera(): Camera {
    return this.deps.camera;
  }

  /** The world's collision queries and reported pairs. */
  get collision(): CollisionWorld {
    return this.deps.collision;
  }

  /**
   * Seconds of simulated time the world has been stepped by, incremented
   * before the controllers tick. Restarts at zero on every transition.
   */
  get time(): number {
    return this.timeSeconds;
  }

  /** Whether the world's simulation is suspended. */
  get paused(): boolean {
    return this.pausedFlag;
  }

  /** The cue bus this world plays through. */
  get audio(): WorldAudio {
    return this.deps.audio;
  }

  /** The asset loaders, resolving under `assetRoot`. */
  get assets(): InitApi["assets"] {
    return this.deps.assets;
  }

  /**
   * The world's diagnostic registry: sources that live as long as the world
   * and are dropped when it closes.
   */
  get diagnostics(): {
    register(name: string, source: () => DiagnosticValue): void;
  } {
    return this.diagnosticsApi;
  }

  /** The engine's broadcaster. */
  get events(): EngineEvents {
    return this.deps.events;
  }

  /**
   * Constructs the actor, applies `spec`, attaches it to the world, and runs
   * its `beginPlay` and each component's `beginPlay` before returning. Its
   * first `tick` is the next frame. Emits `actor:spawned`.
   */
  spawn<A extends Actor>(type: ActorClass<A>, spec?: SpawnSpec<A>): A {
    const actor = this.createActor(type, spec);
    beginActorPlay(actor);
    return actor;
  }

  /** Every live actor, in spawn order, as a copy the caller owns. */
  actors(): readonly Actor[] {
    return this.actorList.filter((actor) => actor.alive);
  }

  /** The live actors carrying `tag`, in spawn order. */
  byTag(tag: string): readonly Actor[] {
    return this.actorList.filter((actor) => actor.alive && actor.hasTag(tag));
  }

  /** The live actors that are instances of `type`, in spawn order. */
  ofType<A extends Actor>(type: ActorClass<A>): readonly A[] {
    return this.actorList.filter(
      (actor): actor is A => actor.alive && actor instanceof type,
    );
  }

  /** The first entry `ofType` would return, or `null`. */
  find<A extends Actor>(type: ActorClass<A>): A | null {
    for (const actor of this.actorList) {
      if (actor.alive && actor instanceof type) return actor;
    }
    return null;
  }

  /** Every controller, player and AI alike, in the order they were added. */
  controllers(): readonly Controller[] {
    return [...this.controllerList];
  }

  /** The player controllers alone, in index order. */
  players(): readonly PlayerController[] {
    return this.controllerList
      .filter(
        (controller): controller is PlayerController =>
          controller instanceof PlayerController,
      )
      .sort((a, b) => a.index - b.index);
  }

  /** Runs `fn` once, `seconds` of simulated world time from now. */
  after(seconds: number, fn: () => void): TimerHandle {
    return this.schedule("world.after", seconds, null, fn);
  }

  /**
   * Runs `fn` every `seconds` of simulated world time, until cleared or the
   * world closes.
   */
  every(seconds: number, fn: () => void): TimerHandle {
    return this.schedule("world.every", seconds, seconds, fn);
  }

  /** Cancels the scheduled callback the handle identifies. */
  clearTimer(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  /**
   * Pauses or resumes the world's simulation. A paused world still renders,
   * and its input frame still closes; an actor whose `tickWhenPaused` is
   * `true` ticks anyway, with its components.
   */
  setPaused(paused: boolean): void {
    this.pausedFlag = paused;
  }

  /**
   * Requests a transition to `level`, deferred to the end of the frame. One
   * call per frame is honored: a second request replaces the first.
   */
  open(level: string, options?: Readonly<Record<string, unknown>>): void {
    this.pending = { level, options: options ?? {} };
  }

  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo {
    return this.deps.frame();
  }

  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport {
    return this.deps.viewport();
  }

  /* ------------------------------------------------------------------ */
  /* The engine-facing half: the frame's steps and the transition's      */
  /* ------------------------------------------------------------------ */

  /**
   * Steps 10–11 of a level opening: every declared actor's `beginPlay` (and
   * each one's components') in spawn order — after all of them exist — then
   * the game mode's `beginPlay`. Internal: the engine calls it once, after
   * construction.
   */
  begin(): void {
    // A snapshot: an actor's `beginPlay` may spawn, and a spawned actor is
    // begun by `spawn` itself, not a second time by this pass (the actors
    // module's pass is idempotent regardless).
    for (const actor of [...this.actorList]) {
      beginActorPlay(actor);
    }
    this.worldMode.beginPlay();
  }

  /**
   * The frame's simulation: advances world time (and the match clock while
   * the phase is `"playing"`), ticks every controller, then every actor and
   * its components in spawn order, then fires the due timers. Internal: the
   * engine calls it once per frame, before the collision pass.
   *
   * A paused world does none of that except the actors that opted in: a
   * `tickWhenPaused` actor ticks with its components, against a clock that
   * stands still.
   */
  simulate(dt: number): void {
    if (this.pausedFlag) {
      for (const actor of [...this.actorList]) {
        if (!actor.alive || !actor.tickEnabled || !actor.tickWhenPaused) {
          continue;
        }
        this.tickActor(actor, dt);
      }
      return;
    }
    // Time moves before the controllers tick, so everything in the frame
    // reads the same, already-advanced clock.
    this.timeSeconds += dt;
    if (this.worldState.phase === "playing") this.worldState.elapsed += dt;
    // The actor snapshot is taken before the controllers tick: a spawn's
    // first tick is the next frame, whoever spawned it — a controller's tick
    // included. The per-actor checks at visit time handle a mid-frame
    // destroy.
    const actors = [...this.actorList];
    for (const controller of [...this.controllerList]) {
      controller.tick(dt);
    }
    for (const actor of actors) {
      if (!actor.alive || !actor.tickEnabled) continue;
      this.tickActor(actor, dt);
    }
    this.fireTimers();
  }

  /**
   * Step 8 of the frame: the game mode's tick, after the collision pass has
   * reported, so the mode decides the match from a settled world. A paused
   * world's mode stands still. Internal: the engine calls it once per frame.
   */
  tickMode(dt: number): void {
    if (this.pausedFlag) return;
    this.worldMode.tick(dt);
  }

  /**
   * The frame's deferred destroys: every actor marked dead leaves the world,
   * in reverse spawn order across the actors destroyed that frame — each
   * one's components' `endPlay("destroyed")`, then its own, then
   * `actor:destroyed`. A pawn possessed at the mark was unpossessed then, so
   * its `endPlay` observes `controller === null`, and the mode's `pawnDied`
   * runs after that `endPlay`, against the controller recorded at the mark.
   * `pawnDied` (or a teardown) may spawn debris or destroy further actors; a
   * fresh destroy lands on the same queue and is swept by the same call as
   * the next batch, ordered the same way. Internal: the engine calls it at
   * the end of the frame, before honoring a transition.
   */
  flushDestroyed(): void {
    while (this.destroyedQueue.length > 0) {
      // One batch: everything marked so far, torn down newest spawn first.
      const batch = this.destroyedQueue.splice(0);
      batch.sort((a, b) => b.actor.id - a.actor.id);
      for (const { actor, controller } of batch) {
        // Removed before its endPlay runs, so a lookup from inside a
        // teardown finds the world already without it.
        const at = this.actorList.indexOf(actor);
        if (at === -1) continue;
        this.actorList.splice(at, 1);
        endActorPlay(actor, "destroyed");
        this.deps.emit("actor:destroyed", { actor });
        if (controller !== null) {
          this.worldMode.pawnDied(controller, actor as Pawn);
        }
      }
    }
  }

  /**
   * The transition request the frame recorded, or `null` — and taking it
   * clears it, so the next frame starts with none. Internal: the engine reads
   * it after `flushDestroyed`, before the frame renders.
   */
  takeTransition(): TransitionRequest | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
  }

  /**
   * Steps 3–6 of a level closing, less the diagnostic sources (which live in
   * the engine's `Diagnostics` and are dropped there): the timers are
   * cleared, each controller's `endPlay("level-closed")` runs in reverse
   * order, each actor's components' and then the actor's own
   * `endPlay("level-closed")` run in reverse spawn order, and the game mode's
   * `endPlay("level-closed")` runs last. The lists are then emptied, so a
   * stale reference finds an empty world. Internal: the engine calls it once,
   * and emits `world:closed` itself afterwards.
   */
  close(): void {
    this.timers.clear();
    this.pending = null;
    this.destroyedQueue.length = 0;
    for (const controller of [...this.controllerList].reverse()) {
      controller.endPlay("level-closed");
    }
    // The actor pass — components first, then the actor, each exactly once —
    // lives with the actors module; the reverse-spawn-order walk is ours.
    for (const actor of [...this.actorList].reverse()) {
      endActorPlay(actor, "level-closed");
    }
    this.worldMode.endPlay("level-closed");
    this.controllerList.length = 0;
    this.actorList.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Private machinery                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Constructs and attaches one actor without beginning its play: assigns
   * `world` and the next `id`, writes the spec's transform field by field
   * over the defaults, adds its tags, runs `configure`, appends it in spawn
   * order, and emits `actor:spawned`. Both a declared actor (step 9) and a
   * runtime spawn come through here; only the latter begins play at once.
   */
  private createActor<A extends Actor>(
    type: ActorClass<A>,
    spec: SpawnSpec<A> | ActorSpec<A> | undefined,
  ): A {
    const actor = new type();
    attachActorToWorld(actor, this, this.nextActorId, (marked) => {
      // Destroying a pawn unpossesses it first: the seat clears — and
      // `possession:changed` fires — at the mark, well before the
      // end-of-frame teardown, and the controller is remembered for the
      // flush's `pawnDied`.
      const controller = marked instanceof Pawn ? marked.controller : null;
      controller?.unpossess();
      this.destroyedQueue.push({ actor: marked, controller });
    });
    this.nextActorId += 1;
    if (spec?.transform !== undefined) {
      for (const field of TRANSFORM_FIELDS) {
        const value = spec.transform[field];
        if (value !== undefined) actor.transform[field] = value;
      }
    }
    if (spec?.tags !== undefined) {
      for (const tag of spec.tags) actor.addTag(tag);
    }
    spec?.configure?.(actor);
    this.actorList.push(actor);
    this.deps.emit("actor:spawned", { actor });
    return actor;
  }

  /**
   * Ticks one actor and then its enabled components, in attachment order. A
   * component the tick detached is skipped (its `endPlay` already ran), and
   * an actor a component's tick destroyed stops the walk at once.
   */
  private tickActor(actor: Actor, dt: number): void {
    actor.tick(dt);
    if (!actor.alive) return;
    for (const component of [...actor.components]) {
      if (!actor.alive) return;
      if (!component.enabled) continue;
      if (!actor.components.includes(component)) continue;
      component.tick(dt);
    }
  }

  /** Registers one timer, validating the figure a caller could get wrong. */
  private schedule(
    member: string,
    seconds: number,
    interval: number | null,
    fn: () => void,
  ): TimerHandle {
    if (!Number.isFinite(seconds)) {
      throw new RangeError(
        `structured-2d: ${member} needs finite seconds, got ${seconds}`,
      );
    }
    const handle = this.nextTimerHandle;
    this.nextTimerHandle += 1;
    this.timers.set(handle, {
      dueAt: this.timeSeconds + seconds,
      interval,
      fn,
    });
    return handle;
  }

  /**
   * Fires every timer due at the current world time, earliest due first
   * (handle order breaking ties). A one-shot is removed before its callback
   * runs, so the callback may schedule afresh or clear anything, itself
   * included, safely. A repeating timer catches up — a delta that steps over
   * several periods fires once per period crossed, so a counter driven by
   * `every` counts real elapsed time — and a degenerate period of zero or
   * less fires once per pass rather than spinning. Timers scheduled by a
   * callback are not in this pass's snapshot, so they fire no earlier than
   * the next frame.
   */
  private fireTimers(): void {
    const now = this.timeSeconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= now)
      .sort(
        ([aHandle, a], [bHandle, b]) => a.dueAt - b.dueAt || aHandle - bHandle,
      );
    for (const [handle, timer] of due) {
      // An earlier callback may have cleared this one.
      if (this.timers.get(handle) !== timer) continue;
      if (timer.interval === null) {
        this.timers.delete(handle);
        timer.fn();
        continue;
      }
      if (timer.interval > 0) {
        while (timer.dueAt <= now && this.timers.get(handle) === timer) {
          timer.dueAt += timer.interval;
          timer.fn();
        }
      } else {
        timer.dueAt = now;
        timer.fn();
      }
    }
  }
}
