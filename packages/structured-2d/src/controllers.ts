/**
 * Controllers: the seat a pawn is driven from.
 *
 * The game mode builds one controller per player and one per bot, each
 * controller possesses a pawn, and the controller's tick writes that pawn's
 * intent for the frame. Every controller ticks before the first actor does, so
 * a pawn's own tick observes the intent its controller wrote this frame and
 * reads it as a plain field rather than as input.
 *
 * Input reaches the simulation through a player controller and nowhere else:
 * {@link PlayerController.input} is the one place a game reads an action. A
 * player pawn and an AI pawn are therefore the same class driven by two
 * different controllers, and a validator drives a pawn by substituting a
 * controller of its own.
 *
 * Possession keeps one controller on one pawn and one pawn under one
 * controller: `possess` unpossesses whatever the controller held (and whatever
 * controller already held the pawn), notifies the pawn, and emits
 * `possession:changed`; `unpossess` releases the pawn back into the world,
 * alive and ticking, with its intent whatever it was left holding.
 */

import type { Pawn } from "./actors";
import type {
  EndPlayReason,
  EngineEventMap,
  InputReader,
  World,
} from "./contract";
import type { PlayerState } from "./game-mode";

/**
 * The internal half of the engine's broadcaster. `EngineEvents` declares only
 * `on`, so a game cannot emit; the possession machinery reaches the emitting
 * half by this shape, which the engine's event bus implements. A controller
 * outside a world (a bare one a check constructed) has no bus to reach, and
 * its possession changes then go unannounced rather than refused.
 */
interface PossessionEmitter {
  emit?<K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void;
}

/** Broadcast one `possession:changed`, when the controller's world carries a bus. */
function emitPossessionChanged(
  controller: Controller,
  pawn: Pawn | null,
  previous: Pawn | null,
): void {
  // `world` is declared assigned-before-`beginPlay`, but a check may possess
  // through a controller it constructed bare, so the read tolerates both.
  const world = (controller as { world?: World }).world;
  const events = world?.events as PossessionEmitter | undefined;
  events?.emit?.("possession:changed", { controller, pawn, previous });
}

/** Assignment casts for the two readonly halves of the possession link. */
function link(controller: Controller, pawn: Pawn | null): void {
  (controller as { pawn: Pawn | null }).pawn = pawn;
}
function seat(pawn: Pawn, controller: Controller | null): void {
  (pawn as { controller: Controller | null }).controller = controller;
}

/**
 * The will behind a pawn.
 *
 * The base class's methods do nothing, so a subclass overrides only what it
 * needs: it reads its input or runs its behavior in `tick` and writes to
 * `this.pawn`.
 */
export class Controller {
  /** The world that holds the controller. Assigned before `beginPlay`. */
  declare readonly world: World;

  /**
   * The player state built alongside the controller, carrying its index,
   * name, and score. It is the durable half of a participant: it survives
   * every respawn the controller performs.
   */
  declare readonly playerState: PlayerState;

  /** The pawn the controller holds, or `null`. Changed only through possession. */
  readonly pawn: Pawn | null = null;

  /**
   * Takes `pawn`: releases whatever this controller held, unpossesses the
   * controller already holding `pawn` if any, sets `pawn`, notifies it through
   * `possessedBy`, and emits `possession:changed`.
   *
   * One event per controller whose possession changed: a robbed controller
   * announces its own unpossession, and this controller announces the take,
   * carrying what it held before as `previous` — so its own released pawn is
   * part of the take's event rather than a second one.
   */
  possess(pawn: Pawn): void {
    // Release what this controller held, without an event of its own: the
    // take's `previous` field carries it.
    const previous = this.pawn;
    if (previous !== null) {
      link(this, null);
      seat(previous, null);
      previous.unpossessed();
    }

    // Unpossess the controller already holding the pawn, so possession stays
    // exclusive in both directions. That controller's change is its own, so
    // it emits.
    const holder = pawn.controller;
    if (holder !== null && holder !== this) holder.unpossess();

    link(this, pawn);
    seat(pawn, this);
    pawn.possessedBy(this);
    emitPossessionChanged(this, pawn, previous);
  }

  /**
   * Releases the held pawn: clears `pawn`, notifies the released pawn through
   * its `unpossessed`, and emits `possession:changed`. The released pawn stays
   * in the world, alive and ticking. A controller holding nothing has nothing
   * to release, so the call then does nothing and emits nothing.
   */
  unpossess(): void {
    const released = this.pawn;
    if (released === null) return;

    link(this, null);
    seat(released, null);
    released.unpossessed();
    emitPossessionChanged(this, null, released);
  }

  /** Runs once, as the controller is added to the world. The base does nothing. */
  beginPlay(): void {}

  /**
   * Runs once per frame, before any actor ticks. `dt` is seconds. The base
   * does nothing.
   */
  tick(dt: number): void {
    void dt;
  }

  /**
   * Runs with `"level-closed"` when the world closes, in reverse order of
   * addition, before the actors end play. The base does nothing.
   */
  endPlay(reason: EndPlayReason): void {
    void reason;
  }
}

/**
 * A controller driven by the player: it reads the registered actions through
 * its reader and writes the result onto the pawn it possesses.
 */
export class PlayerController extends Controller {
  /**
   * The player index the controller was added under, which is the value its
   * player state carries.
   */
  declare readonly index: number;

  /**
   * The reader for the registered actions — the only place a game reads an
   * action. Each player controller consumes edges independently.
   */
  declare readonly input: InputReader;
}

/**
 * A controller driven by the game: it computes the same drive a player
 * controller reads, from the world, and writes it to its pawn the same way.
 */
export class AIController extends Controller {}
