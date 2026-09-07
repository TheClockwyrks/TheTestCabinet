// runs/r4-vertical-run — a swap that puts MATCH_MIN gems of one kind on
// consecutive cells of a single COLUMN clears exactly those three cells.
//
// R4 of specs/rules.md names a row and a column in one breath: a run is
// `MATCH_MIN` (3) or more gems of one kind on consecutive cells of "a single row
// or a single column". The two are separate points because they are separately
// gettable wrong — a build that walks only its rows, or that reads its grid
// with `col` and `row` transposed, matches one axis and misses the other — and
// this is the column half.
//
// THE EVIDENCE IS A FALL OF THREE. A horizontal three takes one cell out of each
// of three columns, so each of them settles by one row. A vertical three takes
// three cells out of ONE column, so everything above the run in that column
// drops by three at once. That is the reading this point turns on: it is the
// shape a column clear leaves and no other clear leaves it.
//
// WHAT THIS POINT READS. The run's own column, and nothing else on the board:
// the three cells the item claims stand in that column, and the shape the column
// settles into is what says the step took them. Every other column is left
// unread, because nothing the item claims is written there.
//
// AND R7 IS KEPT OUT OF THE READING ENTIRELY. R7 raises the strain of the gems
// the clear set stands beside, and which gems those are is `strain/*`'s point
// rather than this one. R7 alters strain and alters neither kind nor cut, so a
// gem that stood anywhere in the clear set's eight-cell ring is read by its KIND
// alone here, and only a gem the clear set stood nowhere near is read as a whole
// token. A build's reading of R7 therefore cannot decide this point.
//
// The run is exactly three, which R8's table creates nothing from, so no created
// gem is in play either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { GRID_ROWS, MATCH_MIN } from "../constants";
import {
  assertBoardEquals,
  maskBoard,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderBoard,
  ring,
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
  swapAndStep,
  type Harness,
} from "../harness";

/** The column the run lands in, and the three rows it spans. */
const RUN_COL = 5;
const RUN_ROWS = [2, 3, 4];
const RUN_CELLS: CellRef[] = RUN_ROWS.map((row) => ({ col: RUN_COL, row }));

/** The swap: the amethyst one column over slides into the gap in the column. */
const FROM: CellRef = { col: RUN_COL - 1, row: 3 };
const TO: CellRef = { col: RUN_COL, row: 3 };

/**
 * Two amethysts over the quiet filler, and a third parked beside the gap.
 *
 * The filler already holds an amethyst at `(5,4)`, so the column needs only the
 * one at `(5,2)` written over it and the one at `(4,3)` waiting to slide in. The
 * cells immediately beyond the run's ends — `(5,1)` and `(5,5)` — hold a ruby
 * and an amber, so the run is maximal at three.
 */
const POSED = quietRowsWith([
  { col: RUN_COL, row: RUN_ROWS[0], token: "M0" },
  { col: FROM.col, row: FROM.row, token: "M0" },
]);

/** The board the exchange produces, which is what R4 and R5 are read over. */
const AFTER = swapped(POSED, FROM, TO);

/**
 * Whether the clear set stands beside a cell, at an edge or at a corner.
 *
 * The gems R7 can reach are among these, whatever adjacency a build reads the
 * rule with, so a gem that stood here crosses the step with a strain this point
 * does not read.
 */
function besideRun(cell: CellRef): boolean {
  return ring(cell.col, cell.row).some((around) =>
    RUN_CELLS.some((run) => run.col === around.col && run.row === around.row),
  );
}

/**
 * Every survivor of the run's own column, paired with the cell R9 left it
 * standing in.
 *
 * `MATCH_MIN` consecutive cells of this one column are emptied and every
 * survivor falls to the lowest empty cell below it, keeping the column's order:
 * the gems above the run stand `MATCH_MIN` rows lower afterward, and the gems
 * below it stand where they stood. The cells holding no survivor afterward are
 * the top `MATCH_MIN` rows, which R9 refilled by its draw, and
 * no check may assert what landed there.
 */
const SETTLED: { from: CellRef; at: CellRef }[] = [];
for (let row = 0; row < GRID_ROWS; row += 1) {
  if (RUN_ROWS.includes(row)) continue;
  const at = row < RUN_ROWS[0] ? row + MATCH_MIN : row;
  SETTLED.push({ from: { col: RUN_COL, row }, at: { col: RUN_COL, row: at } });
}

/** The survivors the clear set never stood beside, read as whole tokens. */
const TOKENS: PlacedToken[] = SETTLED.filter(
  ({ from }) => !besideRun(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

/** The survivors the clear set stood beside, read by kind alone. */
const KINDS: PlacedToken[] = SETTLED.filter(({ from }) => besideRun(from)).map(
  ({ from, at }) => ({
    col: at.col,
    row: at.row,
    token: tokenAt(AFTER, from.col, from.row),
  }),
);

/**
 * Frames driven after the step has resolved, purely so the recorded clip holds
 * the shattering and the fall.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold; twelve more frames
 * of the suite's 64 Hz clock add `0.1875` s, for `0.22625` s in all. That is
 * short of `0.3` s, the SHORTEST hold any step can have, so the board is never
 * read a second time and every assertion is made against the reading taken before
 * them.
 */
const CLIP_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the three cells a swap lines up down one column", async () => {
  // The fixture states its own premises before the build is asked anything.
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  const runs = maximalRuns(AFTER);
  assertLength(runs, 1, "maximal runs the swap produces");
  assertTrue(!runs[0].horizontal, "the run lies down a column");
  assertLength(runs[0].cells, MATCH_MIN, "cells in the run");

  await loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // `swapAndStep` carried the swap through its own animation into step 1, so
  // this reading IS that step's.
  assertEqual(first.lastCleared, MATCH_MIN, "cells the step cleared");

  // Three cells left one column, so that column's survivors above the run stand
  // three rows lower and the ones below it have not moved at all.
  const board = renderBoard(first);
  assertBoardEquals(
    board,
    withCells(maskBoard(AFTER, []), TOKENS),
    "the run's own column",
  );
  for (const cell of KINDS) {
    assertEqual(
      parseToken(tokenAt(board, cell.col, cell.row)).kind,
      parseToken(cell.token).kind,
      `the kind standing at (${cell.col},${cell.row})`,
    );
  }
});
