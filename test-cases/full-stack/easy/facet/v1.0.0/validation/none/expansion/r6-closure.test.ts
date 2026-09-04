// expansion/r6-closure — the clear set is the smallest set containing the seed
// and closed under all three additions.
//
// specs/rules.md R6 does not describe one pass over the seed. It names a fixed
// point: "The clear set is the smallest set of cells that contains the seed and
// is closed under all three additions." A cell that enters by one addition is
// then read by all three, so the set grows until nothing more can be added, and
// only then does the rest of the step read it.
//
// A single pass and a closure differ the moment an addition reaches something
// that adds in its turn, and this scenario is built to make that difference
// large and legible.
//
// THE SCENARIO. A run of three rubies is completed down the left edge, rows 5 to
// 7 of column 0. Running away from the run's top cell, along row 5, is a line of
// four flawed gems, and beyond them at (5,5) a flawed BRILLIANT:
//
//   - the run seeds the set;
//   - the flawed gem at (1,5) is orthogonally adjacent to the run's (0,5), so
//     the third addition takes it. It is now IN the set, so its own flawed
//     neighbor at (2,5) is taken, and so on down the line — a single pass over
//     the seed would have stopped after the first;
//   - the flawed brilliant at (5,5) is reached the same way, and being in the
//     set it brings the first addition with it: its eight surrounding cells,
//     seven of which are new;
//   - none of those seven is flawed or cut, so nothing further is added and the
//     set is closed.
//
// Fifteen cells: three of run, four of flawed line, the brilliant, and seven of
// its ring. Every gem in that ring is plain at strain 0, and the run is exactly
// three long, so R8 creates nothing and R9 closes the board over all fifteen.
//
// The expected set is written out cell by cell below and cross-checked against
// the closure the case computes from the rule, so the two independent statements
// of it have to agree before the build is asked anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, MAX_STRAIN, type GemKind } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  parseToken,
  quietRowsWith,
  ring,
  strainAt,
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
 * game's own seeded source, and nothing here reads them.
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

/** The run of three the swap completes, down the left edge. */
const RUN: readonly CellRef[] = [
  { col: 0, row: 5 },
  { col: 0, row: 6 },
  { col: 0, row: 7 },
];

/** The line of flawed gems running away from the run's top cell. */
const FLAWED_LINE: readonly CellRef[] = [
  { col: 1, row: 5 },
  { col: 2, row: 5 },
  { col: 3, row: 5 },
  { col: 4, row: 5 },
];

/** The flawed brilliant at the far end of that line, clear of every edge. */
const BRILLIANT: CellRef = { col: 5, row: 5 };

/** The two cells the swap exchanges: the third ruby moves into the run. */
const FROM: CellRef = { col: 1, row: 6 };
const TO: CellRef = { col: 0, row: 6 };

/**
 * The board the scenario is posed on. Every flawed gem keeps the filler's own
 * kind at its cell and differs from it in strain and cut alone, so the line
 * cannot make or lengthen a run of its own.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 0, row: 5, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: 1, row: 5, token: "B3" },
  { col: 2, row: 5, token: "S3" },
  { col: 3, row: 5, token: "M3" },
  { col: 4, row: 5, token: "R3" },
  { col: BRILLIANT.col, row: BRILLIANT.row, token: "A3b" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/**
 * The closure, written out: the run, the flawed line taken end to end, the
 * flawed brilliant the line reaches, and the brilliant's eight surrounding
 * cells. One of those eight is the line's last cell, so the set is 15.
 */
const CLEARED: readonly CellRef[] = distinct([
  ...RUN,
  ...FLAWED_LINE,
  BRILLIANT,
  ...ring(BRILLIANT.col, BRILLIANT.row),
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

it("grows the seed until the three additions add nothing more", async () => {
  // The fixture. The posed board holds no run, the exchange makes exactly one of
  // exactly three cells, and every gem of the line and of the brilliant's cell
  // is at MAX_STRAIN so the third addition really reaches them.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  for (const cell of [...FLAWED_LINE, BRILLIANT]) {
    assertEqual(
      strainAt(EXCHANGED, cell.col, cell.row),
      MAX_STRAIN,
      `the strain at (${cell.col},${cell.row})`,
    );
  }
  assertLength(CLEARED, 15, "the closure written out cell by cell");

  // The same set arrived at the other way: the case's own least fixed point over
  // the exchanged board, from the run seed. Two independent statements of the
  // closure, held to each other before the build is asked anything.
  const computed = clearSetFromRuns(EXCHANGED);
  assertLength(computed, CLEARED.length, "the closure the rule computes");
  for (const cell of CLEARED) {
    assertContains(
      computed,
      cell,
      `the computed closure holds (${cell.col},${cell.row})`,
    );
  }

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

  // Fifteen from a seed of three, in ONE step. A build that applied the three
  // additions once over the seed reports 4: the run plus the single flawed gem
  // the run itself touches.
  assertEqual(step.reading.lastCleared, CLEARED.length, "cells the step took");

  // And they were those fifteen — the line taken end to end, and the ring the
  // brilliant contributed once the line reached it. Every gem the step left
  // standing is named at the cell R9's fall brings it to, so a cell the closure
  // failed to reach is reported by the gem still standing in it.
  for (const { col, row, kind } of restingKinds(EXCHANGED, CLEARED)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
});
