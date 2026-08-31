// expansion/r6-brilliant-ring — a brilliant in the clear set takes the eight
// cells around it.
//
// specs/rules.md R6, first addition: "for every `brilliant` in the set, each of
// the eight cells surrounding that `brilliant` that lies on the board". The seed
// is R5's union of the maximal runs, so a brilliant a run carries into the set
// brings its whole ring in with it, and the rest of the step reads the GROWN set
// rather than the run.
//
// THE SCENARIO. A run of three rubies is completed across the middle of the
// board with a ruby BRILLIANT as its middle cell, far enough from every edge
// that all eight of the cells surrounding it lie on the board. Each of those
// eight is an ordinary plain gem at strain 0, so no other part of R6 can fire:
// no second brilliant, no star, and no flawed gem anywhere on the board for the
// third addition to reach. The run is exactly three long, so R8's table creates
// nothing and every cell the step empties is still empty when R9 settles it.
//
// The clear set is therefore the run's three cells together with the eight
// around the brilliant, each counted once — nine cells, the whole 3x3 block the
// brilliant sits in the middle of.
//
// TWO READINGS DECIDE IT. `lastCleared` says how many cells the step took, and
// where the surviving gems came to rest says WHICH nine. A build that took the
// run alone, or that clipped a corner off the ring, leaves gems standing where
// this scenario says they cannot be, and is named by cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, type GemKind } from "../constants";
import {
  maximalRuns,
  parseToken,
  quietRowsWith,
  ring,
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

/** The brilliant, at the middle of the run and clear of every edge. */
const BRILLIANT: CellRef = { col: 3, row: 4 };

/** The run of three the swap completes, with the brilliant as its middle cell. */
const RUN: readonly CellRef[] = [
  { col: 2, row: 4 },
  BRILLIANT,
  { col: 4, row: 4 },
];

/** The two cells the swap exchanges: the third ruby drops into the run. */
const FROM: CellRef = { col: 2, row: 3 };
const TO: CellRef = { col: 2, row: 4 };

/**
 * The board the scenario is posed on: the run-free filler carrying the
 * brilliant, the ruby beside it, and the ruby the swap brings down into the run.
 */
const POSED: BoardRows = quietRowsWith([
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: BRILLIANT.col, row: BRILLIANT.row, token: "R0b" },
  { col: 4, row: 4, token: "R0" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/**
 * R6's first addition applied to the one brilliant in the seed: the run's three
 * cells plus the eight cells surrounding the brilliant, each named once. Two of
 * the eight are the run's own ends, so the set is nine cells rather than eleven.
 */
const CLEARED: readonly CellRef[] = distinct([
  ...RUN,
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

afterEach(() => {
  h?.dispose();
});

it("takes the eight cells around a brilliant it clears", async () => {
  // The fixture first, so a scenario that stopped being the one described above
  // fails as the fixture it is rather than as a verdict about the build. The
  // posed board carries no run at all, and the exchange makes exactly one, three
  // cells long — which is what leaves R8 nothing to create and the nine emptied
  // cells empty for R9 to close over.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertLength(CLEARED, 9, "the run and the ring, counted once each");

  loadBoard(h, POSED);

  const step = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    const settled = h.board();
    await h.advance(REPLAY_FRAMES);
    return { reading, settled };
  });

  // The swap was accepted and carried through its own animation into step 1, so
  // the reading below describes that step and no other.
  assertEqual(
    step.reading.phase,
    "resolving",
    "phase after the swap animation",
  );
  assertEqual(step.reading.chainStep, 1, "the step the reading describes");

  // R6's ring in one number: the run's three cells and the eight around the
  // brilliant, with the two they share counted once.
  assertEqual(step.reading.lastCleared, CLEARED.length, "cells the step took");

  // And they were those nine. Every gem the step left standing is named at the
  // cell R9's fall brings it to, so a ring cell that survived is reported by the
  // gem that failed to move over it.
  for (const { col, row, kind } of restingKinds(EXCHANGED, CLEARED)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
});
