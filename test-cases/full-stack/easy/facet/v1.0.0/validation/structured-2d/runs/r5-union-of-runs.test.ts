// runs/r5-union-of-runs — one step removes EVERY maximal run standing on the
// board, not only the one the swap completed.
//
// R5 of specs/rules.md seeds a step's clear set "with the union of every maximal
// run on the board". The word doing the work is *every*: a step is a pass over
// the whole board, not a resolution of the move that started it. A build that
// tracks the swap's own two cells and clears the run they landed in plays a game
// that looks right until a second run happens to be standing, and then quietly
// leaves it there.
//
// HOW A SECOND RUN COMES TO BE STANDING. `loadBoard` poses an arbitrary board and
// leaves it at rest — specs/instrumentation.md: "a posed board rests exactly as
// it was written until a swap is accepted on it" — so a run can be written onto
// the board and simply sit there, untouched, until the swap in the far corner
// wakes the step up. The two runs share no column and no row and lie two rows
// apart, so neither one's clear, settle or refill can reach the other, and the
// six cells they hold between them are removed in the ONE step the swap
// resolves: `lastCleared` is read off that step alone, with no frame advanced.
//
// WHAT THIS POINT READS. The six columns the two runs stand in, and nothing
// else. Each of them closed over one cell, which happens only if the step took
// that column's cell of its run — and that is stated for BOTH runs, so a build
// that resolved only the swap's own fails on the three columns of the other. The
// columns between the runs carry nothing the item claims and are left unread.
//
// AND R7 IS KEPT OUT OF THE READING ENTIRELY. R7 raises the strain of the gems
// the clear set stands beside, and which gems those are is `strain/*`'s point
// rather than this one. R7 alters strain and alters neither kind nor cut, so a
// gem that stood anywhere in the clear set's eight-cell ring is read by its KIND
// alone here, and only a gem the clear set stood nowhere near is read as a whole
// token. A build's reading of R7 therefore cannot decide this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_ROWS, MATCH_MIN } from "../constants";
import {
  assertBoardEquals,
  maskBoard,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderBoard,
  ring,
  runSeed,
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

/** How many maximal runs stand on the board when the step reads it. */
const RUNS = 2;

/** The run written onto the board, which is standing before the swap. */
const STANDING_ROW = 3;
const STANDING_COLS = [0, 1, 2];

/** The run the swap completes, in the opposite corner. */
const SWUNG_ROW = 5;
const SWUNG_COLS = [5, 6, 7];

/** The swap: a citrine drops into the gap at the right-hand run's far end. */
const FROM: CellRef = { col: 7, row: SWUNG_ROW - 1 };
const TO: CellRef = { col: 7, row: SWUNG_ROW };

/**
 * A ruby three already lying along row 3, and a citrine three a swap away in
 * row 5.
 *
 * The filler holds a ruby at `(1,3)` and a citrine at `(6,5)` of its own, so each
 * run needs two cells written over it. The standing run is bounded by the board's
 * left edge and by the citrine at `(3,3)`; the swung one by the ruby at `(4,5)`
 * and the board's right edge.
 */
const POSED = quietRowsWith([
  { col: STANDING_COLS[0], row: STANDING_ROW, token: "R0" },
  { col: STANDING_COLS[2], row: STANDING_ROW, token: "R0" },
  { col: SWUNG_COLS[0], row: SWUNG_ROW, token: "C0" },
  { col: FROM.col, row: FROM.row, token: "C0" },
]);

/** The board the exchange produces, which is what R5 seeds itself from. */
const AFTER = swapped(POSED, FROM, TO);

/** Both runs' cells: the union R5 seeds the step with. */
const CLEARED: CellRef[] = runSeed(AFTER);

/**
 * Whether the clear set stands beside a cell, at an edge or at a corner.
 *
 * The gems R7 can reach are among these, whatever adjacency a build reads the
 * rule with, so a gem that stood here crosses the step with a strain this point
 * does not read.
 */
function besideCleared(cell: CellRef): boolean {
  return ring(cell.col, cell.row).some((around) =>
    CLEARED.some(
      (cleared) => cleared.col === around.col && cleared.row === around.row,
    ),
  );
}

/**
 * Every survivor of the six columns the two runs stand in, paired with the cell
 * R9 left it standing in.
 *
 * One cell of each of those columns was emptied and R9 drops every survivor to
 * the lowest empty cell below it, keeping the column's order: the gems above
 * that column's run stand one row lower afterward, and the gems below it stand
 * where they stood. A column that did not shift is a column whose run was left
 * standing. The one cell of each column holding no survivor afterward is row
 * `0`, which R9 refilled off the game's own generator, and no check may assert
 * what landed there.
 */
const SETTLED: { from: CellRef; at: CellRef }[] = [];
for (const [runRow, cols] of [
  [STANDING_ROW, STANDING_COLS],
  [SWUNG_ROW, SWUNG_COLS],
] as const) {
  for (const col of cols) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      if (row === runRow) continue;
      const at = row < runRow ? row + 1 : row;
      SETTLED.push({ from: { col, row }, at: { col, row: at } });
    }
  }
}

/** The survivors the clear set never stood beside, read as whole tokens. */
const TOKENS: PlacedToken[] = SETTLED.filter(
  ({ from }) => !besideCleared(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

/** The survivors the clear set stood beside, read by kind alone. */
const KINDS: PlacedToken[] = SETTLED.filter(({ from }) =>
  besideCleared(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

/**
 * Frames driven after the swap purely so the recorded clip holds motion. Short
 * of `STEP_SECONDS` (0.25 s, 16 frames of the suite's 64 Hz clock), so the board
 * is never read a second time and every assertion is made against the reading
 * taken before them.
 */
const CLIP_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears both maximal runs standing on the board in one step", async () => {
  // The fixture states its own premises: one run is already there before the
  // swap, and the swap makes a second, for two runs of three between them.
  assertLength(maximalRuns(POSED), 1, "maximal runs on the posed board");
  assertLength(maximalRuns(AFTER), RUNS, "maximal runs the swap produces");
  assertLength(CLEARED, RUNS * MATCH_MIN, "cells the two runs hold");

  loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = swap(h, FROM, TO);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // One step, both runs: six cells, not the three the swap itself completed.
  assertEqual(first.lastCleared, CLEARED.length, "cells the step cleared");
  assertEqual(first.chainStep, 1, "the step that cleared them");

  // And all six columns closed over their own cell of a run, so neither run was
  // merely scored and left in place.
  const board = renderBoard(first);
  assertBoardEquals(
    board,
    withCells(maskBoard(AFTER, []), TOKENS),
    "the columns the two runs stand in",
  );
  for (const cell of KINDS) {
    assertEqual(
      parseToken(tokenAt(board, cell.col, cell.row)).kind,
      parseToken(cell.token).kind,
      `the kind standing at (${cell.col},${cell.row})`,
    );
  }
});
