// levels/levelclear-quit-to-title — QUIT abandons a cleared level and returns to
// the title.
//
// specs/ui.md gives `levelclear` two items and this is the second: "`QUIT` — Sets
// `screen = title` and `menuIndex = 0`, abandoning the round."
// specs/instrumentation.md poses that choice as `quit()`, "the choice of `QUIT`,
// which the pause menu and the game-over menu both offer", and says what it
// leaves: "the screen becomes `title` with its first menu item highlighted, no
// board is in play".
//
// WHY IT IS ITS OWN POINT. It is the same choice `screens/quit-to-title` reads
// from the pause and game-over menus, offered from a THIRD screen. A build wires
// a menu screen at a time, so one that answered QUIT on the two menus a player
// meets more often can still strand a player on a cleared level, and nothing else
// in this checklist would see it. specs/ui.md also says `back` does nothing on
// `levelclear`, so the two items are the whole of the way off that screen and
// this is one of them.
//
// NO BOARD IN PLAY IS PART OF THE READING. specs/instrumentation.md's snapshot
// shape says `board` "is `{ cols: 0, rows: 0, cells: [] }` while no board is in
// play", so a build that returned to the title with the finished board still
// standing behind it is caught here rather than at the screen alone.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`:
// what that figure ought to be is `levels/level-target-derived`'s point, and this
// one only needs a level that finishes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { LEVELCLEAR_ITEMS } from "../constants";
import {
  hasAnyRun,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  takeMenuItem,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The exchange that drops the third ruby into row 4 and makes the run. */
const RUN_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

/** Where `QUIT` sits on the level-clear menu, from specs/ui.md's `LEVELCLEAR_ITEMS`. */
const LEVELCLEAR_QUIT_INDEX = LEVELCLEAR_ITEMS.indexOf("QUIT");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with no board in play", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  await loadBoard(h, posed);
  await h.debug.setLevel(1);

  const opened = await h.snapshot();
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(opened.levelTarget);

  await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
  const settled = await resolveChain(h);
  assertTrue(settled.settled, "the chain returned to idle within the cap");
  assertEqual(
    settled.snapshot.screen,
    "levelclear",
    "the screen QUIT is offered from",
  );

  // QUIT is really CHOSEN, which is what the item says: the highlight is
  // posed onto it — `setMenuIndex` takes no item — and `confirm` is what takes
  // it, through the key specs/controls.md binds and the build's own input path.
  await takeMenuItem(h, LEVELCLEAR_QUIT_INDEX);

  // The frame the title is drawn on, and the picture of it.
  await h.advance(1);
  await captureStill(h, "title");

  const left = await h.snapshot();
  assertEqual(left.screen, "title", "the screen QUIT returns to");
  assertEqual(left.menuIndex, 0, "the highlighted item on the title menu");
  assertEqual(left.board.cols, 0, "the columns of the board left in play");
  assertEqual(left.board.rows, 0, "the rows of the board left in play");
  assertLength(left.board.cells, 0, "the cells of the board left in play");
});
