// cuts/r8-run-placement — where a run's created gem is placed.
//
// specs/rules.md, the placement paragraph under R8: "For a run of length `n`,
// index its cells `0` to `n - 1` from its lowest-column end for a horizontal run
// and from its lowest-row end for a vertical run. The gem that run creates is
// placed at whichever of the two cells the chain's swap exchanged lies in the run,
// at the one of lower index when both lie in it, and at the run's cell at index
// `floor((n - 1) / 2)` when neither does."
//
// Three clauses, and one scenario each. Every one poses a HORIZONTAL run of four,
// for a reason that is R9's: R8 creates the gem and R9 settles the board in the
// same step, so a created gem standing over an emptied cell of its own column
// would fall before anything could read it. A horizontal run empties exactly one
// cell in each of its columns, and the created gem fills one of them — so in the
// column that holds it nothing is empty at all, and nothing below it was emptied
// either. R9 cannot move it, and the cell it is read at is the cell R8 placed it
// at.
//
// EACH SCENARIO IS ARRANGED SO THE THREE CLAUSES DISAGREE. A run of four has
// `floor((4 - 1) / 2)` = index 1, so:
//
//   - one swapped cell in the run, at index 2 — a build falling back to the middle
//     index would answer index 1;
//   - both swapped cells in the run, at indices 2 and 3 — a build taking the
//     higher would answer index 3, and one falling back to the middle, index 1;
//   - neither swapped cell in the run — index 1, which a build placing at an end
//     or at the swap would miss.
//
// THE MIDDLE SCENARIO NEEDS A RUN THAT ALREADY STANDS, and so does the last. Two
// cells the swap exchanged can both lie in one run only if both hold that run's
// kind afterwards, and therefore both held it before — the exchange moves strain
// and cut between them, not kind. specs/instrumentation.md is explicit that a
// posed board "rests exactly as it was written until a swap is accepted on it",
// and R3 accepts a swap whenever "the board it produces carries at least one
// maximal run", which a standing run satisfies. So both are ordinary boards under
// the rules, reached the way the rules allow.
//
// EVERY READING IS TAKEN AT STEP 1. specs/rules.md has an accepted swap exchange
// its two cells at once, set `phase` to `swapping` with `chainStep` at `0`, and
// clear nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1
// then resolves, R8 and R9 both inside it. `swapAndResolve` carries the game
// through that animation and hands back `first`, the reading of step 1's result,
// which is what each scenario reads. A later step is seeded from whatever R9's
// refill dealt and may create a cut of its own at a cell no clause of the
// placement paragraph names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  maximalRuns,
  quietRowsWith,
  swapped,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swapAndResolve,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/**
 * Every gem a reading reports that is not `plain`.
 *
 * Under each scenario below that is exactly the set R8 created: the posed board
 * carries no cut gem, the clear set holds none, and R9 refills every emptied cell
 * with a `plain` gem at strain 0.
 */
function cutCells(snapshot: FacetSnapshot): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut !== "plain");
}

/**
 * Establish that the exchange leaves exactly one maximal run, of four cells,
 * spanning `cols` of `row`.
 *
 * The fixture's own arithmetic, checked before the build is asked anything, so a
 * scenario that stopped posing what its comment says fails as a fixture fault
 * rather than as a verdict about the build. The extra `also` runs are the ones a
 * scenario deliberately plants elsewhere on the board.
 */
function assertRunOfFour(
  posed: BoardRows,
  from: CellRef,
  to: CellRef,
  row: number,
  cols: readonly number[],
  also = 0,
): void {
  const produced = maximalRuns(swapped(posed, from, to));
  assertLength(produced, 1 + also, "maximal runs the exchange leaves standing");
  const wanted = produced.filter(
    (run) => run.horizontal && run.cells[0].row === row,
  );
  assertLength(wanted, 1, `runs the exchange leaves along row ${row}`);
  assertEqual(
    wanted[0].cells.map((cell) => cell.col).join(","),
    cols.join(","),
    `the columns that run spans in row ${row}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a run's gem at the swapped cell that lies in the run", async () => {
  // Three rubies stand in row 3 at columns 3, 4 and 6, and the fourth drops in from
  // (5,2). Of the two cells the swap exchanged only (5,3) lies in the run, at index
  // 2 counting from the run's lowest column, 3.
  const cells: readonly PlacedToken[] = [
    { col: 3, row: 3, token: "R0" },
    { col: 4, row: 3, token: "R0" },
    { col: 6, row: 3, token: "R0" },
    { col: 5, row: 2, token: "R0" },
  ];
  const from: CellRef = { col: 5, row: 2 };
  const to: CellRef = { col: 5, row: 3 };
  const posed = quietRowsWith(cells);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertRunOfFour(posed, from, to, 3, [3, 4, 5, 6]);

  await loadBoard(h, posed);
  const { first } = await swapAndResolve(h, from, to);
  assertEqual(first.lastCleared, 4, "cells the step cleared");

  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].col, 5, "the column the created gem was placed at");
  assertEqual(created[0].row, 3, "the row the created gem was placed at");
});

it("places a run's gem at the lower-indexed of two swapped cells in it", async () => {
  // The run of four already stands across columns 3 to 6 of row 3, and the swap
  // exchanges two of its own cells — (5,3) at index 2 with (6,3) at index 3. They
  // carry different strain, so the exchange really does change the board, while the
  // kinds it moves leave the run standing exactly where it was.
  const cells: readonly PlacedToken[] = [
    { col: 3, row: 3, token: "R0" },
    { col: 4, row: 3, token: "R0" },
    { col: 5, row: 3, token: "R0" },
    { col: 6, row: 3, token: "R2" },
  ];
  const from: CellRef = { col: 5, row: 3 };
  const to: CellRef = { col: 6, row: 3 };
  const posed = quietRowsWith(cells);
  assertRunOfFour(posed, from, to, 3, [3, 4, 5, 6]);

  await loadBoard(h, posed);
  const { first } = await swapAndResolve(h, from, to);
  assertEqual(first.lastCleared, 4, "cells the step cleared");

  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].col, 5, "the column the created gem was placed at");
  assertEqual(created[0].row, 3, "the row the created gem was placed at");
});

it("places a run's gem at its middle index when neither swapped cell is in it", async () => {
  // A run of four rubies already stands across columns 3 to 6 of row 1. The swap is
  // made far from it, in columns 0 to 2, where it completes a run of three jades
  // along row 5 — so the step is seeded under R5 with the union of both runs, and
  // R8 reads both. Neither cell the swap exchanged lies in the run of four, so its
  // gem belongs at index `floor((4 - 1) / 2)` = 1, which is column 4.
  //
  // The run of three creates nothing, and its three cells sit in columns the run of
  // four does not touch, so R9 leaves column 4 alone but for the cell the created
  // gem itself fills.
  const cells: readonly PlacedToken[] = [
    { col: 3, row: 1, token: "R0" },
    { col: 4, row: 1, token: "R0" },
    { col: 6, row: 1, token: "R0" },
    { col: 1, row: 5, token: "J0" },
  ];
  const from: CellRef = { col: 2, row: 4 };
  const to: CellRef = { col: 2, row: 5 };
  const posed = quietRowsWith(cells);
  assertRunOfFour(posed, from, to, 1, [3, 4, 5, 6], 1);

  await loadBoard(h, posed);
  const { first } = await captureReplay(h, "placement", () =>
    swapAndResolve(h, from, to),
  );
  // Four from the run this point is about, three from the run the swap made.
  assertEqual(first.lastCleared, 7, "cells the step cleared");

  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].col, 4, "the column the created gem was placed at");
  assertEqual(created[0].row, 1, "the row the created gem was placed at");
});
