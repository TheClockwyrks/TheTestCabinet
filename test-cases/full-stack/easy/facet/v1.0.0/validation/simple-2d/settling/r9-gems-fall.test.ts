// settling/r9-gems-fall — R9 drops a column's survivors onto the foot of that
// column, in the order the column held them.
//
// WHAT THE RULE IS. specs/rules.md R9: "Within each column, every surviving gem
// falls to the lowest empty cell below it, keeping the order its column held it
// in". specs/board.md fixes which way is down — "Gravity pulls toward increasing
// row" — so a column whose foot loses three cells hands every gem above the gap a
// home exactly three rows further down, and they arrive in the order they left.
//
// HOW THE SCENARIO ISOLATES THAT. A vertical run of three at the FOOT of column
// 4, rows 5 to 7, posed on the run-free filler. The whole gap is therefore below
// every survivor, so one distance answers for all of them, and the filler makes
// the swap's own run the only run on the board — the clear set is those three
// cells and nothing else moves. The five survivors carry five DIFFERENT kinds,
// which is what makes the reading discriminating: a build that shifted by the
// wrong distance, reversed the column, or refilled the gap from the foot instead
// of the top puts a different kind at every asserted cell rather than an
// indistinguishable one.
//
// WHEN THE READING IS TAKEN. specs/rules.md has an accepted swap "resolve step 1
// immediately", and R9 is the last thing that step does, so the board the swap
// leaves behind is the settled board of step 1 — read before any later step and
// before R9's refill can seed one.
//
// WHAT IS DELIBERATELY LEFT UNASSERTED. The survivor that stood immediately above
// the gap is orthogonally adjacent to the clear set, so R7 raises its strain as
// the step resolves; that strain is R7's point and not this one, and only its
// KIND and the cell it landed in are read. Column 6 is read whole and unchanged:
// it lost no cell, and gravity acting within each column has to leave it exactly
// as posed, which is the other half of the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { GRID_ROWS } from "../constants";
import {
  assertBoardEquals,
  clearSetFromRuns,
  maskBoard,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderBoard,
  renderCell,
  swapped,
  tokenAt,
  withCells,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** The column whose foot the step clears, and whose survivors are then read. */
const COL = 4;

/** A column the clear never reaches: per-column gravity must leave it alone. */
const UNTOUCHED_COL = 6;

/** How many cells the step empties out of `COL`, and so how far its gems fall. */
const CLEARED = 3;

/**
 * Three rubies that make a vertical run at the foot of column 4 once the middle
 * one trades in from next door.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: COL, row: 5, token: "R0" },
  { col: COL, row: 7, token: "R0" },
  { col: COL + 1, row: 6, token: "R0" },
];

/** The swap that completes the run: the parked ruby trades into `(4,6)`. */
const A: CellRef = { col: COL, row: 6 };
const B: CellRef = { col: COL + 1, row: 6 };

/** The three cells the swap's run seeds, top to bottom. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 5 },
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

/**
 * Frames driven after the swap purely so the replay has the fall in it.
 *
 * Short of `STEP_SECONDS` (0.25 s, 16 frames of this clock), so the board is
 * never read a second time and every assertion below still describes step 1.
 */
const REPLAY_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("drops each column's survivors onto its foot in the order they stood in", async () => {
  const posed = quietRowsWith(SCENARIO);
  // The arrangement is the check's argument, so it is proved rather than
  // asserted: the posed board carries no run of its own, and the swap's run
  // seeds exactly the three cells at the foot of column 4.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(swapped(posed, A, B)),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  loadBoard(h, posed);
  const settled = await captureReplay(h, "fall", async () => {
    const first = swap(h, A, B);
    await h.advance(REPLAY_FRAMES);
    return first;
  });
  assertEqual(settled.chainStep, 1, "the chain step the swap opened");

  // The column's gems from the top down to the last one the gap left standing.
  const survivors = Array.from({ length: GRID_ROWS - CLEARED }, (_, row) =>
    tokenAt(posed, COL, row),
  );

  // Each survivor but the last, at the cell three rows below the one it stood
  // in — the lowest empty cell below it once the ones under it have fallen —
  // beside a whole column that lost nothing and so may not have moved at all.
  const expected = withCells(maskBoard(posed, []), [
    ...survivors.slice(0, -1).map((token, index) => ({
      col: COL,
      row: CLEARED + index,
      token,
    })),
    ...Array.from({ length: GRID_ROWS }, (_, row) => ({
      col: UNTOUCHED_COL,
      row,
      token: tokenAt(posed, UNTOUCHED_COL, row),
    })),
  ]);
  assertBoardEquals(
    renderBoard(settled),
    expected,
    "the board step 1 settled into",
  );

  // The last survivor lands at the very foot. Its strain is R7's business — it
  // sat against the clear set — so only the kind that arrived is read.
  assertEqual(
    parseToken(renderCell(settled, COL, GRID_ROWS - 1)).kind,
    parseToken(survivors[survivors.length - 1]).kind,
    `the kind that arrived at (${COL},${GRID_ROWS - 1})`,
  );
});
