// Facet — the screens and their menus (specs/ui.md).
//
// Five screens, three of them carrying a vertical menu, and one highlighted
// item per menu counted from `0`. Every transition here is a pure function of
// the state, which is what lets the debug surface pose `start`, `openHowTo`,
// `pause`, `resume`, and `quit` as exactly the choices a player makes rather
// than as a second path into the same screens.
//
// `menuIndex` is `0` on entering every screen, and on a screen with no menu it
// stays `0`.

import {
  CURSOR_START_COL,
  CURSOR_START_ROW,
  GAMEOVER_ITEMS,
  PAUSED_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import { confirmCell, moveCursor } from "./controls";
import { dealOpeningBoard } from "./deal";
import {
  EMPTY_BOARD,
  quiet,
  type FacetState,
  type Screen,
  type Stepped,
} from "./state";

/** The menu a screen shows, or an empty list for a screen carrying none. */
export function menuItemsFor(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSED_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return [];
  }
}

/** The menu highlight moved by one item, wrapping at both ends. */
export function moveMenu(state: FacetState, delta: number): FacetState {
  const items = menuItemsFor(state.screen);
  if (items.length === 0) return { ...state, menuIndex: 0 };
  const menuIndex =
    (((state.menuIndex + delta) % items.length) + items.length) % items.length;
  return { ...state, menuIndex };
}

/**
 * `up` and `down`, which carry the menu highlight on a menu screen and the
 * board cursor on `playing` — one action, two jobs, as `specs/controls.md`
 * lists them.
 */
export function moveVertical(state: FacetState, delta: number): FacetState {
  return state.screen === "playing"
    ? moveCursor(state, 0, delta)
    : moveMenu(state, delta);
}

/** `left` and `right`, which move the cursor and nothing else. */
export function moveHorizontal(state: FacetState, delta: number): FacetState {
  return state.screen === "playing" ? moveCursor(state, delta, 0) : state;
}

// ---- The transitions -----------------------------------------------------

/**
 * A fresh round, which is what `PLAY` and `PLAY AGAIN` both start: the figures
 * back at their opening values and an opening board dealt through the game's
 * own code, so it holds no run under R4 and carries at least one legal swap.
 *
 * `rngState` is not reseeded — it advances by the deal — so a round from a
 * known deal is a `reset` carrying a seed followed by this.
 */
export function startRound(state: FacetState): FacetState {
  const deal = dealOpeningBoard(state.rngState);
  return {
    ...state,
    screen: "playing",
    menuIndex: 0,
    board: deal.board,
    rngState: deal.rngState,
    score: 0,
    level: 1,
    levelScore: 0,
    phase: "idle",
    chainStep: 0,
    stepTimer: 0,
    chainSwap: null,
    lastCleared: 0,
    lastPoints: 0,
    cursor: { col: CURSOR_START_COL, row: CURSOR_START_ROW },
    selection: null,
    refusal: null,
    refusalTimer: 0,
  };
}

/** `HOW TO PLAY` from the title menu. */
export function openHowTo(state: FacetState): FacetState {
  return { ...state, screen: "howto", menuIndex: 0 };
}

/** The `pause` action from `playing`. Every timer holds where it stands. */
export function pauseGame(state: FacetState): FacetState {
  if (state.screen !== "playing") return state;
  return { ...state, screen: "paused", menuIndex: 0 };
}

/** `RESUME`, and the `pause` and `back` actions from `paused`. */
export function resumeGame(state: FacetState): FacetState {
  if (state.screen !== "paused") return state;
  return { ...state, screen: "playing", menuIndex: 0 };
}

/** The `pause` action, which enters and leaves `paused` from `playing`. */
export function togglePause(state: FacetState): FacetState {
  if (state.screen === "playing") return pauseGame(state);
  if (state.screen === "paused") return resumeGame(state);
  return state;
}

/**
 * `QUIT`, which the pause menu and the game-over menu both offer: the round is
 * abandoned and no board is in play. `score`, `level`, and `levelScore` hold
 * what the round left them at, and the next `start` begins a fresh round.
 */
export function quitToTitle(state: FacetState): FacetState {
  return {
    ...state,
    screen: "title",
    menuIndex: 0,
    board: EMPTY_BOARD,
    phase: "idle",
    chainStep: 0,
    stepTimer: 0,
    chainSwap: null,
    selection: null,
    refusal: null,
    refusalTimer: 0,
    pressedCell: null,
    dragSwapped: false,
  };
}

/** `back`, which leaves `howto`, `paused`, and `gameover`. */
export function goBack(state: FacetState): FacetState {
  switch (state.screen) {
    case "howto":
      return { ...state, screen: "title", menuIndex: 0 };
    case "paused":
      return resumeGame(state);
    case "gameover":
      return { ...state, screen: "title", menuIndex: 0 };
    default:
      return state;
  }
}

/** `confirm` on a menu screen: the highlighted item taken. */
export function confirmMenu(state: FacetState): FacetState {
  const items = menuItemsFor(state.screen);
  const item = items[state.menuIndex];
  switch (item) {
    case "PLAY":
    case "PLAY AGAIN":
      return startRound(state);
    case "HOW TO PLAY":
      return openHowTo(state);
    case "RESUME":
      return resumeGame(state);
    case "QUIT":
      return quitToTitle(state);
    default:
      return state;
  }
}

/**
 * The `confirm` action, wherever it is pressed: the highlighted menu item on a
 * menu screen, and the cursor's cell on `playing`.
 */
export function confirm(state: FacetState): Stepped {
  if (state.screen === "playing") return confirmCell(state);
  return quiet(confirmMenu(state));
}
