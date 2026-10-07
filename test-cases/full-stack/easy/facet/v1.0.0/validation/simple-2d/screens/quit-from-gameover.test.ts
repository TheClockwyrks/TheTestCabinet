// Facet — screens/quit-from-gameover: QUIT on the game-over menu leaves the
// round behind.
//
// specs/ui.md gives the game-over menu's `QUIT` its effect: "Sets `screen =
// title` and `menuIndex = 0`, putting the finished round down: the board goes
// with it and nothing of it is left in play." specs/ui.md's title section says
// what putting it down is, once, for all three menus that offer `QUIT`:
// "wherever it is taken from, `QUIT` returns `board` to `{ cols: 0, rows: 0,
// cells: [] }`, returns `phase` to `idle` with `chainStep`, `swapTimer` and
// `stepTimer` at `0`, and clears the selection, the offer, the refusal and the
// armed target".
// specs/instrumentation.md fixes the resting values a snapshot reports for
// those — `board` is `{ cols: 0, rows: 0, cells: [] }` while no board is in
// play, and `selection`, `offer` and `refusal` are `null` while none stands.
//
// IT IS `QUIT` THAT PUTS THE ROUND DOWN, not the title screen that forbids a
// board behind it: `back` off THIS screen also sets `screen = title` and
// `menuIndex = 0`, and specs/ui.md asks nothing of the board there — which is
// `screens/back-leaves-gameover`'s point, and why this one reads the item.
//
// THAT LAST HALF IS THE POINT. Reaching the title is easy; putting the finished
// board down is the part a build gets wrong, because the title screen draws none
// of it, and specs/ui.md has the final board showing behind THIS menu, so there
// is a live board here for a build to walk away from.
//
// THE OTHER TWO MENUS THAT OFFER QUIT ARE THEIR OWN POINTS.
// `screens/quit-from-paused` decides the pause entry and
// `levels/levelclear-quit-to-title` the level-clear one: a build can wire one of
// the three and not the others, and each is reached by a route the others do not
// share.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. Reaching `gameover` from a settled board
// is `levels/gameover-no-legal-swap`'s point, and driving a round to its end on
// the way here would only add that point's failure modes to this one.
// specs/instrumentation.md's `setScreen` shows the screen and changes nothing
// else, and "the screen behaves from there exactly as it does when a player
// reaches it". The board the round finished on is posed under it, with a gem
// held and a neighbor offered, so the resting values afterwards are known to be
// the quit clearing them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { GAMEOVER_ITEMS, GRID_COLS, GRID_ROWS } from "../constants";
import { deadBoard, type CellRef } from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  takeMenuItem,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The gem held and the neighbor offered when the round is left. */
const SELECTED: CellRef = { col: 2, row: 3 };
const OFFERED: CellRef = { col: 2, row: 2 };

/** Where `QUIT` sits on the game-over menu, from specs/ui.md's `GAMEOVER_ITEMS`. */
const GAMEOVER_QUIT_INDEX = GAMEOVER_ITEMS.indexOf("QUIT");

let h: Harness;

/** Every resting value putting the round down leaves behind. */
function assertRestingTitle(state: FacetSnapshot): void {
  assertEqual(state.screen, "title", "the screen QUIT leaves");
  assertEqual(state.menuIndex, 0, "the highlighted title item");
  // The board QUIT puts down — the resting board a snapshot reports for none.
  assertEqual(state.board.cols, 0, "columns of the board in play");
  assertEqual(state.board.rows, 0, "rows of the board in play");
  assertLength(state.board.cells, 0, "cells of the board in play");
  assertEqual(state.phase, "idle", "phase");
  assertEqual(state.chainStep, 0, "chainStep");
  assertEqual(state.stepTimer, 0, "stepTimer");
  assertEqual(state.selection, null, "selection");
  assertEqual(state.offer, null, "offer");
  assertEqual(state.refusal, null, "refusal");
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with the finished round put down", async () => {
  h.debug.reset();

  // The board a finished round left, with a gem held and a neighbor offered on
  // it, under the game-over menu.
  loadBoard(h, deadBoard());
  h.debug.setSelection(SELECTED.col, SELECTED.row);
  h.debug.setOffer(OFFERED.col, OFFERED.row);
  h.debug.setScreen("gameover");

  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen QUIT is taken from");
  assertNotNull(over.selection, "the selection the round is left holding");
  assertNotNull(over.offer, "the offer the round is left standing");
  assertLength(
    over.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the board in play",
  );

  // QUIT is really CHOSEN: the highlight is posed onto it — `setMenuIndex` takes
  // no item — and `confirm` is what takes it, through the key specs/controls.md
  // binds and the build's own input path. It is posed onto the SECOND item, so
  // `menuIndex` reading 0 on the title below is the quit setting it rather than
  // it never having moved.
  await takeMenuItem(h, GAMEOVER_QUIT_INDEX);
  await h.advance(1);
  captureStill(h, "title");
  assertRestingTitle(h.snapshot());
});
