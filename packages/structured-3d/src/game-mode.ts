/**
 * The game mode, the game state, and the player states: the rules of a match
 * and the figures it keeps.
 *
 * A level names a mode class, and opening the level constructs the mode with
 * the options the transition supplied, builds the game state from the mode's
 * `gameStateClass`, and runs its `beginPlay` after every declared actor has
 * begun play. The mode is the only object that adds players and bots, restarts
 * their pawns, moves the match through its phases, and decides when the match
 * is over. It ticks after every actor has ticked and after collision has been
 * reported, so it decides the match from a settled world.
 *
 * The scoping rule the three classes carry between them: a value scoped to one
 * match lives on the game state, which is rebuilt with its world; a
 * per-participant figure lives on the player state, which survives every
 * respawn its controller performs; a value that must survive travel between
 * levels lives on the game instance instead.
 *
 * The match phase has exactly one home: the game state. `mode.phase` is a
 * getter over `state.phase` rather than a field of its own, because the docs
 * promise the two "always agree" and a promise held structurally cannot be
 * broken by a code path that forgot to write the second copy. `setPhase` is
 * still the one sanctioned way to move it, since it is what emits
 * `match:phase`.
 *
 * A mode reaches the engine's internals — the broadcaster it emits
 * `match:phase` on, the controller list it adds participants to, and the input
 * readers its player controllers consume — through the {@link GameModeHost}
 * the world binds it to via {@link bindGameMode}. The host is deliberately not
 * a field on the class: the public shape of `GameMode` is fixed by the docs,
 * and a game never sees the seam.
 *
 * Everything here mirrors the `game-mode` API page under
 * `docs/engines/structured-3d/apis/` — that page is the specification, and a
 * member that disagrees with it is wrong.
 */

import type { ActorClass, EndPlayReason, Pawn } from "./actors";
import {
  PlayerController,
  type AIController,
  type Controller,
  type ControllerClass,
} from "./controllers";
import type { InputReader } from "./input";
import type { Transform } from "./math";
import type { EngineEventMap, World } from "./worlds";

// The end-play vocabulary is declared once, with the actor lifecycle it
// belongs to; this page's Exports list carries it too, so it is re-exported
// here rather than declared twice.
export type { EndPlayReason } from "./actors";

/**
 * A mode class the world can construct: no constructor arguments, so a
 * constructor sets the mode's class fields and its own defaults. `world`,
 * `options`, and `state` are assigned before `beginPlay` runs.
 */
export type GameModeClass = new () => GameMode;

/**
 * Where the match stands: `"waiting"` while it is being set up (the phase a
 * mode holds when it begins play), `"playing"` while it runs (the only phase
 * `GameState.elapsed` accumulates in), and `"over"` once it is decided. The
 * phase changes only through {@link GameMode.setPhase}.
 */
export type MatchPhase = "waiting" | "playing" | "over";

/**
 * What a participant may be added with. Each present field stands in for what
 * the mode would otherwise choose.
 */
export interface PlayerOptions {
  /** The index the player state carries. Absent, the next free index. */
  index?: number;
  /** The name written onto the player state. */
  name?: string;
  /** The controller class to build. Absent, `playerControllerClass`. */
  controller?: ControllerClass<PlayerController>;
  /**
   * The pawn class to spawn and possess, in place of `pawnClass`. `null`
   * adds a controller that possesses nothing.
   */
  pawn?: ActorClass<Pawn> | null;
}

/**
 * What a bot may be added with. `addBot` takes the controller class as its
 * first argument, so this names no controller.
 */
export interface BotOptions {
  /** The name written onto the bot's player state. */
  name?: string;
  /**
   * The pawn class to spawn and possess, in place of `pawnClass`. `null`
   * adds a controller that possesses nothing.
   */
  pawn?: ActorClass<Pawn> | null;
}

/**
 * The seams a bound game mode drives its engine through.
 *
 * Internal: the world supplies one when it constructs the mode, through
 * {@link bindGameMode}. A test binds a mode to fakes the same way.
 */
export interface GameModeHost {
  /** Emits one engine event on the engine's broadcaster. */
  emit<K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void;
  /**
   * Appends the controller — its `world`, `playerState`, and (for a player)
   * `index` and `input` already assigned — to the world's controller list and
   * runs its `beginPlay`.
   */
  addController(controller: Controller): void;
  /**
   * A fresh input reader for one player controller. Each reader consumes
   * edges independently, so every `addPlayer` takes its own.
   */
  createInputReader(): InputReader;
}

/**
 * Where each bound mode finds its host. A weak map rather than a field so the
 * class's public shape stays exactly the documented one, and so an unbound
 * mode — one constructed by hand rather than by a world — is detectable.
 */
const hosts = new WeakMap<GameMode, GameModeHost>();

/**
 * Writes engine-owned `declare readonly` fields. The `declare` fields have no
 * runtime presence of their own, so a plain assignment is all that is needed;
 * funneling every such write through here keeps the casts in one place.
 */
function assignOwned(target: object, fields: Record<string, unknown>): void {
  Object.assign(target, fields);
}

/**
 * Attaches a freshly constructed mode to its world: assigns `world`,
 * `options`, and `state` (and the state's own `world`), and records the host
 * the mode's machinery drives.
 *
 * Internal: the world calls this once per mode, between constructing the mode
 * (which read `gameStateClass`) and the mode's `beginPlay`.
 */
export function bindGameMode(
  mode: GameMode,
  world: World,
  options: Readonly<Record<string, unknown>>,
  state: GameState,
  host: GameModeHost,
): void {
  assignOwned(mode, { world, options, state });
  assignOwned(state, { world });
  hosts.set(mode, host);
}

/**
 * The host behind a bound mode, or a refusal naming the member that needed it.
 * Only a mode constructed by hand — never one a level opening built — can be
 * unbound, so the error names the misuse rather than pretending to work.
 */
function hostOf(mode: GameMode, member: string): GameModeHost {
  const host = hosts.get(mode);
  if (host === undefined) {
    throw new Error(
      `structured-3d: ${member} needs a mode the engine built — ` +
        "this mode is not bound to a world",
    );
  }
  return host;
}

/**
 * The smallest non-negative index no current participant carries. Filling the
 * lowest gap (rather than counting past the highest) keeps "the next free
 * index" literal when a game assigned some indices explicitly.
 */
function nextFreeIndex(players: readonly PlayerState[]): number {
  const taken = new Set(players.map((player) => player.index));
  let index = 0;
  while (taken.has(index)) index += 1;
  return index;
}

/**
 * Inserts a player state into `state.players` keeping the list in index
 * order, a bot's alongside a player's. Equal indices keep insertion order.
 */
function insertByIndex(state: GameState, playerState: PlayerState): void {
  // The field is typed readonly for every reader; the mode is the one writer.
  const players = state.players as PlayerState[];
  let at = players.length;
  for (; at > 0; at -= 1) {
    const before = players[at - 1];
    if (before === undefined || before.index <= playerState.index) break;
  }
  players.splice(at, 0, playerState);
}

/** The identity transform, fresh: origin, no turn, unit scale. */
function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/**
 * The rules of a match.
 *
 * A mode is constructed with no arguments, so a constructor sets the mode's
 * class fields and its own defaults; `world`, `options`, and `state` are
 * assigned before `beginPlay` runs. The base class's `beginPlay`, `tick`,
 * `endPlay`, and `pawnDied` do nothing, so a mode overrides only what it
 * needs.
 */
export class GameMode {
  /** The world this mode governs. Assigned before `beginPlay`. */
  declare readonly world: World;

  /**
   * Whatever `world.open` was given, or an empty object for the start level.
   * Assigned before `beginPlay`.
   */
  declare readonly options: Readonly<Record<string, unknown>>;

  /**
   * The world's game state, the instance built from `gameStateClass`.
   * Assigned before `beginPlay`.
   */
  declare readonly state: GameState;

  /**
   * The class the game state is built from. Read once, when the world is
   * built. Defaults to {@link GameState}.
   */
  gameStateClass: new () => GameState = GameState;

  /**
   * The class each participant's state is built from. Read on each
   * `addPlayer` and `addBot`. Defaults to {@link PlayerState}.
   */
  playerStateClass: new () => PlayerState = PlayerState;

  /** The controller `addPlayer` builds when its options name none. */
  playerControllerClass: ControllerClass<PlayerController> = PlayerController;

  /**
   * The pawn `restart` spawns. `null` for a mode whose controllers possess
   * nothing.
   */
  pawnClass: ActorClass<Pawn> | null = null;

  /**
   * The match phase. Read from the game state — the phase's one home — so
   * `mode.phase` and `state.phase` agree by construction; it changes only
   * through {@link setPhase}. An unbound mode has no state yet and holds
   * `"waiting"`, the phase every mode begins play in.
   */
  get phase(): MatchPhase {
    const state = this.state as GameState | undefined;
    return state === undefined ? "waiting" : state.phase;
  }

  /**
   * Runs after every declared actor has begun play — where a mode adds its
   * players and sets its phase. The base does nothing.
   */
  beginPlay(): void {}

  /**
   * Runs once per frame, after every actor has ticked and after collision has
   * been reported, so the mode decides the match from a settled world. The
   * base does nothing.
   */
  tick(dt: number): void {
    void dt;
  }

  /**
   * Runs when the world closes, after every actor has ended play. The base
   * does nothing.
   */
  endPlay(reason: EndPlayReason): void {
    void reason;
  }

  /**
   * Builds the player state, the player controller, and the pawn, and
   * possesses. Assigns the next free index when the options name none.
   */
  addPlayer(options: PlayerOptions = {}): PlayerController {
    const host = hostOf(this, "GameMode.addPlayer");
    const controller = new (options.controller ?? this.playerControllerClass)();
    const index = options.index ?? nextFreeIndex(this.state.players);
    this.enroll(controller, index, options.name);
    // The reader and the index land before `beginPlay`, so a controller that
    // reads either from its own beginPlay finds them in place.
    assignOwned(controller, { index, input: host.createInputReader() });
    host.addController(controller);
    this.mount(controller, options.pawn);
    return controller;
  }

  /**
   * The same for an AI controller whose class the caller names. A bot's
   * player state carries the next free index and sits in `state.players`
   * alongside a player's.
   */
  addBot(
    type: ControllerClass<AIController>,
    options: BotOptions = {},
  ): AIController {
    const host = hostOf(this, "GameMode.addBot");
    const controller = new type();
    this.enroll(controller, nextFreeIndex(this.state.players), options.name);
    host.addController(controller);
    this.mount(controller, options.pawn);
    return controller;
  }

  /**
   * Destroys the controller's current pawn, spawns `pawnClass` at
   * `spawnPoint(controller)`, and possesses it. Returns `null` — touching
   * nothing — when `pawnClass` is `null`.
   */
  restart(controller: Controller): Pawn | null {
    if (this.pawnClass === null) return null;
    controller.pawn?.destroy();
    const pawn = this.world.spawn(this.pawnClass, {
      transform: this.spawnPoint(controller),
    });
    controller.possess(pawn);
    return pawn;
  }

  /**
   * Where `restart` places a pawn. The base implementation returns the
   * identity transform — position `(0, 0, 0)`, identity rotation, unit scale
   * — as a fresh value; a mode that places its pawns anywhere else overrides
   * it, returning a whole `Transform` with a rotation built by
   * `quatFromAxisAngle`.
   */
  spawnPoint(controller: Controller): Transform {
    void controller;
    return identityTransform();
  }

  /**
   * Runs when a possessed pawn is destroyed, after the pawn's `endPlay`. The
   * base does nothing.
   */
  pawnDied(controller: Controller, pawn: Pawn): void {
    void controller;
    void pawn;
  }

  /**
   * Sets the phase — writing it onto the game state, the phase's one home —
   * and emits `match:phase`. Setting the phase it already holds emits
   * nothing.
   */
  setPhase(phase: MatchPhase): void {
    const host = hostOf(this, "GameMode.setPhase");
    const previous = this.state.phase;
    if (phase === previous) return;
    this.state.phase = phase;
    host.emit("match:phase", { phase, previous });
  }

  /**
   * The shared half of `addPlayer` and `addBot`: builds the player state from
   * `playerStateClass`, wires it to the controller in both directions, hands
   * the controller its world, and seats the state in `state.players` in index
   * order.
   */
  private enroll(
    controller: Controller,
    index: number,
    name: string | undefined,
  ): void {
    const playerState = new this.playerStateClass();
    assignOwned(playerState, { index, controller });
    if (name !== undefined) playerState.name = name;
    assignOwned(controller, { world: this.world, playerState });
    insertByIndex(this.state, playerState);
  }

  /**
   * Spawns and possesses a freshly added participant's pawn. An options
   * `pawn` — a class or an explicit `null` — stands in for `pawnClass`; the
   * pawn arrives at `spawnPoint(controller)`, exactly as a respawn would.
   */
  private mount(
    controller: Controller,
    override: ActorClass<Pawn> | null | undefined,
  ): void {
    const pawnClass = override === undefined ? this.pawnClass : override;
    if (pawnClass === null) return;
    const pawn = this.world.spawn(pawnClass, {
      transform: this.spawnPoint(controller),
    });
    controller.possess(pawn);
  }
}

/**
 * The match figures every object may read: the phase, the elapsed match time,
 * and the player states.
 *
 * Built from the mode's `gameStateClass` when the world is built, and rebuilt
 * with it, so a transition clears a match's figures without the instance doing
 * anything. A game carries its own match figures by subclassing and naming the
 * subclass in `gameStateClass`.
 */
export class GameState {
  /** The world this state belongs to. Assigned when the world is built. */
  declare readonly world: World;

  /** Every player state, in index order, a bot's alongside a player's. */
  readonly players: readonly PlayerState[] = [];

  /** The phase `setPhase` last wrote. */
  phase: MatchPhase = "waiting";

  /**
   * Seconds accumulated while the phase is `"playing"` — the match clock
   * rather than the world clock.
   */
  elapsed = 0;
}

/**
 * One participant's durable record, built for a player and a bot alike.
 *
 * It belongs to the participant rather than to the pawn, so it survives every
 * respawn its controller performs. A game carries its own per-player figures
 * by subclassing and naming the subclass in `playerStateClass`.
 */
export class PlayerState {
  /** The participant's index, assigned when the player or bot is added. */
  declare readonly index: number;

  /** The controller this state belongs to. */
  declare readonly controller: Controller;

  /** The participant's display name. */
  name = "";

  /** The participant's score. */
  score = 0;
}
