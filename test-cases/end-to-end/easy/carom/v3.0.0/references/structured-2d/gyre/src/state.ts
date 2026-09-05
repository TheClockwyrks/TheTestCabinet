// Carom — the screen vocabulary and the one game state both levels build.
//
// The game's state lives in the framework objects the engine owns
// (specs/state.md). Carom maps onto them like this:
//
//   * The game INSTANCE (`src/game.ts`) carries what must survive a level
//     transition: the mode of the current or most recent match, the title
//     menu's remembered selection, the simulation clock, the seeded
//     generator, and — while a transition is in flight — the carried state the
//     incoming world is dressed from (`src/carry.ts`).
//   * The world's GAME STATE (`CaromState`, below) carries the screen, the
//     menus, the match figures, the AI's two faculties, and the obstacle
//     clock. Both levels build the same class, so every declared field is
//     readable and posable on every screen — which is what
//     specs/instrumentation.md's snapshot asks for.
//   * The ACTORS carry the field's bodies: each paddle its `cy`, integrated
//     `vy`, and the debug driver's hold on it (`src/paddle.ts`), the ball its
//     velocity, spin, hold, and trail (`src/ball.ts`), and each obstacle its
//     live pose on its transform (`src/scenery.ts`). Whether a body is on the
//     field is whether its actor is in the world.
//
// `screen` is the game's top-level state machine (specs/ui.md), split across
// the two levels `src/constants.ts` names: `title` and `howto` are the title
// level's screens, and `countdown`, `playing`, `paused`, and `matchover` are
// the match level's. `levelOf` is that split written down once, and it is what
// lets `setScreen` and the menus route a screen change through the transition
// the engine performs at the end of the frame.

import { GameState } from "@clockwyrks/structured-2d";
import type { World } from "@clockwyrks/structured-2d";
import { LEVELS, type LevelName } from "./constants";
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

/** The two screens a pause resumes to. */
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

/** Which level hosts a screen. */
export function levelOf(screen: Screen): LevelName {
  return screen === "title" || screen === "howto" ? LEVELS.title : LEVELS.match;
}

/**
 * True on the screens the field simulates under: the paddles move, the ball
 * flies or waits out its hold, the trail records, and the obstacle clock winds
 * (specs/ui.md).
 */
export function isLiveScreen(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing";
}

/**
 * The whole of Carom's world-scoped state, built by both levels' modes.
 *
 * One class rather than one per level, because every field below is reported by
 * `snapshot()` and posed by the debug surface on EVERY screen
 * (specs/instrumentation.md) — the title screen declares a receiver and an AI
 * exactly as a live rally does. What differs between the two levels is which
 * screens they host and which actors they place, not which figures they carry.
 */
export class CaromState extends GameState {
  /**
   * The game instance, bound by `CaromGame.worldOpened` before the world's
   * first frame. It is how the world's controllers, mode, and components reach
   * the state that outlives a world: the mode, the title menu's remembered
   * selection, the simulation clock, and the seeded generator.
   */
  declare game: CaromGame;

  /** The screen currently shown (specs/ui.md). */
  screen: Screen = "title";
  /** The highlighted item on whichever menu `screen` is showing. */
  menuIndex = 0;
  /** The screen the pause menu resumes to. */
  resumeScreen: ResumeScreen = "playing";

  /** The two scores: `p1` the left player's, `p2` the right player's. */
  score: { p1: number; p2: number } = { p1: 0, p2: 0 };
  /** The winning side once the match is over, and null until then. */
  winner: Side | null = null;
  /** The side the next serve travels toward (specs/balls.md). */
  receiver: Side = "left";

  /** The AI's two faculties, each gated on its own (specs/state.md). */
  ai: { tracking: boolean; movement: boolean } = {
    tracking: true,
    movement: true,
  };

  /** The obstacle clock, the sole input to both obstacle poses. */
  obstacleClock = 0;
  /** Whether that clock advances with the frame. */
  obstacleClockRunning = true;

  /**
   * The menu item a pointer or a touch contact came down on, held until it
   * lifts. A confirm takes BOTH of its edges inside one item's region
   * (specs/ui.md), so the landing has to be remembered across the frames a
   * slow click spans. It is presentation rather than a declared figure, so no
   * operation poses it and no snapshot reports it.
   */
  pressedItem: number | null = null;
}

/** The open world's Carom state. */
export function caromState(world: World): CaromState {
  const state = world.state;
  if (state instanceof CaromState) return state;
  throw new Error(`Carom: the "${world.level}" level carries no Carom state`);
}

/** The open world's screen, whichever level is up. */
export function screenOf(world: World): Screen {
  return caromState(world).screen;
}
