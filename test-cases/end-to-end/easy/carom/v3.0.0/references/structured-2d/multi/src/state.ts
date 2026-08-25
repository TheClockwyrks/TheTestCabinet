// Carom — the screen vocabulary and the two game states.
//
// The game's state lives in the framework objects the engine owns
// (specs/state.md). Carom maps onto them like this:
//
//   * The game INSTANCE (`src/game.ts`) carries what must survive a level
//     transition: the last match's mode, the seeded generator's state, and the
//     debug driver's hold on the paddles.
//   * Each LEVEL's game state carries what is scoped to that level. The title
//     level holds the menu (`TitleState`); the match level holds the match
//     (`MatchState`) — with the two scores on the participants' player states,
//     where the framework keeps a score.
//   * The ACTORS carry the field's bodies: each paddle its `cy` and integrated
//     `vy` (`src/paddle.ts`), and each of the three balls its own velocity,
//     spin, hold, and trail (`src/ball.ts`) — the holds are per ball
//     (specs/balls.md), so no match-wide hold timer exists to keep here.
//
// `screen` is the game's top-level state machine (specs/ui.md), split across
// the two levels: `title` and `howto` are the title level's screens, and
// `countdown`, `playing`, `paused`, and `matchover` are the match level's.
// `screenOf` reads whichever the open world holds, so an actor or a component
// gates itself on the screen without knowing which level it is in.

import { GameState } from "@test-cabinet/structured-2d";
import type { World } from "@test-cabinet/structured-2d";
import type { CaromGame } from "./game";
import type { Side } from "./sim";

/** The two ways to play (specs/modes/). */
export type Mode = "solo" | "versus";

/** The screens the title level hosts. */
export type TitleScreen = "title" | "howto";

/** The screens the match level hosts. */
export type MatchScreen = "countdown" | "playing" | "paused" | "matchover";

/** The top-level state machine (specs/ui.md). */
export type Screen = TitleScreen | MatchScreen;

/** True on the screens the field simulates under: the paddles move, the balls
 * fly or wait out their own holds, and the trails record. */
export function isLiveScreen(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing";
}

/** The title level's state: which of its screens is up, and the menu. */
export class TitleState extends GameState {
  screen: TitleScreen = "title";
  /** The highlighted item of the title menu. */
  menuIndex = 0;
}

/**
 * The match level's state. The scores live on the player states the mode
 * builds (`state.players`, index 0 the left side, 1 the right), and each
 * ball's hold lives on that ball, so neither is repeated here; everything else
 * specs/state.md names for a match is.
 */
export class MatchState extends GameState {
  /**
   * The game instance, bound by `CaromGame.worldOpened` before the first
   * frame. It is how the world's controllers and mode reach the cross-level
   * state: the debug driver's hold and the seeded generator.
   */
  declare game: CaromGame;

  /** The screen currently shown (specs/ui.md). */
  screen: MatchScreen = "countdown";
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex = 0;
  /** The screen the pause menu resumes to: `countdown` or `playing`. */
  resumeScreen: MatchScreen = "playing";
  /** The winning side once the match is over, and null until then. */
  winner: Side | null = null;
}

/** The open world's screen, whichever level is up. */
export function screenOf(world: World): Screen {
  const state = world.state;
  if (state instanceof MatchState) return state.screen;
  if (state instanceof TitleState) return state.screen;
  throw new Error(`Carom: the "${world.level}" level carries no screen`);
}
