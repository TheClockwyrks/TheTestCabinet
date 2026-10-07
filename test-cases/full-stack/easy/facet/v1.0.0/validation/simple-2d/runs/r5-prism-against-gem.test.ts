// runs/r5-prism-against-gem — trading a prism against a gem takes that prism and
// EVERY gem on the board of that gem's kind, wherever it sits.
//
// R5 of specs/rules.md replaces the ordinary seed outright for this one case:
// "Step 1 of a chain begun by a swap that traded a `prism` against a gem is
// seeded instead with that `prism` together with every gem on the board of that
// gem's kind." Not the gems near it, not the gems in its row or column — every
// gem of that kind on the board. R6 then grows the seed, but only through a
// `brilliant`, a `star` or a flawed gem, and this board carries none of the
// three, so what the step clears is the seed exactly.
//
// THE SCENARIO IS THE WHOLE BOARD. The filler under this check is the quiet one,
// which carries no run anywhere; the prism is written over a single cell of it
// and traded against the ruby beside it. Rubies are scattered the width and the
// height of that filler, the top-left corner and the bottom-right among them, so
// a build that reads the rule as "the row and column of the traded gem", or as
// "the gems adjacent to the prism", or as an ordinary run seed, clears a
// different number of cells and fails on the count. The ruby total is COUNTED
// off the board R5 read rather than written down, so the check states R5's
// sentence rather than a figure.
//
// AND THE BOARD IS SWEPT AFTERWARD. R9 refills a column from its top, so in a
// column that lost `k` cells only the top `k` rows can hold a gem the refill
// drew and every row below is a survivor of the step. No survivor anywhere may
// be a ruby — which is the same claim as "every gem of that kind", read off the
// board rather than off a counter.
//
// R7 IS KEPT OUT OF THE READING ENTIRELY. R7 raises the strain of the gems the
// clear set stands beside, and which gems those are is `strain/*`'s point rather
// than this one. R7 alters strain and alters neither kind nor cut, so a gem that
// stood anywhere in the clear set's eight-cell ring is read by its KIND alone
// here, and only a gem the clear set stood nowhere near is read as a whole
// token. The sweep below reads kinds throughout for the same reason.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  assertBoardEquals,
  isPrism,
  maskBoard,
  maximalRuns,
  parseRows,
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

/** The kind the prism is traded against, and so the kind the step takes. */
const TRADED_KIND = "ruby";

/** The prism, and the gem of `TRADED_KIND` the filler already holds beside it. */
const PRISM: CellRef = { col: 6, row: 3 };
const GEM: CellRef = { col: 6, row: 4 };

/**
 * The quiet filler with one cell turned into a prism.
 *
 * Writing a prism over a cell can never make a run — a prism belongs to no kind
 * — so the board still matches nothing anywhere, which is what leaves R5's
 * ordinary seed empty and the prism rule alone deciding the step.
 */
const POSED = quietRowsWith([{ col: PRISM.col, row: PRISM.row, token: "X0" }]);

/** The board the exchange produces: the prism at `(6,4)`, the ruby at `(6,3)`. */
const AFTER = swapped(POSED, PRISM, GEM);

/** Every cell of the traded kind, which R5 seeds the step with beside the prism. */
const OF_KIND: CellRef[] = [];
for (let row = 0; row < GRID_ROWS; row += 1) {
  for (let col = 0; col < GRID_COLS; col += 1) {
    if (parseToken(tokenAt(AFTER, col, row)).kind === TRADED_KIND) {
      OF_KIND.push({ col, row });
    }
  }
}

/** The seed: the prism together with every gem of that kind. */
const CLEARED: CellRef[] = [...OF_KIND, GEM];

/** How many cells the step empties out of one column. */
function lostFrom(col: number): number {
  return CLEARED.filter((cell) => cell.col === col).length;
}

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
 * Three survivors, each paired with the cell R9 left it standing in, which
 * between them pin the removal to the cells R5 names and to no others.
 *
 * Column 3 holds exactly one gem of the traded kind, at `(3,2)`. Above it, the
 * jade from the top of the column has fallen exactly one row, so one cell of
 * that column went. Below it, the beryl at `(3,4)` has not moved at all, so
 * nothing below the ruby went with it. Column 2's only gem of the traded kind
 * sits five rows further down, at `(2,6)`, three columns and four rows away from
 * the swap, and the citrine at the top of that column falls exactly one row,
 * which happens only if a cell that far from the swap was taken.
 */
const READINGS: { from: CellRef; at: CellRef }[] = [
  { from: { col: 3, row: 0 }, at: { col: 3, row: 1 } },
  { from: { col: 3, row: 4 }, at: { col: 3, row: 4 } },
  { from: { col: 2, row: 0 }, at: { col: 2, row: 1 } },
];

/** The readings the clear set never stood beside, read as whole tokens. */
const TOKENS: PlacedToken[] = READINGS.filter(
  ({ from }) => !besideCleared(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

/** The readings the clear set stood beside, read by kind alone. */
const KINDS: PlacedToken[] = READINGS.filter(({ from }) =>
  besideCleared(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

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

it("clears the prism and every gem of the kind it was traded against", async () => {
  // The fixture states its own premises: the prism and the gem really are the
  // two cells traded, the board carries no run for the ordinary seed to take,
  // and nothing on it is flawed or cut, so R6 adds nothing to the seed.
  assertTrue(isPrism(POSED, PRISM), "the cell traded away holds a prism");
  assertEqual(parseToken(tokenAt(POSED, GEM.col, GEM.row)).kind, TRADED_KIND);
  assertLength(maximalRuns(AFTER), 0, "maximal runs the swap produces");
  for (const gem of parseRows(AFTER).flat()) {
    assertEqual(gem.strain, 0, "the strain of every gem posed");
    assertTrue(
      gem.cut === "plain" || gem.cut === "prism",
      "every posed gem is plain or the prism itself",
    );
  }

  loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, PRISM, GEM);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // The prism plus every gem of that kind, counted off the board R5 read.
  assertEqual(first.lastCleared, CLEARED.length, "cells the step cleared");

  // Two columns say where those cells went: one lost the single gem of that
  // kind it held and nothing else, and one lost a gem five rows from the swap.
  const board = renderBoard(first);
  assertBoardEquals(
    board,
    withCells(maskBoard(AFTER, []), TOKENS),
    "the two columns the readings are taken from",
  );
  for (const cell of KINDS) {
    assertEqual(
      parseToken(tokenAt(board, cell.col, cell.row)).kind,
      parseToken(cell.token).kind,
      `the kind standing at (${cell.col},${cell.row})`,
    );
  }

  // And nothing of that kind survived anywhere. Only the top `k` cells of a
  // column that lost `k` can have come from R9's refill; every row below them
  // stood on the board the step read.
  for (let col = 0; col < GRID_COLS; col += 1) {
    for (let row = lostFrom(col); row < GRID_ROWS; row += 1) {
      assertNotEqual(
        parseToken(tokenAt(board, col, row)).kind,
        TRADED_KIND,
        `the survivor at (${col},${row})`,
      );
    }
  }
});
