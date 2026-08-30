// Coil — the screens, and what one press edge does on each of them
// (specs/ui.md, specs/controls.md).
//
// Every function here WRITES THE LIVE STATE it is given and returns nothing: the
// framework's game states are one instance per world, and a screen change is a
// field of that instance rather than a level transition, so the world and its
// state live for the whole session. The player controller in
// `src/controller.ts` is the one caller during play; the debug surface reaches
// `resetSession` for the same reason a fresh session does.
//
// Nothing here reads the keyboard, the clock or the bus. `handleAction` is
// handed one already-resolved action name, so the same routing runs whether the
// press came from a key, a touch pad, or a test.

import {
  DEFAULT_SEED,
  OBSTACLE_CELLS,
  type ActionName,
  type Direction,
  type Screen,
} from "./constants";
import type { CoilState } from "./game";
import { menuItems } from "./menus";
import { seedState } from "./rng";
import { layChain, requestTurn, spawnPellet } from "./sim";

/** The actions that steer, and the direction each one asks for. */
const STEER: Partial<Record<ActionName, Direction>> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

/**
 * Every field the snapshot reports back to its opening value: the title screen,
 * a fresh round laid out but not started, the mode's obstacle course, all three
 * driver switches on, and the generator reseeded.
 *
 * `muted` is untouched, because muting is a player preference the engine owns
 * rather than a value a round opens with, and `sprites` is untouched because the
 * loaded art is not something a round decides. This is what the state's own
 * field initializers produce, restated as a transition so a `reset` and a fresh
 * session leave the game in the same place.
 */
export function resetSession(state: CoilState, seed = DEFAULT_SEED): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.best = 0;
  state.ticks = 0;
  state.simTime = 0;
  state.pellet = null;
  state.obstacles = OBSTACLE_CELLS.map((cell) => ({
    col: cell.col,
    row: cell.row,
  }));
  state.steering = true;
  state.travel = true;
  state.pelletRespawn = true;
  state.accumulator = 0;
  state.biteRemaining = 0;
  state.rngState = seedState(seed);
  // The chain, the heading, the buffer, the score and the combo, laid the way a
  // round opens them.
  layChain(state);
}

/** Begin a round: the board as `specs/board.md` lays it, with its first pellet. */
export function startRound(state: CoilState): void {
  state.screen = "playing";
  state.menuIndex = 0;
  state.accumulator = 0;
  state.biteRemaining = 0;
  state.pellet = null;
  layChain(state);
  // Placed after the chain is laid, so it never lands under a starting cell.
  spawnPellet(state);
}

/** Move to `screen` and highlight its first item. */
export function goTo(state: CoilState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = 0;
}

/**
 * Route one press edge to what it does on the screen the game is on
 * (specs/controls.md).
 *
 * Deliberately blind to `mute`: muting is the engine's bit rather than a field
 * of the state, so the controller reads that edge and flips the bus, and this
 * routes everything else.
 */
export function handleAction(state: CoilState, action: ActionName): void {
  if (state.screen === "playing") {
    const dir = STEER[action];
    if (dir) requestTurn(state, dir);
    else if (action === "back" || action === "pause") goTo(state, "paused");
    return;
  }
  routeMenu(state, action);
}

function routeMenu(state: CoilState, action: ActionName): void {
  const items = menuItems(state.screen);
  switch (action) {
    case "up":
      if (items.length === 0) return;
      state.menuIndex = (state.menuIndex - 1 + items.length) % items.length;
      return;
    case "down":
      if (items.length === 0) return;
      state.menuIndex = (state.menuIndex + 1) % items.length;
      return;
    case "confirm":
      accept(state);
      return;
    case "back":
      leave(state);
      return;
    case "pause":
      if (state.screen === "paused") goTo(state, "playing");
      return;
    default:
      return;
  }
}

/**
 * Accept the highlighted item of the current screen's menu.
 *
 * Keyed by the item's index rather than by its label, so the title's first item
 * starts a round whatever the mode names it.
 */
function accept(state: CoilState): void {
  const index = state.menuIndex;
  switch (state.screen) {
    case "title":
      if (index === 0) startRound(state);
      else goTo(state, "howto");
      return;
    case "howto":
      goTo(state, "title");
      return;
    case "paused":
      if (index === 0) goTo(state, "playing");
      else if (index === 1) startRound(state);
      else goTo(state, "title");
      return;
    case "gameover":
    case "cleared":
      if (index === 0) startRound(state);
      else goTo(state, "title");
      return;
    default:
      return;
  }
}

/** Leave the current screen for the one it was reached from. */
function leave(state: CoilState): void {
  switch (state.screen) {
    case "howto":
    case "gameover":
    case "cleared":
      goTo(state, "title");
      return;
    case "paused":
      goTo(state, "playing");
      return;
    default:
      return;
  }
}
