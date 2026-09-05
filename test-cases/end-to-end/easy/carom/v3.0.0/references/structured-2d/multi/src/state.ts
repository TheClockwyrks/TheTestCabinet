// Carom — the screen vocabulary and the one game state both levels build.
//
// The game's state lives in the framework objects the engine owns
// (specs/state.md). Carom maps onto them like this:
//
//   * The game INSTANCE (`src/game.ts`) carries what must survive a level
//     transition: the mode, the title menu's remembered selection, the
//     accumulated simulation time, the seeded generator, the AI's two
//     faculties, and the debug driver's hold on each paddle.
//   * The world's GAME STATE (`CaromState`, below) carries what is scoped to
//     the screen a world is showing: the screen itself, the highlighted menu
//     item, the screen a pause resumes to, the two scores, and the winner.
//   * The ACTORS carry the field's bodies: each paddle its `cy` and integrated
//     `vy` (`src/paddle.ts`), each present ball its own velocity, spin, hold,
//     and trail (`src/ball.ts`), and each present obstacle its fixed centre
//     (`src/scenery.ts`).
//
// ONE state class serves BOTH levels. `screen` is the game's top-level state
// machine (specs/ui.md) and every screen is a value of it, so a pose that moves
// between screens sets one field wherever it lands; the two levels differ in
// the RULES they run over that state — the title level's menu and the match
// level's match — rather than in the vocabulary they keep it in.

import { GameState } from "@clockwyrks/structured-2d";
import type { World } from "@clockwyrks/structured-2d";
import type { CaromGame } from "./game";
import type { Side } from "./sim";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** The top-level state machine (specs/ui.md). */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

/** The two screens a pause can resume to. */
export type ResumeScreen = "countdown" | "playing";

/** The screens the title level hosts; the other four are the match level's. */
const TITLE_SCREENS: readonly Screen[] = ["title", "howto"];

/** Whether `screen` is one the title level runs the rules for. */
export function isTitleScreen(screen: Screen): boolean {
  return TITLE_SCREENS.includes(screen);
}

/**
 * True on the screens the field simulates under: the paddles move, each ball
 * counts its own hold down or flies, and the trails record (specs/ui.md).
 */
export function isLiveScreen(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing";
}

/**
 * The state every world carries, whichever level built it.
 *
 * The scores live here rather than on the framework's player states because
 * `setScore` and `snapshot` reach them on every screen (specs/instrumentation.md),
 * including the title, where a match's participants do not exist.
 */
export class CaromState extends GameState {
  /**
   * The game instance, bound by `CaromGame.worldOpened` before the world's
   * first frame. It is how this world's controllers, actors, and mode reach the
   * state that outlives a level: the mode, the driver, the AI's faculties, and
   * the seeded generator.
   */
  declare game: CaromGame;

  /** The screen currently shown (specs/ui.md). */
  screen: Screen = "title";
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex = 0;
  /** The screen the pause menu resumes to. */
  resumeScreen: ResumeScreen = "playing";
  /** The two scores, player one's on the left. */
  score: { p1: number; p2: number } = { p1: 0, p2: 0 };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null = null;
}

/** The open world's Carom state. */
export function stateOf(world: World): CaromState {
  const state = world.state;
  if (!(state instanceof CaromState)) {
    throw new Error(`Carom: the "${world.level}" level carries no Carom state`);
  }
  return state;
}

/** The open world's screen. */
export function screenOf(world: World): Screen {
  return stateOf(world).screen;
}

/** The game instance behind the open world. */
export function gameOf(world: World): CaromGame {
  return stateOf(world).game;
}

/**
 * Whether this frame simulates the field: a live screen, and no level
 * transition in flight.
 *
 * A screen pose that has to cross a level boundary opens the other level and
 * the engine honors that at the end of the frame, so the world the pose landed
 * in runs one more frame before it closes. That frame is INERT — the paddles,
 * the balls, and the holds stand exactly where the pose left them — because the
 * arrangement carried into the incoming world is read off that outgoing one,
 * and a frame of drift in between would be a frame the pose did not ask for
 * (specs/instrumentation.md).
 */
export function isSimulating(world: World): boolean {
  const state = stateOf(world);
  return isLiveScreen(state.screen) && !state.game.frozen;
}
