// Facet — screens/quit-from-paused: QUIT on the pause menu abandons the round.
//
// specs/ui.md gives the pause menu's `QUIT` its effect: "Sets `screen = title`
// and `menuIndex = 0`, abandoning the round: the board is put down and nothing
// of the round is left in play." specs/ui.md's title section says what putting
// it down is, once, for all three menus that offer `QUIT`: "wherever it is
// taken from, `QUIT` returns `board` to `{ cols: 0, rows: 0, cells: [] }`,
// returns `phase` to `idle` with `chainStep`, `swapTimer` and `stepTimer` at
// `0`, and clears the selection, the offer, the refusal and the armed target".
// specs/instrumentation.md fixes the resting values a snapshot reports for
// those — `board` is `{ cols: 0, rows: 0, cells: [] }` while no board is in
// play, and `selection`, `offer` and `refusal` are `null` while none stands.
//
// IT IS `QUIT` THAT PUTS THE ROUND DOWN, not the title screen that forbids a
// board behind it: `back` off `gameover` reaches the same screen and leaves the
// finished board standing. So this is read as the item's effect, and nothing
// here is asked of any other route to the title.
//
// THAT LAST HALF IS THE POINT. Reaching the title is easy; leaving nothing of
// the round behind is the part a build gets wrong, because the title screen
// draws none of it, so a build that walked away from a live board without
// putting it down reports it here.
//
// THE OTHER TWO MENUS THAT OFFER QUIT ARE THEIR OWN POINTS.
// `screens/quit-from-gameover` decides the game-over entry and
// `levels/levelclear-quit-to-title` the level-clear one: a build can wire one of
// the three and not the others, and each is reached by a route the others do not
// share.
//
// THE ROUND IS DIRTIED FIRST. A quit from a round that had nothing running would
// pass on a build that clears nothing, so the round is quit mid-chain with a
// step timer part way through a step, a gem held and a neighbor offered, and
// each of those is read back before the quit so the resting values afterwards
// are known to be the quit clearing them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS, PAUSED_ITEMS } from "../constants";
import {
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pauseGame,
  swapAndStep,
  takeMenuItem,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The run a swap makes, so a chain is running when the round is left. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** The gem held and the neighbor offered when the round is left. */
const SELECTED: CellRef = { col: 2, row: 3 };
const OFFERED: CellRef = { col: 2, row: 2 };

/** Where `QUIT` sits on the pause menu, from specs/ui.md's `PAUSED_ITEMS`. */
const PAUSED_QUIT_INDEX = PAUSED_ITEMS.indexOf("QUIT");

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

it("returns to the title with nothing of the round left", async () => {
  // A round with something running in it: a chain part way through a step, a
  // gem held, and a neighbor offered.
  const posed = quietRowsWithEscape(TRIGGER);
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  loadBoard(h, posed);
  await swapAndStep(h, SWAP_A, SWAP_B);
  h.debug.setSelection(SELECTED.col, SELECTED.row);
  h.debug.setOffer(OFFERED.col, OFFERED.row);

  const running = h.snapshot();
  assertEqual(running.chainStep, 1, "the chain step the round is left during");
  assertGreaterThan(
    running.stepTimer,
    0,
    "the step timer the round is left at",
  );
  assertNotNull(running.selection, "the selection the round is left holding");
  assertNotNull(running.offer, "the offer the round is left standing");
  assertLength(
    running.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the board in play",
  );

  pauseGame(h);
  assertEqual(h.snapshot().screen, "paused", "the screen QUIT is taken from");

  // QUIT is really CHOSEN: the highlight is posed onto it — `setMenuIndex` takes
  // no item — and `confirm` is what takes it, through the key specs/controls.md
  // binds and the build's own input path. It is posed onto the SECOND item, so
  // `menuIndex` reading 0 on the title below is the quit setting it rather than
  // it never having moved.
  await takeMenuItem(h, PAUSED_QUIT_INDEX);
  await h.advance(1);
  captureStill(h, "title");
  assertRestingTitle(h.snapshot());
});
