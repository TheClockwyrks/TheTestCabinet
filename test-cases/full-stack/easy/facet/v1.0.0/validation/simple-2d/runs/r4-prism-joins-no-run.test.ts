// runs/r4-prism-joins-no-run — a prism belongs to no kind, so a line of five
// cells reading `R0 R0 X0 R0 R0` holds no run and clears nothing.
//
// R4 of specs/rules.md ends with the sentence this point is: "A `prism` belongs
// to no kind and joins no run." Two readings of a prism are wrong and both are
// natural to write. One treats it as a wildcard that matches whatever is beside
// it, and clears all five of these cells. The other treats it as a cell to skip
// over, and joins the two pairs into a run of four. The line above tells all
// three readings apart at once: under the specification it is four rubies in two
// pairs and nothing happens to any of them.
//
// HOW A "NOTHING HAPPENS" IS OBSERVED. A step only runs when a swap is accepted,
// so this scenario asks for a productive swap in the FAR corner of the board and
// then reads what the resulting step took. The line sits three rows away from
// that swap's run and shares no column with it, so nothing the step does can
// reach it: under the specification the five cells come through the step
// character for character, and `lastCleared` counts the far run alone. A build
// that reads the prism as a wildcard clears five more cells than it should; one
// that reads through it clears four more.
//
// WHAT THIS POINT READS. The line's five cells, and nothing else on the board.
// The far run is the scenario's engine rather than its subject, so what its own
// columns settle into is `runs/r4-horizontal-run`'s point and is left unread
// here, and so are the gems the far clear set stands beside, which are
// `strain/*`'s. The line lies clear of both: no column it occupies loses a cell,
// and no cell of it stands anywhere in the far clear set's eight-cell ring, so
// the five tokens are read whole and a build's reading of R7 cannot decide this
// point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { MATCH_MIN } from "../constants";
import {
  assertBoardEquals,
  hasPrism,
  maskBoard,
  maximalRuns,
  quietRowsWith,
  renderBoard,
  ring,
  swapped,
  withCells,
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

/** The row the prism-broken line is written along, and the tokens along it. */
const LINE_ROW = 1;
const LINE: PlacedToken[] = ["R0", "R0", "X0", "R0", "R0"].map(
  (token, col) => ({
    col,
    row: LINE_ROW,
    token,
  }),
);

/**
 * The kind that ends the line at its right-hand end.
 *
 * The filler holds a ruby at `(5,1)`, which would make the line's right-hand
 * pair a run of three all by itself. A jade there bounds the line instead, and
 * the board's left edge bounds it on the other side.
 */
const LINE_END: PlacedToken = { col: 5, row: LINE_ROW, token: "J0" };

/** The far corner: the row the swap's run lands on, and its three columns. */
const RUN_ROW = 4;
const RUN_COLS = [5, 6, 7];
const RUN_CELLS: CellRef[] = RUN_COLS.map((col) => ({ col, row: RUN_ROW }));

/** The swap that gives the step something to do, three rows below the line. */
const FROM: CellRef = { col: 6, row: RUN_ROW - 1 };
const TO: CellRef = { col: 6, row: RUN_ROW };

/**
 * The line, its right-hand bound, and a productive swap far away from both.
 *
 * The filler already holds an amethyst at `(5,4)`; the one written at `(7,4)`
 * and the one parked at `(6,3)` complete a row of three against the board's
 * right edge when they trade.
 */
const POSED = quietRowsWith([
  ...LINE,
  LINE_END,
  { col: RUN_COLS[2], row: RUN_ROW, token: "M0" },
  { col: FROM.col, row: FROM.row, token: "M0" },
]);

/** The board the exchange produces, which is what R4 and R5 are read over. */
const AFTER = swapped(POSED, FROM, TO);

/** Whether the far clear set stands beside a cell, at an edge or at a corner. */
function besideRun(cell: CellRef): boolean {
  return ring(cell.col, cell.row).some((around) =>
    RUN_CELLS.some((run) => run.col === around.col && run.row === around.row),
  );
}

/**
 * The five cells of the line, which are the whole of what this point reads.
 *
 * None of them lies in a column the far run empties, so R9 moves none of them,
 * and none of them lies in the far clear set's ring, so R7 reaches none of them
 * either. They therefore cross the step character for character, and this point
 * asserts exactly that.
 */
const READ: readonly PlacedToken[] = LINE;

/**
 * One frame after the step has resolved, so the still shows the line the step
 * left standing.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold and one more frame
 * of the suite's 64 Hz clock adds `0.015625` s, which is far short of `0.3` s,
 * the SHORTEST hold any step can have. So the board is never read a second time
 * and the assertions are made against the reading the drive returned.
 */
const CLIP_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a prism-broken line of one kind entirely alone", async () => {
  // The fixture states its own premises: a prism really is on the board, the
  // line really carries no run under R4, and the swap really makes exactly one
  // run of three, clear of the line's row, of the line's columns, and of every
  // cell the line stands on.
  assertTrue(hasPrism(POSED), "a prism stands on the posed board");
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  const runs = maximalRuns(AFTER);
  assertLength(runs, 1, "maximal runs the swap produces");
  assertLength(runs[0].cells, MATCH_MIN, "cells in the run");
  for (const cell of runs[0].cells) {
    assertEqual(cell.row, RUN_ROW, "the run stays clear of the line's row");
  }
  for (const cell of READ) {
    assertTrue(
      !RUN_COLS.includes(cell.col) && !besideRun(cell),
      `the far run leaves (${cell.col},${cell.row}) alone`,
    );
  }

  loadBoard(h, POSED);
  const first = await swapAndStep(h, FROM, TO);
  await h.advance(CLIP_FRAMES);
  captureStill(h, "line");

  // The far run and nothing else: not the five cells a wildcard reading takes,
  // and not the four a read-through reading joins.
  assertEqual(first.lastCleared, MATCH_MIN, "cells the step cleared");

  // And the line stands exactly as it was written, ruby for ruby.
  assertBoardEquals(
    renderBoard(first),
    withCells(maskBoard(AFTER, []), READ),
    "the prism-broken line",
  );
});
