// Facet — screens/back-leaves-gameover: Escape leaves the end of a round.
//
// specs/ui.md gives `gameover` one line about the action: "`back` sets
// `screen = title` and `menuIndex = 0`." So the key that leaves `howto` and
// `paused` leaves this screen as well, and a player who never touches the menu
// is still returned to the title with its first item under the highlight —
// which is the state `PLAY` is chosen from.
//
// THE KEY IS REAL. specs/controls.md binds `back` to `Escape` and fixes that
// table for a build of every engine, so `tapAction` delivers it as one press a
// frame reads as an edge. specs/ui.md has input read on every screen, so the
// press does not need the round to be running.
//
// `menuIndex` IS MADE MEANINGFUL FIRST. It is `0` on arriving at `gameover`
// already, so a title reading `0` afterwards would say nothing on its own. The
// highlight is therefore moved with the `down` action before the press, and
// nothing is asserted of that move: which item the highlight lands on is the
// menus' own point, so a build whose menu does not answer is asked this question
// unchanged rather than failed for it here.
//
// HOW THE ROUND IS ENDED. specs/rules.md ends it "when `phase` returns to `idle`
// and no legal swap exists on the board", so a chain is opened with a swap and
// the board that chain will next be read against is written under it with
// `setGem`, which specs/instrumentation.md says leaves the screen, the phase,
// the cursor and the selection where they were. `deadBoard()` carries no run
// under R4 and no adjacent exchange R1 and R3 both accept — both asserted here
// rather than assumed — so the settling step seeds nothing and the round ends.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { GRID_COLS, GRID_ROWS, STEP_DRIVE_FRAMES } from "../constants";
import {
  assertBoardEquals,
  deadBoard,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** The run a swap makes, so a chain is running when the dead board is written. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with the first item highlighted when back is pressed on game over", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  loadBoard(h, posed);
  assertEqual(swap(h, SWAP_A, SWAP_B).phase, "resolving", "the phase");

  const dead = deadBoard();
  assertLength(maximalRuns(dead), 0, "maximal runs on the dead board");
  assertLength(legalSwaps(dead), 0, "legal swaps on the dead board");
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      h.debug.setGem(col, row, tokenAt(dead, col, row));
    }
  }
  assertBoardEquals(h.board(), dead, "the board the step is read against");

  await h.advance(STEP_DRIVE_FRAMES);
  assertEqual(
    h.snapshot().screen,
    "gameover",
    "the screen back is pressed on",
  );

  // The highlight off the first item, where the build's menu answers to it, so
  // the reading below is the press setting `menuIndex` rather than it never
  // having moved.
  await h.tapAction("down");

  await h.tapAction("back");
  await h.advance(1);

  const title = h.snapshot();
  captureStill(h, "title");
  assertEqual(title.screen, "title", "the screen back leaves game over for");
  assertEqual(title.menuIndex, 0, "the highlighted item back leaves");
});
