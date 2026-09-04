// expansion/r6-flawed-diagonal-stands — a flawed gem only diagonally beside the
// clear set stays where it is.
//
// specs/rules.md R6, third addition, reaches "every flawed gem ORTHOGONALLY
// adjacent to a cell in the set", and specs/rules.md R1 fixes what orthogonally
// adjacent means: a difference of `1` in column and `0` in row, or `0` and `1`.
// A diagonal neighbor differs by `1` in both and is neither, so the addition
// does not reach it.
//
// THE OTHER DIRECTION IS ITS OWN POINT. That a flawed gem orthogonally beside
// the set IS taken is `expansion/r6-flawed-adjacent-taken`, because a build that
// reaches diagonally passes that point and fails this one, and a build that
// ignores the third addition altogether fails that one and passes this one.
//
// THE SCENARIO. A run of three rubies is completed across the middle of the
// board with one flawed amber DIAGONALLY off the run's right-hand end, touching
// the set at a corner alone. None of its four orthogonal neighbors is in the
// set, so nothing draws it in. Every other gem on the board is plain at strain
// 0, so no brilliant and no star can grow the set, and the run is exactly three
// long, so R8 creates nothing. The clear set is the run alone: three.
//
// `lastCleared` is 3 rather than the 4 a build that reached diagonally would
// report, and the amber still stands at its own cell, still flawed, having
// neither been taken nor moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, MAX_STRAIN, type GemKind } from "../constants";
import {
  areAdjacent,
  maximalRuns,
  parseToken,
  quietRowsWith,
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

/** The run of three the swap completes. */
const RUN: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
];

/** The flawed gem diagonally off the run's right-hand end. */
const DIAGONAL: CellRef = { col: 5, row: 5 };

/** The two cells the swap exchanges: the third ruby rises into the run. */
const FROM: CellRef = { col: 3, row: 5 };
const TO: CellRef = { col: 3, row: 4 };

/**
 * The board the scenario is posed on. The flawed gem keeps the filler's own kind
 * at its cell and differs from it in strain alone, so it can neither make nor
 * lengthen a run.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: DIAGONAL.col, row: DIAGONAL.row, token: "A3" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/** The seed, which is the whole of the clear set: nothing is drawn in. */
const CLEARED: readonly CellRef[] = RUN;

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

it("leaves a flawed gem that touches the set at a corner alone", async () => {
  // The fixture, and here it carries the whole distinction the point rests on.
  // The posed board holds no run; the exchange makes exactly one, three cells
  // long. The placed gem is at MAX_STRAIN, so it is flawed, and it is adjacent
  // to no cell of the clear set at all — which is what makes this a reading of
  // the rule rather than of the board's luck.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertEqual(
    strainAt(EXCHANGED, DIAGONAL.col, DIAGONAL.row),
    MAX_STRAIN,
    "the strain of the gem off the run's end",
  );
  assertEqual(
    CLEARED.some((cell) => areAdjacent(cell, DIAGONAL)),
    false,
    "the flawed amber touches no cell of the set orthogonally",
  );

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

  // The three cells of the run and nothing else: not the four a build that
  // reached diagonally would report.
  assertEqual(step.reading.lastCleared, CLEARED.length, "cells the step took");

  // The diagonal gem is untouched: still amber, still at MAX_STRAIN, and still
  // in its own cell, since nothing was taken from its column for it to fall
  // into.
  assertEqual(
    kindAt(step.settled, DIAGONAL.col, DIAGONAL.row),
    "amber",
    "the kind still standing off the run's end",
  );
  assertEqual(
    strainAt(step.settled, DIAGONAL.col, DIAGONAL.row),
    MAX_STRAIN,
    "the strain still standing off the run's end",
  );

  // And every other column settled as the run alone leaving it says it must.
  for (const { col, row, kind } of restingKinds(EXCHANGED, CLEARED)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
});
