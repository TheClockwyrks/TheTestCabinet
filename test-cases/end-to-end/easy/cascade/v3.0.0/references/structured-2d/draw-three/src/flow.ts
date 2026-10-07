// Cascade — the transitions the screens run on.
//
// Every one of them is written straight onto the live state, and each is shared
// by the control that a player presses and by the debug surface, so a game
// started from a menu and one started from code leave the state in the same
// place.

import type { FrameEvents } from "./audio";
import { TABLEAU_COLUMNS } from "./constants";
import { clearTrail, dealGame } from "./deal";
import type { CascadeState } from "./game";
import { wrapMenuIndex } from "./menus";

/**
 * Restore every declared field to its title-screen value (`reset`,
 * `specs/instrumentation.md`). `muted` is left exactly as it stands, because
 * muting is a player preference the runtime owns.
 */
export function resetState(state: CascadeState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.titleIndex = 0;

  state.stock = [];
  state.waste = [];
  state.wasteSets = [];
  state.foundations = [[], [], [], []];
  state.tableau = Array.from({ length: TABLEAU_COLUMNS }, () => []);

  state.drag = null;
  state.dropTarget = null;
  state.pointer = { x: 0, y: 0, down: false };
  state.lastPress = null;

  state.autoFlip = true;
  state.winDetect = true;
  state.launching = true;
  state.trailPainting = true;

  state.launchClock = 0;
  state.launched = 0;
  state.flyers = [];
  state.cascadeDone = false;
  clearTrail(state);

  state.nextId = 1;
  state.simTime = 0;
}

/** Put the cascade away: nothing in flight, nothing accumulated, nothing finished. */
export function clearCascade(state: CascadeState): void {
  state.flyers = [];
  state.launchClock = 0;
  state.cascadeDone = false;
}

/**
 * A fresh game on the table: the deal `specs/deal.md` states, with the cascade
 * put away and the game on the `playing` screen. This is what both `NEW GAME`
 * controls do and what a press on the `won` screen does.
 */
export function newGame(state: CascadeState, events: FrameEvents): void {
  state.drag = null;
  state.dropTarget = null;
  clearCascade(state);
  dealGame(state, events);
  state.screen = "playing";
  // "Every deal that begins play selects the first of them, so `menuIndex` is
  // `0` when a fresh game starts" (specs/screens.md).
  state.menuIndex = 0;
}

/** Back to the title screen, leaving the table exactly as it stands. */
export function toTitle(state: CascadeState): void {
  state.screen = "title";
  // "Both return to `title` with `menuIndex` set to `titleIndex`, the title
  // entry last activated" (specs/screens.md).
  state.menuIndex = wrapMenuIndex("title", state.titleIndex);
}
