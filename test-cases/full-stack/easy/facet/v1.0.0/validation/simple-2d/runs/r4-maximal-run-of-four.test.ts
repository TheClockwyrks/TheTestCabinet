// runs/r4-maximal-run-of-four — a swap that puts FOUR gems of one kind on
// consecutive cells clears all four, not a three-cell subset of them.
//
// R4 of specs/rules.md is careful about this: "A run is maximal when each of the
// two cells immediately beyond its ends either lies off the board or holds a gem
// of another kind, and only a maximal run counts." A build that scans for
// windows of `MATCH_MIN` and clears the first one it finds is a build that clears
// three of these four and leaves the fourth standing, and it plays a visibly
// different game — the leftover gem sits in the gap the other three fell
// through. So the run here is bounded on BOTH ends by a gem of another kind
// rather than by an edge, which is the case that tells the two readings apart.
//
// WHAT R8 DOES TO THE EVIDENCE, AND HOW THIS POINT KEEPS CLEAR OF IT. A maximal
// run of exactly four creates a `brilliant`, and R8 places it at one of the four
// cells the removal left empty — WHICH one is `cuts/r8-run-placement`'s point
// and not this one. The run here therefore runs down a single COLUMN, which
// takes the placement rule out of the reading altogether: the four empties are
// four consecutive cells of one column with survivors below them, so wherever in
// the run R8 puts the created gem, R9 drops it to the run's LOWEST cell and
// leaves every other survivor of that column in the same place. That one cell is
// left unread, and the rest of the column is what this point is read over.
//
// AND R7 IS KEPT OUT OF THE READING ENTIRELY. R7 raises the strain of the gems
// the clear set stands beside, and which gems those are is `strain/*`'s point
// rather than this one. R7 alters strain and alters neither kind nor cut, so a
// gem that stood anywhere in the clear set's eight-cell ring is read by its KIND
// alone here, and only a gem the clear set stood nowhere near is read as a whole
// token. A build's reading of R7 therefore cannot decide this point.

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

/** How long the run is: one past `MATCH_MIN`, so a subset of it is also a run. */
const RUN_LENGTH = MATCH_MIN + 1;

/** The column the run lands in, and the four rows it spans. */
const RUN_COL = 3;
const RUN_ROWS = [2, 3, 4, 5];
const RUN_CELLS: CellRef[] = RUN_ROWS.map((row) => ({ col: RUN_COL, row }));

/**
 * The cell R9 leaves the gem R8 created resting in: the run's lowest.
 *
 * The four cells the removal empties are consecutive, and the two cells of the
 * column below them hold survivors that do not move. Whichever of the four R8
 * placed the created gem at, it is the lowest survivor above those two, so R9
 * drops it here — which is why this point can leave the placement rule to
 * `cuts/r8-run-placement` and simply not read this cell.
 */
const CREATED: CellRef = { col: RUN_COL, row: RUN_ROWS[RUN_LENGTH - 1] };

/** The swap: the jade one column over slides into the gap in the column. */
const FROM: CellRef = { col: RUN_COL - 1, row: 4 };
const TO: CellRef = { col: RUN_COL, row: 4 };

/**
 * Three jades down column `3` with the fourth still beside the gap.
 *
 * The filler already holds a jade at `(2,4)`, so the column needs the ones at
 * `(3,2)`, `(3,3)` and `(3,5)` written over it and the gap at `(3,4)` holds the
 * filler's own beryl until the swap. Posed, the column reads `J S J J B J A J`:
 * two jades, a gap, one jade — no run at all. Swapped, it reads `J S J J J J A
 * J`, and the cells immediately beyond the run's ends hold a sapphire and an
 * amber, so the four are maximal and neither end runs off the board.
 */
const POSED = quietRowsWith([
  { col: RUN_COL, row: RUN_ROWS[0], token: "J0" },
  { col: RUN_COL, row: RUN_ROWS[1], token: "J0" },
  { col: RUN_COL, row: RUN_ROWS[3], token: "J0" },
  { col: FROM.col, row: FROM.row, token: "J0" },
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
 * Four consecutive cells of the column are emptied and one created gem is put
 * back among them, so the column comes up `RUN_LENGTH - 1` cells short: every
 * survivor above the run stands three rows lower afterward, and the two below it
 * stand where they stood. A column that fell by less than three is a column
 * whose cell of the run was left standing, which is exactly the failure this
 * point exists to catch. The three cells holding no survivor afterward are the
 * top three rows, which R9 refilled off the game's own generator, and no check
 * may assert what landed there.
 */
const SETTLED: { from: CellRef; at: CellRef }[] = [];
for (let row = 0; row < GRID_ROWS; row += 1) {
  if (RUN_ROWS.includes(row)) continue;
  const at = row < RUN_ROWS[0] ? row + (RUN_LENGTH - 1) : row;
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

afterEach(() => {
  h?.dispose();
});

it("clears all four cells of a maximal run of four", async () => {
  // The fixture states its own premises before the build is asked anything: the
  // posed board matches nothing, the swap makes exactly one run, of four, down
  // one column, and the cell R9 rests the created gem in is never read.
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  const runs = maximalRuns(AFTER);
  assertLength(runs, 1, "maximal runs the swap produces");
  assertTrue(!runs[0].horizontal, "the run lies down a column");
  assertLength(runs[0].cells, RUN_LENGTH, "cells in the run");
  assertTrue(
    ![...TOKENS, ...KINDS].some(
      (cell) => cell.col === CREATED.col && cell.row === CREATED.row,
    ),
    "the cell the created gem rests in is left unread",
  );

  loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // Four cells, not three: the whole maximal run, not a window inside it.
  assertEqual(first.lastCleared, RUN_LENGTH, "cells the step cleared");

  // And the run's own column fell by three, which it does only if all four of
  // its cells of the run went and one gem came back among them.
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
