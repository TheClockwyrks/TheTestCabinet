// Facet — the screens and their menus (specs/ui.md).
//
// Six screens, four of them carrying a vertical menu, and one highlighted item
// per menu counted from `0`. Every transition here is a pure function of the
// state, which is what lets the debug surface pose `start`, `openHowTo`,
// `pause`, `resume`, `continueLevel`, and `quit` as exactly the choices a
// player makes rather than as a second path into the same screens.
//
// `menuIndex` is `0` on entering every screen but one — `back` from `howto`
// puts the highlight back on the item that opened it — and on a screen with no
// menu it stays `0`. Every transition also clears `armedTarget`, because
// leaving a screen disarms whatever a press armed on it and a press carried
// across a screen change takes nothing (specs/controls.md).

import {
  GAMEOVER_ITEMS,
  LEVELCLEAR_ITEMS,
  PAUSED_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import { dealOpeningBoard } from "./deal";
import { EMPTY_BOARD, type FacetState, type Screen } from "./state";

/** The menu a screen shows, or an empty list for a screen carrying none. */
export function menuItemsFor(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSED_ITEMS;
    case "levelclear":
      return LEVELCLEAR_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return [];
  }
}

/**
 * `up` and `down`: the menu highlight moved by one item, wrapping at both ends.
 * The board is played with the pointer alone, so these two have one job on
 * every screen, and on a screen with no menu `menuIndex` simply rests at `0`.
 */
export function moveMenu(state: FacetState, delta: number): FacetState {
  const items = menuItemsFor(state.screen);
  if (items.length === 0) return { ...state, menuIndex: 0 };
  const menuIndex =
    (((state.menuIndex + delta) % items.length) + items.length) % items.length;
  return { ...state, menuIndex };
}

// ---- The transitions -----------------------------------------------------

/**
 * A fresh round, which is what `PLAY` and `PLAY AGAIN` both start: the figures
 * back at their opening values and an opening board dealt through the game's
 * own code, so it holds no run under R4 and carries at least one legal swap.
 */
export function startRound(state: FacetState): FacetState {
  return {
    ...state,
    screen: "playing",
    menuIndex: 0,
    board: dealOpeningBoard(),
    score: 0,
    level: 1,
    levelScore: 0,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    refusalTimer: 0,
    armedTarget: null,
  };
}

/**
 * `CONTINUE` from the level-clear menu: the next level opened. `level` rises,
 * the three figures the level was measured by return to `0`, and a fresh
 * opening board is dealt. `score` carries across, because it is the round's
 * rather than the level's.
 */
export function continueLevel(state: FacetState): FacetState {
  return {
    ...state,
    screen: "playing",
    menuIndex: 0,
    board: dealOpeningBoard(),
    level: state.level + 1,
    levelScore: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    selection: null,
    offer: null,
    refusal: null,
    refusalTimer: 0,
    armedTarget: null,
  };
}

/** `HOW TO PLAY` from the title menu. */
export function openHowTo(state: FacetState): FacetState {
  return { ...state, screen: "howto", menuIndex: 0, armedTarget: null };
}

/** The `pause` action from `playing`. Every timer holds where it stands. */
export function pauseGame(state: FacetState): FacetState {
  if (state.screen !== "playing") return state;
  return { ...state, screen: "paused", menuIndex: 0, armedTarget: null };
}

/** `RESUME`, and the `pause` action from `paused`. */
export function resumeGame(state: FacetState): FacetState {
  if (state.screen !== "paused") return state;
  return { ...state, screen: "playing", menuIndex: 0, armedTarget: null };
}

/** The `pause` action, which enters and leaves `paused` from `playing`. */
export function togglePause(state: FacetState): FacetState {
  if (state.screen === "playing") return pauseGame(state);
  if (state.screen === "paused") return resumeGame(state);
  return state;
}

/**
 * `QUIT`, which the pause menu, the level-clear menu, and the game-over menu
 * all offer: the round is abandoned and no board is in play. `score`, `level`,
 * and `levelScore` hold what the round left them at, and the next `start`
 * begins a fresh round.
 */
export function quitToTitle(state: FacetState): FacetState {
  return {
    ...state,
    screen: "title",
    menuIndex: 0,
    board: EMPTY_BOARD,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    selection: null,
    offer: null,
    refusal: null,
    refusalTimer: 0,
    armedTarget: null,
  };
}

/**
 * `back`, which leaves `howto` and `gameover` and nothing else.
 *
 * It puts a player who came in to read the rules back on the item they came in
 * through rather than at the top of the menu. `paused` and `levelclear` are
 * left by taking one of their items, not by backing out of them, so `back` does
 * nothing on either — which is what leaves `Escape` free to mean `pause` on the
 * one and nothing at all on the other.
 */
export function goBack(state: FacetState): FacetState {
  switch (state.screen) {
    case "howto":
      return {
        ...state,
        screen: "title",
        menuIndex: TITLE_ITEMS.indexOf("HOW TO PLAY"),
        armedTarget: null,
      };
    case "gameover":
      return { ...state, screen: "title", menuIndex: 0, armedTarget: null };
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
    case "CONTINUE":
      return continueLevel(state);
    case "QUIT":
      return quitToTitle(state);
    default:
      return state;
  }
}

/**
 * The `confirm` action, wherever it is pressed. Only a menu screen has anything
 * for it to take: the board is played with the pointer alone, so `confirm` on
 * `playing` does nothing at all.
 */
export function confirm(state: FacetState): FacetState {
  return confirmMenu(state);
}
