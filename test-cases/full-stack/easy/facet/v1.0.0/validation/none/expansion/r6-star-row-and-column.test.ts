// expansion/r6-star-row-and-column — a star in the clear set takes its whole row
// and its whole column.
//
// specs/rules.md R6, second addition: "for every `star` in the set, every cell
// in that `star`'s row and every cell in its column". Whole lines, edge to edge,
// and not a length or a reach: a star at any cell of an 8x8 board adds the 8
// cells of its row and the 8 of its column, which share the star itself, so 15
// cells.
//
// THE SCENARIO. A run of three rubies is completed across the middle of the
// board with a ruby STAR as its middle cell, at (3,4). Every other gem on the
// board is an ordinary plain gem at strain 0, so nothing else in R6 can fire —
// no brilliant to bring a ring, and no flawed gem for the third addition. The
// run lies inside the star's own row, so the whole clear set is that row and
// that column: 15 cells, and the run adds none of its own beyond them.
//
// The run is exactly three long, so R8's table creates nothing and the 15 cells
// stay empty for R9. `lastCleared` reports how many the step took, and where the
// surviving gems came to rest reports which: a build that stopped its star at
// the run, or that ran the row but not the column, leaves gems standing in cells
// this scenario has emptied.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, type GemKind } from "../constants";
import {
  maximalRuns,
  parseToken,
  quietRowsWith,
  rowAndColumn,
  swapped,
  tokenAt,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** The cells of `cells`, each named once, in the order they were given in. */
function distinct(cells: readonly CellRef[]): CellRef[] {
  const seen = new Set<string>();
  return cells.filter(({ col, row }) => {
    const key = `${col},${row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The kind standing at one cell of a written board; `null` is a prism. */
function kindAt(rows: BoardRows, col: number, row: number): GemKind | null {
  return parseToken(tokenAt(rows, col, row)).kind;
}

/**
 * Where every gem the step did NOT take must stand once R9 has settled the
 * board.
 *
 * R9 drops each column's survivors to the lowest empty cells below them, keeping
 * the order the column held them in, so a survivor's resting row counts how many
 * cells above it were emptied. That is what makes an emptying readable at all: a
 * step puts the board back together before it ends, so no reading catches a cell
 * while it stands empty.
 *
 * Kinds alone. Strain is R7's business and a cut is R8's, and neither belongs to
 * this point. The cells above the survivors hold R9's refill, drawn from the
 * game's own random draw, and nothing here reads them.
 */
function restingKinds(
  before: BoardRows,
  cleared: readonly CellRef[],
): { col: number; row: number; kind: GemKind | null }[] {
  const taken = new Set(cleared.map(({ col, row }) => `${col},${row}`));
  const resting: { col: number; row: number; kind: GemKind | null }[] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    const standing: (GemKind | null)[] = [];
    for (let row = 0; row < GRID_ROWS; row += 1) {
      if (!taken.has(`${col},${row}`)) standing.push(kindAt(before, col, row));
    }
    const top = GRID_ROWS - standing.length;
    standing.forEach((kind, index) => {
      resting.push({ col, row: top + index, kind });
    });
  }
  return resting;
}

/** The star, at the middle of the run and away from every edge. */
const STAR: CellRef = { col: 3, row: 4 };

/** The run of three the swap completes, with the star as its middle cell. */
const RUN: readonly CellRef[] = [{ col: 2, row: 4 }, STAR, { col: 4, row: 4 }];

/** The two cells the swap exchanges: the third ruby drops into the run. */
const FROM: CellRef = { col: 4, row: 3 };
const TO: CellRef = { col: 4, row: 4 };

/**
 * The board the scenario is posed on: the run-free filler carrying the star, the
 * ruby beside it, and the ruby the swap brings down into the run.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: STAR.col, row: STAR.row, token: "R0s" },
  { col: FROM.col, row: FROM.row, token: "R0" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/**
 * R6's second addition applied to the one star in the seed: every cell of row 4
 * and every cell of column 3. The run lies inside row 4, so it contributes
 * nothing the two lines do not already hold, and the set is 8 + 8 - 1 = 15.
 */
const CLEARED: readonly CellRef[] = distinct([
  ...RUN,
  ...rowAndColumn(STAR.col, STAR.row),
]);

/**
 * Frames recorded after the step has resolved, so the replay shows the clear set
 * shattering and the board falling in behind it.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold; twelve more frames
 * of the suite's 64 Hz clock add `0.1875` s, for `0.22625` s in all. That is
 * short of `0.3` s, the SHORTEST hold any step can have, so the board is never
 * read a second time and every assertion is made against the reading the drive
 * returned.
 */
const REPLAY_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes every cell of a cleared star's row and column", async () => {
  // The fixture, established before the build is asked anything: no run on the
  // posed board, exactly one of exactly three cells after the exchange, and a
  // clear set that is the star's two lines and nothing besides.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertLength(CLEARED, 15, "the star's row and column, counted once each");

  await loadBoard(h, POSED);

  const step = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    const settled = await h.board();
    await h.advance(REPLAY_FRAMES);
    return { reading, settled };
  });

  assertEqual(
    step.reading.phase,
    "resolving",
    "phase after the swap animation",
  );
  assertEqual(step.reading.chainStep, 1, "the step the reading describes");

  // The whole row and the whole column, sharing the star: 15 cells for a step
  // whose seed was three.
  assertEqual(step.reading.lastCleared, CLEARED.length, "cells the step took");

  // And which 15. Column 3 loses every one of its gems, and the seven other
  // columns lose the cell of row 4 alone, so every survivor of those seven rests
  // exactly where the rule says the fall leaves it.
  for (const { col, row, kind } of restingKinds(EXCHANGED, CLEARED)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
});
