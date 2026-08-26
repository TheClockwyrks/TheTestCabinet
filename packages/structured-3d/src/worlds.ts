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
 * `tickMode`, `flushDestroyed`, and `takeTransition`. {@link WorldDriver} is
 * the stateful seam over it — the one object that holds the world currently
 * open and runs the whole sequence above in its `open`, over collaborators the
 * engine injects (the level registry, the game instance's hooks, the
 * broadcaster, and a per-opening deps factory), so the engine's loop only has
 * to honor `takeTransition` by calling `driver.open`.
 *
 * Everything here mirrors the `worlds` API page under
 * `docs/engines/structured-3d/apis/` — that page is the specification, and a
 * member that disagrees with it is wrong.
 */

import {
  Pawn,
  attachActorToWorld,
  beginActorPlay,
  endActorPlay,
  type Actor,
  type ActorClass,
} from "./actors";
import type { WorldAudio } from "./audio";
import type { Camera } from "./camera";
import type { ColliderComponent, CollisionWorld, Manifold } from "./collision";
import { PlayerController, type Controller } from "./controllers";
import type { GameInstance, InitApi } from "./game-instance";
import type { InputReader } from "./input";
import {
  bindGameMode,
  type GameMode,
  type GameModeClass,
  type GameState,
  type MatchPhase,
} from "./game-mode";
import type { Transform, Viewport } from "./math";

/* -------------------------------------------------------------------------- */
/* The engine's shared vocabulary                                             */
/* -------------------------------------------------------------------------- */

/*
 * The engine's event map, its events surface, and its frame read live here
 * rather than in `engine.ts`, because this package's `contract.ts` carries
 * only the shared recording format and the worlds module is the lowest place
 * every one of them is needed from. `engine.ts` imports them; the entry point
 * re-exports them from here, so there is exactly one declaration of each.
 */

/**
 * Every event the one broadcaster carries, by name. The names are
 * `namespace:verb`, the payloads are plain records, and an empty payload is
 * `Record<string, never>`, so a handler's parameter names exactly what the
 * event delivered and nothing else.
 *
 * A type alias rather than an interface, because {@link EventBus} constrains
 * its map to `Record<string, unknown>` and only an object *type* is granted
 * the implicit index signature that constraint asks for. Declaring it as an
 * interface `extends Record<string, unknown>` would satisfy the constraint the
 * other way round and cost the sixteen literal keys `keyof` reports, which is
 * what makes `on("world:opened", …)` name a payload rather than `unknown`.
 */
export type EngineEventMap = {
  "asset:loaded": { path: string; url: string };
  "asset:failed": { path: string; url: string; reason: string };
  "cue:played": { cue: string; t: number; gain: number };
  "cue:looped": { cue: string; t: number; gain: number };
  "cue:stopped": { cue: string; t: number };
  "audio:unlocked": Record<string, never>;
  "world:opening": { from: string | null; to: string };
  "world:closed": { level: string };
  "world:opened": { level: string };
  "actor:spawned": { actor: Actor };
  "actor:destroyed": { actor: Actor };
  "possession:changed": {
    controller: Controller;
    pawn: Pawn | null;
    previous: Pawn | null;
  };
  "match:phase": { phase: MatchPhase; previous: MatchPhase };
  "overlap:begin": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  "overlap:end": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  hit: {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
};

/**
 * The subscription surface of the one broadcaster. `on`
 * returns the function that removes the handler; handlers run synchronously
 * at the moment the event happens, and a throwing handler is contained. Only
 * `on` is public — the emitting half stays the engine's, injected into each
 * subsystem as a closure rather than reachable from a game.
 */
export interface EngineEvents {
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/** How the world (and the game mode through it) emits one engine event. */
export type EngineEventEmitter = <K extends keyof EngineEventMap>(
  event: K,
  payload: EngineEventMap[K],
) => void;

/**
 * The frame counter, the accumulated simulated time, and the most recent
 * delta, exactly as `engine.frame()` reports them. `world.frame()` and a
 * `DrawComponent`'s `api.frame()` return the same shape.
 */
export interface FrameInfo {
  /** Frames delivered since the loop started. */
  count: number;
  /** Accumulated simulated time, in milliseconds. */
  timeMs: number;
  /** The most recent frame's delta, in milliseconds. */
  lastDeltaMs: number;
}

/* -------------------------------------------------------------------------- */
/* The level description                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A level: the game mode that runs it, the actors placed in it, and the assets
 * it loads. A level is a description rather than a live object — nothing in it
 * is live, so the same level opens as many times as a game asks and each
 * opening starts from the same description.
 */
export interface LevelDefinition {
  /** The game mode class constructed when the world is built. */
  mode: GameModeClass;
  /** The actors the level places, spawned in the order given. */
  actors?: readonly ActorSpec[];
  /**
   * Runs before the world is built, and is awaited. Where the level's assets
   * and cues are loaded.
   */
  load?(api: LoadApi): void | Promise<void>;
}

/**
 * One actor a level places: the class, and optionally a transform, tags, and
 * a configure step that runs on the constructed actor before it begins play.
 *
 * The transform is a `Partial<Transform>` applied over the identity —
 * position `(0, 0, 0)`, identity rotation, scale `(1, 1, 1)` — and each
 * present field replaces the whole value: a spec supplying `position`
 * supplies all three of its numbers, and the engine does not merge inside
 * `position`, `rotation`, or `scale`.
 */
export interface ActorSpec<A extends Actor = Actor> {
  /** The actor class constructed. */
  type: ActorClass<A>;
  /** Written over the constructed actor's transform, field by field. */
  transform?: Partial<Transform>;
  /** Tags carried by the actor from the moment it is attached. */
  tags?: readonly string[];
  /**
   * Runs on the constructed actor after the transform and the tags are
   * applied, before it begins play.
   */
  configure?(actor: A): void;
}

/**
 * What a level's `load` step is handed: the asset loaders, the cue-binding
 * half of audio, and the broadcaster. The engine awaits `load` before any
 * actor of the level exists, so a component receives its mesh as a plain
 * value; a cue loaded here binds on the engine and survives every later
 * transition, because cue definitions belong to the engine rather than to the
 * world.
 */
export interface LoadApi {
  /** The asset loaders, resolving under `assetRoot`. */
  readonly assets: InitApi["assets"];
  /** Binds a cue name to an audio file. */
  readonly audio: { load(cue: string, path: string): Promise<void> };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;
}

/* -------------------------------------------------------------------------- */
/* The world surface                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The three spec fields a runtime spawn carries — the same meaning they carry
 * on {@link ActorSpec}, applied in the same order, a present `transform`
 * field replacing the whole value. `spawn` then runs the actor's `beginPlay`
 * immediately, so a spawned actor is fully live by the time `spawn` returns.
 */
export interface SpawnSpec<A extends Actor = Actor> {
  /** Written over the constructed actor's transform, field by field. */
  transform?: Partial<Transform>;
  /** Tags carried by the actor from the moment it is attached. */
  tags?: readonly string[];
  /** Runs after the transform and the tags, before the actor begins play. */
  configure?(actor: A): void;
}

/**
 * A handle identifying one scheduled callback; `clearTimer` is what it is
 * for. Timers count simulated world time, so a paused world runs none of
 * them, and a world's timers are cleared when it closes.
 */
export type TimerHandle = number;

/**
 * The live instance of a level: everything a match is made of, and the object
 * a game looks things up through. A game and a validator both speak this
 * type; the engine alone constructs the class behind it.
 */
export interface World {
  /** The name the world was opened under. */
  readonly level: string;
  /** The game mode running this world. */
  readonly mode: GameMode;
  /** The game state the mode built. */
  readonly state: GameState;
  /** The world's camera, rebuilt at its defaults with the world. */
  readonly camera: Camera<Actor>;
  /** The world's collision queries and reported pairs. */
  readonly collision: CollisionWorld;
  /**
   * Seconds of simulated time the world has been stepped by. Incremented
   * before the controllers tick, and restarts at zero on every transition.
   */
  readonly time: number;
  /** Whether the world's simulation is suspended. */
  readonly paused: boolean;

  /** The cue bus this world plays through. */
  readonly audio: WorldAudio;
  /** The asset loaders, resolving under `assetRoot`. */
  readonly assets: InitApi["assets"];
  /**
   * The world's diagnostic registry: sources that live as long as the world
   * and are dropped when it closes. The game instance's sources persist
   * across every transition instead.
   */
  readonly diagnostics: { register(name: string, source: () => unknown): void };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;

  /**
   * Constructs the actor, applies `spec`, attaches it to the world, and runs
   * its `beginPlay` and each component's `beginPlay` before returning. Its
   * first `tick` is the next frame.
   */
  spawn<A extends Actor>(type: ActorClass<A>, spec?: SpawnSpec<A>): A;
  /** Every live actor, in spawn order, as a copy the caller owns. */
  actors(): readonly Actor[];
  /** The live actors carrying `tag`, in spawn order. */
  byTag(tag: string): readonly Actor[];
  /** The live actors that are instances of `type`, in spawn order. */
  ofType<A extends Actor>(type: ActorClass<A>): readonly A[];
  /** The first entry `ofType` would return, or `null`. */
  find<A extends Actor>(type: ActorClass<A>): A | null;

  /** Every controller, player and AI alike, in the order they were added. */
  controllers(): readonly Controller[];
  /** The player controllers alone, in index order. */
  players(): readonly PlayerController[];

  /** Runs `fn` once, `seconds` of simulated world time from now. */
  after(seconds: number, fn: () => void): TimerHandle;
  /**
   * Runs `fn` every `seconds` of simulated world time, until cleared or the
   * world closes.
   */
  every(seconds: number, fn: () => void): TimerHandle;
  /** Cancels the scheduled callback the handle identifies. */
  clearTimer(handle: TimerHandle): void;

  /**
   * Pauses or resumes the world's simulation. A paused world still renders,
   * and its input frame still closes.
   */
  setPaused(paused: boolean): void;
  /**
   * Requests a transition to `level`, deferred to the end of the frame. One
   * call per frame is honored: a second request replaces the first.
   */
  open(level: string, options?: Readonly<Record<string, unknown>>): void;

  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* The engine-facing wiring                                                   */
/* -------------------------------------------------------------------------- */

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
  camera: Camera<Actor>;
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
   * Registers a source in the *world* registry — the one the engine's
   * diagnostics drop when this world closes.
   */
  registerDiagnostic(name: string, source: () => unknown): void;
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

/**
 * The engine's implementation of the {@link World} interface.
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
    register(name: string, source: () => unknown): void;
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
  get camera(): Camera<Actor> {
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
  get diagnostics(): { register(name: string, source: () => unknown): void } {
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
   * The game mode's tick, after the collision pass has reported, so the mode
   * decides the match from a settled world. A paused world's mode stands
   * still. Internal: the engine calls it once per frame.
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
   * the engine's diagnostics and are dropped there): the timers are cleared,
   * each controller's `endPlay("level-closed")` runs in reverse order, each
   * actor's components' and then the actor's own `endPlay("level-closed")`
   * run in reverse spawn order, and the game mode's `endPlay("level-closed")`
   * runs last. The lists are then emptied, so a stale reference finds an
   * empty world. Internal: the driver calls it once, and emits `world:closed`
   * itself afterwards.
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
   * `world` and the next `id`, writes the spec's transform whole field by
   * whole field over the defaults, adds its tags, runs `configure`, appends
   * it in spawn order, and emits `actor:spawned`. Both a declared actor
   * (step 9) and a runtime spawn come through here; only the latter begins
   * play at once.
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
      // Each present field replaces the whole value — no merging inside
      // `position`, `rotation`, or `scale` — and lands as a fresh copy: a
      // level definition is inert data reopened as often as the game asks,
      // so an actor mutating its own transform must never reach back into
      // the spec it was built from.
      const { position, rotation, scale } = spec.transform;
      if (position !== undefined) actor.transform.position = { ...position };
      if (rotation !== undefined) actor.transform.rotation = { ...rotation };
      if (scale !== undefined) actor.transform.scale = { ...scale };
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
        `structured-3d: ${member} needs finite seconds, got ${seconds}`,
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

/* -------------------------------------------------------------------------- */
/* The transition driver                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a {@link WorldDriver} runs the transition sequence over.
 *
 * Internal: the engine supplies one. Everything a transition threads through
 * that the world itself does not own arrives here — the level registry, the
 * game instance's two hooks, the broadcaster's emitting half, the `LoadApi`
 * handed to a level's `load`, the world-diagnostics drop, and the factory
 * that assembles a fresh {@link WorldDeps} per opening (which is where the
 * camera and the collision world are rebuilt at their defaults).
 */
export interface WorldDriverDeps {
  /** The level registry, exactly as the game definition declares it. */
  levels: Readonly<Record<string, LevelDefinition>>;
  /** The game instance's transition hooks. */
  instance: Pick<GameInstance<unknown>, "worldOpened" | "worldClosing">;
  /** The engine's broadcaster, for the three `world:*` events. */
  emit: EngineEventEmitter;
  /** What the incoming level's `load` is handed. */
  loadApi: LoadApi;
  /**
   * A fresh set of world collaborators for one opening. Called once per
   * `open`, after the outgoing world has closed and the incoming level's
   * `load` has resolved, so the camera and the collision world it builds are
   * this world's own.
   */
  buildDeps(
    level: string,
    definition: LevelDefinition,
    options: Readonly<Record<string, unknown>>,
  ): WorldDeps;
  /** Drops every world-scoped diagnostic source — step 3's other half. */
  dropWorldDiagnostics(): void;

  /**
   * Ends the outgoing world's collision pass, which reports an
   * `overlap:end` for every pair it was holding.
   *
   * Called before the world's own teardown rather than after it, so an
   * `overlap:end` handler still reads a whole world: both actors alive, both
   * colliders attached, the lookups still answering. The collision system is
   * built per opening alongside the camera, so the engine — which built it —
   * is what closes it.
   */
  closeCollision(): void;
}

/**
 * The stateful seam that holds the one open world and performs transitions.
 *
 * The engine's loop drives it in exactly two places: `open(startLevel, {})`
 * from `engine.initialize`, and `open(request.level, request.options)` when a
 * frame's `takeTransition` hands one back. `open` runs the fixed 12-step
 * sequence in the module header; it is asynchronous because a level's `load`
 * is, and the caller runs no frame while it is in flight.
 */
export class WorldDriver {
  /** The engine-supplied collaborators. */
  private readonly deps: WorldDriverDeps;

  /** The world currently open, or `null` before the start level opens. */
  private openWorld: EngineWorld | null = null;

  constructor(deps: WorldDriverDeps) {
    this.deps = deps;
  }

  /** The world currently open, or `null` before the start level opens. */
  current(): EngineWorld | null {
    return this.openWorld;
  }

  /**
   * Performs one transition, running the fixed sequence: emit
   * `world:opening`, run `instance.worldClosing`, drop the outgoing world's
   * timers and diagnostic sources, end every controller's, actor's, and the
   * mode's play, emit `world:closed`, await the incoming level's `load`,
   * build the world, begin its play, emit `world:opened`, and run
   * `instance.worldOpened`. Opening the start level — when no world is open
   * yet — skips the closing half, and its `world:opening` carries
   * `from: null`.
   *
   * A level name outside the registry is refused before anything closes, so
   * a typo leaves the running world standing rather than half torn down.
   */
  async open(
    level: string,
    options: Readonly<Record<string, unknown>> = {},
  ): Promise<EngineWorld> {
    const definition = this.deps.levels[level];
    if (definition === undefined) {
      const registered = Object.keys(this.deps.levels).join(", ");
      throw new Error(
        `structured-3d: "${level}" is not a registered level — ` +
          `the game definition registers: ${registered}`,
      );
    }

    const outgoing = this.openWorld;
    // Step 1: the announcement carries both names, `from: null` for the
    // start level.
    this.deps.emit("world:opening", {
      from: outgoing?.level ?? null,
      to: level,
    });

    if (outgoing !== null) {
      // Step 2: the instance reads the outgoing world while it is whole.
      this.deps.instance.worldClosing(outgoing);
      // Steps 3–6: diagnostics dropped here, the held overlap pairs ended
      // while the world is still whole, timers and the three end-play walks
      // inside `close`.
      this.deps.dropWorldDiagnostics();
      this.deps.closeCollision();
      outgoing.close();
      this.openWorld = null;
      // Step 7.
      this.deps.emit("world:closed", { level: outgoing.level });
    }

    // Step 8: the incoming level's assets are decoded before any of its
    // actors exist.
    await definition.load?.(this.deps.loadApi);

    // Step 9: mode, state, declared actors — the EngineWorld constructor.
    const world = new EngineWorld(
      this.deps.buildDeps(level, definition, options),
    );
    this.openWorld = world;

    // Steps 10–11.
    world.begin();

    // Step 12: the event first, then the instance hook, so a subscriber and
    // the instance agree on which world is open when each of them runs.
    this.deps.emit("world:opened", { level });
    this.deps.instance.worldOpened(world);
    return world;
  }

  /**
   * Closes the open world without opening another — what `engine.destroy`
   * needs.
   *
   * The same closing half `open` runs, less the two announcements: a
   * `world:closed` here would be broadcast on a bus the same `destroy` is
   * about to clear, and no world is opening for a `world:opening` to name.
   * Idempotent, because teardown races.
   */
  close(): void {
    const outgoing = this.openWorld;
    if (outgoing === null) return;
    this.openWorld = null;
    this.deps.dropWorldDiagnostics();
    this.deps.closeCollision();
    outgoing.close();
  }
}
