// Cascade — the transitions between screens, and the two whole-game resets.
//
// Every transition is written onto the live state, so the menus, the HUD, the
// won screen's press and the debug surface all reach the same code
// (specs/screens.md, specs/victory.md).

import type { FrameCues } from "./audio";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "./constants";
import { dealGame } from "./deal";
import type { CardState, CascadeState } from "./game";
import { wrapMenuIndex } from "./menus";

/** An empty pile per slot, freshly built so nothing is shared between them. */
function emptyPiles(count: number): CardState[][] {
  return Array.from({ length: count }, () => []);
}

/**
 * Restore every declared field to its title-screen value, and clear the painted
 * layer with them. `muted` is left exactly as it stands, because muting is a
 * player preference the runtime owns (specs/instrumentation.md).
 */
export function resetState(state: CascadeState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.titleIndex = 0;

  state.stock = [];
  state.waste = [];
  state.wasteSets = [];
  state.foundations = emptyPiles(FOUNDATION_COUNT);
  state.tableau = emptyPiles(TABLEAU_COLUMNS);

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
  state.trail.clear();
  state.trailStamps = 0;

  state.nextId = 1;
  state.simTime = 0;
}

/**
 * Deal a fresh game and put it in play: what the title's `NEW GAME`, the HUD's
 * `NEW GAME` and a press on the won screen all do. The cascade left over from a
 * finished game ends here, and the deal clears the table it painted.
 */
export function newGame(state: CascadeState, cues: FrameCues): void {
  state.drag = null;
  state.dropTarget = null;
  state.flyers = [];
  state.launchClock = 0;
  state.cascadeDone = false;
  dealGame(state, cues);
  state.screen = "playing";
  // "Every deal that begins play selects the first of them, so `menuIndex` is
  // `0` when a fresh game starts" (specs/screens.md).
  state.menuIndex = 0;
}

/** Leave the table for the title screen, which the HUD's `MENU` control does. */
export function toTitle(state: CascadeState): void {
  state.drag = null;
  state.dropTarget = null;
  state.screen = "title";
  // "Both return to `title` with `menuIndex` set to `titleIndex`, the title
  // entry last activated" (specs/screens.md).
  state.menuIndex = wrapMenuIndex("title", state.titleIndex);
}
