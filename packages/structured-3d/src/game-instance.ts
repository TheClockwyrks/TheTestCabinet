/**
 * The game instance: the object that represents the whole game.
 *
 * The engine constructs it once, from the class the game definition names, and
 * keeps it for its lifetime. Every level transition happens underneath it, so
 * the instance is the one framework object that outlives a world — the place
 * for the action bindings and cue definitions declared from `InitApi`, the
 * assets the whole game needs, the diagnostic sources the overlay should always
 * show, and the figures a game keeps across matches.
 *
 * `initialize` also returns the game's *debug surface*: the operations a
 * case's checks use to pose a situation and read it back. The engine holds the
 * value unchanged and hands it back as `engine.debug`, reading no member of it,
 * so its shape is whatever the instance declares as `D`. A game with no
 * surface returns `null`, and `undefined` is refused by the engine. A pose
 * that patches a `Transform` assigns whole fields — `position`, `rotation`,
 * and `scale` are objects, the same whole-value rule a spawn spec follows.
 *
 * `worldOpened` and `worldClosing` are where the instance and the game state
 * meet: a game reads the outgoing world's state into the instance from
 * `worldClosing`, and seeds the incoming world from `worldOpened`.
 *
 * Everything here mirrors the `game-instance` API page under
 * `docs/engines/structured-3d/apis/` — that page is the specification, and a
 * member that disagrees with it is wrong.
 */

import type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";
import type { CueSpec } from "./audio";
import type { Engine } from "./engine";
import type { ActionBinding, TouchLayout } from "./input";
import type { Viewport } from "./math";
import type { EngineEvents, LevelDefinition, World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* The game definition                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What `EngineOptions.game` carries: the level registry, the level the engine
 * opens first, and the game instance class. One engine drives one definition
 * for its lifetime. `D` is the type of the debug surface the instance's
 * `initialize` returns, and `createEngine` infers it from the definition; a
 * game with no surface is a `GameDefinition<null>`.
 */
export interface GameDefinition<D = unknown> {
  /**
   * The class constructed once and kept across every level. Its `initialize`
   * fixes `D`, the debug surface. Omitting it uses {@link GameInstance}
   * itself, which suits a game whose whole state fits in its worlds.
   */
  instance?: GameInstanceClass<D>;
  /** The level registry, keyed by level name. At least one entry. */
  levels: Readonly<Record<string, LevelDefinition>>;
  /** The level `engine.initialize` opens. A key of `levels`. */
  startLevel: string;
}

/** An instance class the engine can construct: no constructor arguments. */
export type GameInstanceClass<D = unknown> = new () => GameInstance<D>;

/* -------------------------------------------------------------------------- */
/* InitApi                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the instance's `initialize` is handed. Everything declared here
 * belongs to the whole game and survives every level transition: the action
 * bindings, the cue definitions, the assets the instance holds, and the
 * diagnostic sources the overlay reads. An asset only one level needs is
 * loaded in that level's `load` instead, which the engine awaits before any
 * actor of that level exists.
 */
export interface InitApi {
  /** Registers the game's actions and reads the layout the engine was created with. */
  readonly input: {
    register(name: string, binding: ActionBinding): void;
    layout(): TouchLayout | null;
  };
  /** Defines synthesized cues and binds file-backed ones, for the whole run. */
  readonly audio: {
    define(cue: string, spec: CueSpec): void;
    load(cue: string, path: string): Promise<void>;
  };
  /** The typed loaders, resolving under `assetRoot`. */
  readonly assets: {
    loadMesh(path: string): Promise<MeshHandle>;
    loadTexture(path: string): Promise<TextureHandle>;
    loadMaterial(path: string): Promise<MaterialHandle>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  /** The instance registry: sources that persist across every transition. */
  readonly diagnostics: {
    register(name: string, source: () => unknown): void;
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
 * Assigns the engine-owned `declare readonly` fields of a freshly
 * constructed instance — `engine` and `events` — before its `initialize`
 * runs, so a constructor sets defaults and everything after construction
 * finds both in place.
 *
 * Internal: the engine calls this once, on the instance it constructed from
 * the game definition. The fields have no runtime presence of their own, so a
 * plain assignment is all that is needed; the helper exists so the cast lives
 * here, next to the class whose contract it upholds.
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
 */
export class GameInstance<D = unknown> {
  /** The engine driving this game. Assigned before `initialize` runs. */
  declare readonly engine: Engine<D>;

  /** The same broadcaster `engine.events` reaches. Assigned with `engine`. */
  declare readonly events: EngineEvents;

  /**
   * Called once, before the start level opens. Returns the debug surface — a
   * game with no surface returns `null`, and `undefined` is refused by the
   * engine. May return a promise, which the engine awaits before the start
   * level opens.
   *
   * The base returns `null`, which is only honest for a `GameInstance<null>`;
   * a game that declares a richer `D` overrides this and returns it.
   */
  initialize(api: InitApi): D | Promise<D> {
    void api;
    return null as D;
  }

  /** Called after each world's game mode has begun play. The base does nothing. */
  worldOpened(world: World): void {
    void world;
  }

  /** Called before each world's actors end play. The base does nothing. */
  worldClosing(world: World): void {
    void world;
  }

  /** Called once, from `engine.destroy`. The base does nothing. */
  shutdown(): void {}
}
