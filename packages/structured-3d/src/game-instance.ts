/**
 * The game instance: the object that represents the whole game.
 *
 * The engine constructs it once, from the class the game definition names, and
 * keeps it for its lifetime. Every level transition happens underneath it, so
 * the instance is the one framework object that outlives a world — and that is
 * the whole reason it exists. A world is rebuilt from its level description on
 * every transition, along with its game mode, its game state, its actors, and
 * its controllers; anything that must survive travel has nowhere else to live.
 *
 * What that means in practice is a division a game makes once and then stops
 * thinking about:
 *
 * - **On the instance**: the declarations that belong to the whole game — the
 *   action bindings and cue definitions made from {@link InitApi}, the assets
 *   the game as a whole needs, the diagnostic sources the overlay should show
 *   under every level — and the figures a game keeps across matches, such as a
 *   high score or the number of levels completed.
 * - **On the game state**: everything scoped to one match. Score, phase,
 *   elapsed match time, and per-player figures are rebuilt with their world, so
 *   a transition clears them without the instance lifting a finger.
 *
 * `worldOpened` and `worldClosing` are where the two meet. A game reads the
 * outgoing world's state into the instance from `worldClosing`, and seeds the
 * incoming world from `worldOpened` — the running total crosses the transition
 * in the one object that spans it.
 *
 * `initialize` also returns the game's **debug surface**: the operations a
 * case's checks use to pose a situation and read it back. Carrying it in the
 * return value rather than asking for it through a separate member makes its
 * presence a property of initialization — the surface is in place before the
 * start level opens and before the first frame runs, so every caller that reads
 * `engine.debug` holds the one object the game returned. The engine holds that
 * value unchanged and reads no member of it, so its shape is whatever the
 * instance declares as `D`. A game with no surface returns `null`; the engine
 * refuses `undefined`, naming the surface.
 *
 * A surface operation acts on the *live* world. The instance holds `engine`,
 * and `engine.world` follows every transition, so an operation reads
 * `this.engine.world` at the moment it is called rather than closing over a
 * world of its own. That is the property that keeps a surface written once
 * working across every level the game opens.
 *
 * Nothing in this module is engine machinery. The class is a set of hooks with
 * do-nothing bodies and two fields the engine fills in, which is exactly what a
 * base class a build subclasses should be: the smallest thing that fixes the
 * shape and the calling order, so a subclass overrides only what it needs.
 */

import type { AssetApi } from "./assets";
import type {
  ActionBinding,
  CueSpec,
  DiagnosticValue,
  TouchLayout,
  Viewport,
} from "./contract";
import type { Engine } from "./engine";
import type { EngineEvents } from "./events";
import type { LevelDefinition, World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* The definition                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The game instance class takes no constructor arguments, and the engine
 * constructs it with none.
 *
 * A constructor therefore sets defaults and nothing more: the engine has no
 * value to hand one, and the fields the engine owns are assigned immediately
 * afterwards, before `initialize` runs.
 */
export type GameInstanceClass<D = unknown> = new () => GameInstance<D>;

/**
 * The whole game, as `EngineOptions.game` carries it: the level registry, the
 * start level, and the game instance class. One engine drives one definition
 * for its lifetime.
 *
 * The registry holds *descriptions* rather than live objects. Opening a level
 * builds a world from its entry, and the entry stays available for every later
 * transition back to it, so a game returns to a level it has already visited by
 * name and gets a world built fresh from the same description.
 *
 * `D` is the type of the debug surface the instance's `initialize` returns, and
 * `createEngine` infers it from the definition. A game with no surface is a
 * `GameDefinition<null>`.
 */
export interface GameDefinition<D = unknown> {
  /**
   * The class constructed once and kept across every level. Defaults to
   * {@link GameInstance} itself, which suits a game whose whole state fits in
   * its worlds.
   */
  instance?: GameInstanceClass<D>;
  /** The level registry, keyed by level name. At least one entry. */
  levels: Readonly<Record<string, LevelDefinition>>;
  /** The level `engine.initialize` opens. A key of `levels`. */
  startLevel: string;
}

/* -------------------------------------------------------------------------- */
/* What initialize receives                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the game instance's `initialize` receives.
 *
 * Everything declared here belongs to the whole game and survives every level
 * transition: the action bindings, the cue definitions, the assets the instance
 * holds, and the diagnostic sources the overlay reads. That is the distinction
 * between this and a level's `LoadApi` — the same asset loaders reached from
 * two places, differing only in how long what they produce is expected to last.
 *
 * The loaders are the three-dimensional set: `loadTexture` decodes an image
 * into a `THREE.Texture` a material declaration's `map` takes, and `loadModel`
 * decodes a glTF file into a `Model` a `ModelComponent` places. Both are the
 * same six members `world.assets` and a level's `LoadApi.assets` expose,
 * because they are the same object behind all three.
 */
export interface InitApi {
  readonly input: {
    /**
     * Registers or re-registers `name`. `binding.keys` is copied,
     * `binding.kind` defaults to `"digital"`, and `layout` resolves to the
     * selected layout's name when that layout's vocabulary contains `name`.
     * Re-registering replaces the binding wholesale, returns the action to
     * rest, and keeps its position in the registration order.
     */
    register(name: string, binding: ActionBinding): void;
    /** The layout selected by `EngineOptions.layout`, or `null`. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Binds `cue` to a synthesized `spec`. */
    define(cue: string, spec: CueSpec): void;
    /**
     * Fetches and decodes the audio at `path` and binds the result to `cue`.
     * Resolves once the cue is playable.
     */
    load(cue: string, path: string): Promise<void>;
  };
  /**
   * The asset loaders, resolving under `assetRoot`. The instance holds what it
   * loads here, and the result survives every level transition.
   */
  readonly assets: AssetApi;
  readonly diagnostics: {
    /**
     * Registers a source that lives as long as the engine, invoked on each
     * read. Re-registering a name replaces its source in place.
     */
    register(name: string, source: () => DiagnosticValue): void;
  };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* The instance                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assigns the engine-owned `declare readonly` fields of a freshly constructed
 * instance — `engine` and `events` — before its `initialize` runs, so a
 * constructor sets defaults and everything after construction finds both in
 * place.
 *
 * Internal: the engine calls this once, on the instance it constructed from the
 * game definition. The fields have no runtime presence of their own, so a plain
 * assignment is all that is needed; the helper exists so the cast lives here,
 * next to the class whose contract it upholds, rather than in the engine where
 * a reader would have to come looking for it.
 */
export function bindGameInstance<D>(
  instance: GameInstance<D>,
  engine: Engine<D>,
  events: EngineEvents,
): void {
  Object.assign(instance, { engine, events });
}

/**
 * The class the engine constructs once and keeps across every level.
 *
 * A game supplies its own subclass through `GameDefinition.instance`; omitting
 * the field uses `GameInstance` itself, which suits a game whose whole state
 * fits in its worlds. The class takes no constructor arguments, and the engine
 * constructs it with none: `engine` is assigned before `initialize` runs, so a
 * constructor sets defaults and nothing more — anything that reads the engine,
 * loads an asset, or registers a binding belongs in `initialize`.
 *
 * The base class's `initialize` returns `null` and its other methods do
 * nothing, so a subclass overrides only what it needs.
 *
 * ```ts
 * class Arcade extends GameInstance<null> {
 *   best = 0;
 *
 *   override initialize(api: InitApi): null {
 *     api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
 *     return null;
 *   }
 *
 *   override worldOpened(world: World): void {
 *     world.diagnostics.register("best", () => this.best);
 *   }
 * }
 * ```
 */
export class GameInstance<D = unknown> {
  /**
   * The engine driving this game. Assigned before `initialize` runs.
   *
   * This is the handle every debug-surface operation goes through:
   * `engine.world` follows each transition, so an operation that reads it at
   * the moment of the call reaches whichever world is open then.
   */
  declare readonly engine: Engine<D>;

  /** The same broadcaster `engine.events` reaches. Assigned with `engine`. */
  declare readonly events: EngineEvents;

  /**
   * Called once, before the start level opens. Returns the debug surface — a
   * game with no surface returns `null`. May return a promise, which the engine
   * awaits before the start level opens, so a game loads what it needs here and
   * finds it in place for the first frame.
   *
   * The base returns `null`, which is only honest for a `GameInstance<null>`; a
   * game that declares a richer `D` overrides this and returns it. The base
   * reads nothing off `api`, so an instance that declares no bindings, cues,
   * assets, or sources need not override this at all.
   */
  initialize(api: InitApi): D | Promise<D> {
    void api;
    return null as D;
  }

  /**
   * Called after each world's game mode has begun play. The base does nothing.
   *
   * The world handed over is fully live — its actors have begun play and its
   * mode has too — so this is where a game seeds the incoming level from what
   * the instance carried across the transition.
   */
  worldOpened(world: World): void {
    void world;
  }

  /**
   * Called before each world's actors end play. The base does nothing.
   *
   * The outgoing world is still whole here, which is what makes this the place
   * to read its game state into the instance: a moment later its actors have
   * ended play and its state is gone with it.
   */
  worldClosing(world: World): void {
    void world;
  }

  /** Called once, from `engine.destroy`. The base does nothing. */
  shutdown(): void {}
}
