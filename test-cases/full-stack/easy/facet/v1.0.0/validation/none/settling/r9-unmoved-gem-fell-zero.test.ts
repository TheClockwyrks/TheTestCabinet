// settling/r9-unmoved-gem-fell-zero — a gem the fall left standing says it
// traveled nothing.
//
// WHAT THE RULE IS. specs/rules.md gives R9 a table with four rows, and this
// point owns the first: "One R9 did not move — `0`". It is the row that fixes
// what `fell` MEASURES. The figure is the distance a gem traveled in the step
// that has just resolved, not the distance from wherever it came into the game,
// so a gem nothing moved reports nothing however far it once fell.
//
// TWO KINDS OF STANDING GEM, AND BOTH ARE READ. R9 leaves a gem where it stands
// for two different reasons, and a build can get one right and the other wrong:
//
//   - a gem in a column the clear never touched, which has no empty cell in its
//     column at all;
//   - a gem BELOW the clear in a column that was emptied, which has empty cells
//     in its column but none beneath it.
//
// The second is the discriminating one. A build that reports a gem's distance to
// the TOP of the board, or that shifts a whole column rather than the survivors
// above the gap, gives the cells under the clear a figure — and only this
// arrangement catches it, because a clear at the foot of a column leaves nothing
// below it to read.
//
// THE SCENARIO, THEREFORE, PUTS THE CLEAR IN THE MIDDLE. A vertical run of three
// rubies down column 4 at rows 3, 4 and 5, completed by trading the parked ruby
// at (5,4) into (4,4). Rows 6 and 7 of that column survive with no empty cell
// beneath them, and every other column loses nothing at all — so the whole board
// but for column 4's rows 0 to 5 is gems R9 left exactly where they stood. Every
// one of them owes `0`.
//
// WHAT IS NOT READ. Column 4's rows 3 to 5, which hold the three survivors the
// fall carried down and whose figure is
// `settling/r9-fell-reports-the-drop`'s; and its rows 0 to 2, which the refill
// dealt and whose figure R9 fixes only as a floor, decided by
// `settling/r9-refill-falls-from-above`. `board.ts`'s `settle` is the oracle for
// which cells are which, so the split is the rules' rather than the fixture's,
// and every cell this check reads carries an `exactly` of `0`.
//
// WHEN THE READING IS TAKEN. An accepted swap exchanges the two cells at once and
// then holds them in motion: specs/rules.md sets `phase` to `swapping` with
// `chainStep` at 0, and step 1 resolves once `SWAP_SECONDS` (0.18) of game time
// has passed. `swapAndStep` carries the board through exactly that and hands back
// the reading step 1 left behind, R9 included — and it has already drawn frames,
// so the still is the board the assertions are about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  assertFell,
  clearSetFromRuns,
  fellAt,
  maximalRuns,
  quietRowsWith,
  settle,
  showFell,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** The one column the clear empties, and it empties it in the middle. */
const COL = 4;

/**
 * Three rubies that make a vertical run down the middle of column 4 once the
 * parked one trades in from next door.
 *
 * The filler holds an amber at (4,2) and a citrine at (4,6), so the run is
 * bounded above and below and is maximal at exactly three — which is what leaves
 * rows 6 and 7 of the column standing with no empty cell beneath them.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: COL, row: 3, token: "R0" },
  { col: COL, row: 5, token: "R0" },
  { col: COL + 1, row: 4, token: "R0" },
];

/** The swap that completes the run: the parked ruby trades into `(4,4)`. */
const A: CellRef = { col: COL, row: 4 };
const B: CellRef = { col: COL + 1, row: 4 };

/** The three cells the swap's run seeds, top to bottom. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 3 },
  { col: COL, row: 4 },
  { col: COL, row: 5 },
];

/** The cells of `COL` that stand below the clear, which R9 cannot move. */
const BELOW_THE_CLEAR: readonly CellRef[] = [
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

/** The one cell a snapshot reports at `(col, row)`. */
function cellAt(
  snapshot: FacetSnapshot,
  col: number,
  row: number,
): CellSnapshot {
  const found = snapshot.board.cells.filter(
    (cell) => cell.col === col && cell.row === row,
  );
  assertLength(found, 1, `cells reported at (${col},${row})`);
  return found[0];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports 0 for every gem the fall left where it stood", async () => {
  const posed = quietRowsWith(SCENARIO);
  const resolved = swapped(posed, A, B);
  // The arrangement is proved rather than assumed: the posed board carries no
  // run of its own, and the swap's run seeds exactly the three cells in the
  // MIDDLE of column 4 — which is what leaves cells of that column below the
  // clear for the discriminating half of this reading.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(resolved),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  // R9 as `board.ts` restates it, over the board the swap produced and the cells
  // the removal emptied. Every cell it fixes at exactly 0 is a cell the fall left
  // standing, and those are the cells this point reads.
  const settlement = settle(resolved, CLEAR_SET);
  const standing = settlement.cells.filter(
    (cell) => showFell(cell.fell) === "0",
  );

  // The two kinds of standing gem the header names are both in that set, and
  // there are enough of them for the reading to be about the board rather than
  // about a cell or two: seven whole columns the clear never reached, and the two
  // cells of column 4 that stand beneath it.
  for (const cell of BELOW_THE_CLEAR) {
    assertEqual(
      showFell(fellAt(settlement, cell.col, cell.row)),
      "0",
      `the drop R9 fixes for (${cell.col},${cell.row}), below the clear`,
    );
  }
  assertGreaterThanOrEqual(
    standing.length,
    (GRID_COLS - 1) * GRID_ROWS + BELOW_THE_CLEAR.length,
    "cells R9 leaves standing, across the columns it never emptied and the " +
      "cells of column 4 beneath the clear",
  );

  await loadBoard(h, posed);
  const settled = await swapAndStep(h, A, B);
  await captureStill(h, "fell");
  assertEqual(settled.chainStep, 1, "the chain step the swap opened");

  for (const cell of standing) {
    const where =
      cell.col === COL ? "below the clear" : "in an untouched column";
    assertFell(
      cellAt(settled, cell.col, cell.row).fell,
      cell.fell,
      `the rows the gem at (${cell.col},${cell.row}) traveled, ${where}`,
    );
  }
});
