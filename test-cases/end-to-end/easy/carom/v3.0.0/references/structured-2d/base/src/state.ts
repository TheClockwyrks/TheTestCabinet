// Carom — the screen vocabulary and the world's game state.
//
// The game's state lives in the framework objects the engine owns
// (specs/state.md). Carom maps onto them like this:
//
//   * The game INSTANCE (`src/game.ts`) carries what must survive a level
//     transition: the remembered title selection, the simulation clock, the
//     seeded generator, the AI's two faculties, and the debug surface's hold on
//     each paddle.
//   * The open world's GAME STATE (`CaromState`, below) carries what a level
//     scopes: the screen, the mode, the two menu figures, the winner, and the
//     side the next serve travels toward. The two scores live on the player
//     states the mode builds, where the framework keeps a score.
//   * The ACTORS carry the field's bodies: each paddle its `cy` and integrated
//     `vy` (`src/paddle.ts`), the ball its velocity, spin, hold, and trail
//     (`src/ball.ts`), each obstacle its fixed centre (`src/scenery.ts`).
//
// `screen` is the game's top-level state machine (specs/ui.md), and ALL SIX of
// its states are hosted by whichever world is open. That is what lets
// `setScreen` be the atomic pose specs/instrumentation.md fixes — one field
// set, with the scores, the world, and the menu indices left exactly as they
// were — rather than a level transition that would rebuild them. The two
// levels `LEVELS` names are the two ways a world is STARTED: `title` opens the
// game on its title screen, `match` opens a fresh match, and specs/ui.md fixes
// the whole arrangement each of those two acts performs.

import { GameState } from "@clockwyrks/structured-2d";
import type { World } from "@clockwyrks/structured-2d";
import type { CaromGame } from "./game";
import type { Side } from "./sim";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** The top-level state machine (specs/ui.md). */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

/** The two screens a pause resumes to, which `resumeScreen` holds. */
export type ResumeScreen = "countdown" | "playing";

/** Every screen, in the order specs/ui.md introduces them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "matchover",
];

/**
 * True on the screens the field simulates under: the paddles move, the ball
 * flies or waits out its hold, and the trail records (specs/ui.md).
 */
export function isLiveScreen(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing";
}

/**
 * The open world's game state: every declared field specs/state.md scopes to a
 * world, and nothing else. The scores are the player states' own.
 */
export class CaromState extends GameState {
  /**
   * The game instance, bound by `CaromGame.worldOpened` before the world's
   * first frame. It is how this world's controllers, actors, and mode reach
   * the state that outlives a transition.
   */
  declare game: CaromGame;

  /** The screen currently shown (specs/ui.md). */
  screen: Screen = "title";
  /** The mode the current or most recent match is played in. */
  mode: Mode = "solo";
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex = 0;
  /** The screen the pause menu resumes to. */
  resumeScreen: ResumeScreen = "playing";
  /** The winning side once the match is over, and null until then. */
  winner: Side | null = null;
  /**
   * The side the next serve travels toward: the player who was just scored
   * on. The first serve of a match travels toward player one ("left").
   */
  receiver: Side = "left";
}

/** The open world's Carom state. */
export function caromState(world: World): CaromState {
  const state = world.state;
  if (!(state instanceof CaromState)) {
    throw new Error(`Carom: the "${world.level}" level carries no Carom state`);
  }
  return state;
}

/** The open world's screen. */
export function screenOf(world: World): Screen {
  return caromState(world).screen;
}
