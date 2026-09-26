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
 * surface returns `null`, and `undefined` is refused by the engine.
 *
 * `worldOpened` and `worldClosing` are where the instance and the game state
 * meet: a game reads the outgoing world's state into the instance from
 * `worldClosing`, and seeds the incoming world from `worldOpened`.
 */

import type { Engine, EngineEvents, InitApi, World } from "./contract";

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
   * game with no surface returns `null`. May return a promise, which the
   * engine awaits before the start level opens.
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
