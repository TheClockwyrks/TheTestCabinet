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
  OBSTACLE_CELLS,
  type ActionName,
  type Direction,
  type Screen,
} from "./constants";
import type { CoilState } from "./game";
import type { PointerSample } from "@clockwyrks/structured-2d";
import { menuItemAt, menuItems } from "./menus";
import { layChain, requestTurn, spawnPellet } from "./sim";

/**
 * What routing one press edge did that only the caller can answer for.
 *
 * One thing: a fresh round being LAID OUT. `specs/ui.md` sounds the music bed
 * when "a round begins", and a round beginning is something the routing does
 * rather than a screen the state lands on — three menu items lay a fresh round
 * and a fourth returns to the round already running, and all four leave `screen`
 * at `playing`. Reporting it keeps this file blind to the bus, as its header
 * requires, while still letting the one caller that holds the bus sound the cue
 * on exactly the frames a round began on.
 */
export interface Routed {
  /** Whether this edge laid a fresh round out. */
  roundBegan: boolean;
}

/** Nothing the caller has to answer for. */
const ROUTED_NOTHING: Routed = { roundBegan: false };

/** A fresh round was laid out. */
const ROUTED_ROUND_BEGAN: Routed = { roundBegan: true };

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
 * driver switches on, and no posed pellet cell.
 *
 * `muted` is untouched, because muting is a player preference the engine owns
 * rather than a value a round opens with, and `sprites` is untouched because the
 * loaded art is not something a round decides. This is what the state's own
 * field initializers produce, restated as a transition so a `reset` and a fresh
 * session leave the game in the same place.
 */
export function resetSession(state: CoilState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.titleIndex = 0;
  state.pressedItem = null;
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
  state.nextPellet = null;
  state.accumulator = 0;
  state.biteRemaining = 0;
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

/**
 * Move to `screen` and highlight the item it opens on.
 *
 * The title opens on its remembered selection, so leaving how-to-play lands back
 * on the entry that opened it and a round left for the title lands back on the
 * entry that started it (`specs/ui.md`). Every other screen opens on its first
 * item.
 */
export function goTo(state: CoilState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = screen === "title" ? state.titleIndex : 0;
}

/**
 * Route one pointer or touch sample over the current screen's menu
 * (`specs/ui.md`).
 *
 * A sample carries the logical stage units the menus are laid out in. A move,
 * and a contact landing, select the item they are over; a press and the release
 * that answers it confirm the item when both fell inside the one region, so a
 * press slid off its entry confirms nothing. The `playing` screen shows no menu,
 * so nothing there is read.
 */
export function handlePointer(state: CoilState, sample: PointerSample): Routed {
  if (state.screen === "playing") {
    state.pressedItem = null;
    return ROUTED_NOTHING;
  }
  const item = menuItemAt(state.screen, sample.x, sample.y);
  if (item !== null) state.menuIndex = item;
  if (sample.type === "move") return ROUTED_NOTHING;
  if (sample.type === "down") {
    state.pressedItem = item;
    return ROUTED_NOTHING;
  }
  const armed = state.pressedItem;
  state.pressedItem = null;
  if (item === null || item !== armed) return ROUTED_NOTHING;
  return accept(state);
}

/**
 * Route one press edge to what it does on the screen the game is on
 * (specs/controls.md).
 *
 * Deliberately blind to `mute`: muting is the engine's bit rather than a field
 * of the state, so the controller reads that edge and flips the bus, and this
 * routes everything else.
 */
export function handleAction(state: CoilState, action: ActionName): Routed {
  if (state.screen === "playing") {
    const dir = STEER[action];
    if (dir) requestTurn(state, dir);
    else if (action === "back" || action === "pause") goTo(state, "paused");
    return ROUTED_NOTHING;
  }
  return routeMenu(state, action);
}

function routeMenu(state: CoilState, action: ActionName): Routed {
  const items = menuItems(state.screen);
  switch (action) {
    case "up":
      if (items.length === 0) return ROUTED_NOTHING;
      state.menuIndex = (state.menuIndex - 1 + items.length) % items.length;
      return ROUTED_NOTHING;
    case "down":
      if (items.length === 0) return ROUTED_NOTHING;
      state.menuIndex = (state.menuIndex + 1) % items.length;
      return ROUTED_NOTHING;
    case "confirm":
      return accept(state);
    case "back":
      leave(state);
      return ROUTED_NOTHING;
    case "pause":
      if (state.screen === "paused") goTo(state, "playing");
      return ROUTED_NOTHING;
    default:
      return ROUTED_NOTHING;
  }
}

/**
 * Accept the highlighted item of the current screen's menu.
 *
 * Keyed by the item's index rather than by its label, so the title's first item
 * starts a round whatever the mode names it.
 */
function accept(state: CoilState): Routed {
  const index = state.menuIndex;
  // The title remembers what was confirmed on it, whichever input confirmed it.
  if (state.screen === "title") state.titleIndex = index;
  switch (state.screen) {
    case "title":
      if (index !== 0) {
        goTo(state, "howto");
        return ROUTED_NOTHING;
      }
      startRound(state);
      return ROUTED_ROUND_BEGAN;
    case "howto":
      goTo(state, "title");
      return ROUTED_NOTHING;
    case "paused":
      if (index === 0) {
        goTo(state, "playing");
        return ROUTED_NOTHING;
      }
      if (index !== 1) {
        goTo(state, "title");
        return ROUTED_NOTHING;
      }
      startRound(state);
      return ROUTED_ROUND_BEGAN;
    case "gameover":
    case "cleared":
      if (index !== 0) {
        goTo(state, "title");
        return ROUTED_NOTHING;
      }
      startRound(state);
      return ROUTED_ROUND_BEGAN;
    default:
      return ROUTED_NOTHING;
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
