// cuts/r8-star-placement — a created star stands at the cell its two runs cross.
//
// specs/rules.md, under R8: "A `star` is placed at the cell its two runs
// intersect."
//
// THE SCENARIO IS BUILT SO NOTHING BUT THE PLACEMENT RULE CAN DECIDE THE ANSWER.
// Two demands, and each is met deliberately:
//
//   - THE CROSSING IS NEITHER CELL THE SWAP EXCHANGED. Jades already fill row 4 at
//     columns 4 to 6 and column 5 at rows 2 to 4, crossing at (5,4); the swap that
//     opens the chain is made three columns away, where it completes a run of three
//     jades along row 5. R5 seeds the step with the union of every maximal run on
//     the board, so all three runs clear in the one step, and a build that placed
//     the star at a swapped cell — or at either run's middle index, columns 5 of
//     row 4 aside — cannot land on the crossing by accident.
//   - R9 CANNOT MOVE IT. The crossing is the LOWEST cell of its column's run, and
//     the star fills it, so column 5 holds no empty cell at or below row 4 when R9
//     settles. The cell the star is read at is the cell R8 placed it at.
//
// A posed board that already carries runs is an ordinary board:
// specs/instrumentation.md has a posed board rest "exactly as it was written until
// a swap is accepted on it", and R3 accepts a swap when "the board it produces
// carries at least one maximal run".
//
// WHAT the created gem is — a star, of the runs' kind, at strain 0 — is
// `cuts/r8-star-from-intersection`'s point. This one is about the cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  maximalRuns,
  quietRowsWith,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** Where the two jade runs cross, and so where the star belongs. */
const CROSSING: CellRef = { col: 5, row: 4 };

/** Cells cleared: three along row 4 and three down column 5 sharing the crossing, plus the three the swap completes. */
const CLEARED = 8;

/**
 * The cells written over the quiet filler.
 *
 * Jades at (4,4), (5,4) and (6,4) make the row's run and jades at (5,2), (5,3) and
 * (5,4) the column's, crossing at (5,4). The filler bounds both: a beryl at (3,4),
 * an amber at (7,4), a ruby above (5,2) and an amber below (5,4), so each run is
 * maximal at exactly three. The jade at (1,5) is the third gem of the run the swap
 * itself completes, away in columns 0 to 2.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 4, row: 4, token: "J0" },
  { col: 5, row: 4, token: "J0" },
  { col: 6, row: 4, token: "J0" },
  { col: 5, row: 2, token: "J0" },
  { col: 5, row: 3, token: "J0" },
  { col: 1, row: 5, token: "J0" },
];

/** The swap, made away from the crossing: it completes row 5's run of three. */
const FROM: CellRef = { col: 2, row: 4 };
const TO: CellRef = { col: 2, row: 5 };

/**
 * Every gem a reading reports that is not `plain`.
 *
 * Under this scenario that is exactly the set R8 created: the posed board carries
 * no cut gem, the clear set holds none, and R9 refills every emptied cell with a
 * `plain` gem at strain 0.
 */
function cutCells(snapshot: FacetSnapshot): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut !== "plain");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts the created star on the cell its two runs cross", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: the exchange
  // leaves three maximal runs standing, two of them crossing at CROSSING, and
  // CROSSING is neither cell the swap exchanged.
  const produced = maximalRuns(swapped(posed, FROM, TO));
  assertLength(produced, 3, "maximal runs the exchange leaves standing");
  const crossing = produced.filter((run) =>
    run.cells.some(
      (cell) => cell.col === CROSSING.col && cell.row === CROSSING.row,
    ),
  );
  assertLength(crossing, 2, "runs that hold the crossing cell");
  assertLength(
    crossing.filter((run) => run.horizontal),
    1,
    "horizontal runs among the crossing pair",
  );
  const down = crossing.filter((run) => !run.horizontal)[0];
  assertEqual(
    Math.max(...down.cells.map((cell) => cell.row)),
    CROSSING.row,
    "the lowest row the column's run reaches, which R9 must not empty below",
  );
  for (const cell of [FROM, TO]) {
    assertEqual(
      cell.col === CROSSING.col && cell.row === CROSSING.row,
      false,
      "whether a cell the swap exchanged is the crossing",
    );
  }

  const before = loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  // Read the step the swap resolved, then draw one frame so the evidence shows the
  // board the assertions are about. One frame is far short of STEP_SECONDS, so no
  // second step is read before the picture is taken.
  const first = swap(h, FROM, TO);
  await h.advance(1);
  captureStill(h, "placement");

  assertEqual(first.chainStep, 1, "the chain step the swap opened");
  assertEqual(first.lastCleared, CLEARED, "cells the step cleared");

  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "star", "the cut of the created gem");
  assertEqual(created[0].col, CROSSING.col, "the column the star stands in");
  assertEqual(created[0].row, CROSSING.row, "the row the star stands in");
});
