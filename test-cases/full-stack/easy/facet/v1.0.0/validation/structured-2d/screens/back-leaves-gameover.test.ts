// Facet — screens/back-leaves-gameover: Escape leaves the end of a round.
//
// specs/ui.md gives `gameover` one line about the action: "`back` sets
// `screen = title` and `menuIndex = 0`." So the key that leaves `howto` leaves
// this screen as well, and a player who never touches the menu is still returned
// to the title with its first item under the highlight — which is the state
// `PLAY` is chosen from.
//
// THE KEY IS REAL. specs/controls.md binds `back` to `Escape` and fixes that
// table for a build of every engine, so `tapAction` delivers it as one press a
// frame reads as an edge. `Escape` fires `pause` as well, and specs/controls.md
// keeps the two apart by screen — `pause` acts on `playing` and `paused` and
// nowhere else — so on `gameover` the press is unambiguous. specs/ui.md has
// input read on every screen, so the press does not need the round to be
// running.
//
// `menuIndex` IS MADE MEANINGFUL FIRST. It is `0` on arriving at `gameover`
// already, so a title reading `0` afterwards would say nothing on its own. The
// highlight is therefore moved with the `down` action before the press, and
// nothing is asserted of that move: which item the highlight lands on is the
// menus' own point, so a build whose menu does not answer is asked this question
// unchanged rather than failed for it here.
//
// HOW THE ROUND IS ENDED. specs/rules.md ends it "when `phase` returns to `idle`
// and no legal swap exists on the board", so a swap is accepted, carried through
// the swap animation into step 1, and the board that step will next be read
// against is written under it with `setGem`, which specs/instrumentation.md says
// leaves the screen, the phase and the selection where they were. `deadBoard()`
// carries no run under R4 and no adjacent exchange R1 and R3 both accept — both
// asserted here rather than assumed — so the settling step seeds nothing and the
// round ends.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  assertBoardEquals,
  deadBoard,
  legalSwaps,
  maximalRuns,
  parseRows,
  quietRowsWith,
  swapIsLegal,
  tokenAt,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
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

/** Write a whole board onto the live one, `setGem` by `setGem`. */
function writeBoard(rows: BoardRows): void {
  // Parsed on this side first, so a typo in the fixture fails here rather than
  // crossing into the build one cell at a time.
  parseRows(rows);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      h.debug.setGem(col, row, tokenAt(rows, col, row));
    }
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with the first item highlighted when back is pressed on game over", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  loadBoard(h, posed);

  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");

  const dead = deadBoard();
  assertLength(maximalRuns(dead), 0, "maximal runs on the dead board");
  assertLength(legalSwaps(dead), 0, "legal swaps on the dead board");
  writeBoard(dead);
  assertBoardEquals(h.board(), dead, "the board the step is read against");

  await advanceStep(h);
  assertEqual(h.snapshot().screen, "gameover", "the screen back is pressed on");

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
