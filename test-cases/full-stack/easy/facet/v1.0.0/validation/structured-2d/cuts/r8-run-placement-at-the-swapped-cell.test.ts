// cuts/r8-run-placement-at-the-swapped-cell — a run's created gem goes to the
// swapped cell that lies in it.
//
// specs/rules.md, the placement paragraph under R8: "For a run of length `n`,
// index its cells `0` to `n - 1` from its lowest-column end for a horizontal run
// and from its lowest-row end for a vertical run. The gem that run creates is
// placed at whichever of the two cells the chain's swap exchanged lies in the run,
// at the one of lower index when both lie in it, and at the run's cell at index
// `floor((n - 1) / 2)` when neither does."
//
// THREE CLAUSES, THREE POINTS. A build that answers one of them and not the
// others puts a created gem in the wrong cell on most boards, and would grade
// exactly as a build that answers none of them if the three shared one point.
//
// THIS POINT IS THE FIRST CLAUSE: "placed at whichever of the two cells the
// chain's swap exchanged lies in the run". The scenario puts that cell at index
// 2, so a build falling back to the middle index answers index 1 and fails here.
//
// THE RUN IS HORIZONTAL, for a reason that is R9's: R8 creates the gem and R9
// settles the board in the same step, so a created gem standing over an emptied
// cell of its own column would fall before anything could read it. A horizontal
// run empties exactly one cell in each of its columns, and the created gem fills
// one of them — so in the column that holds it nothing is empty at all, and
// nothing below it was emptied either. R9 cannot move it, and the cell it is read
// at is the cell R8 placed it at.
//
// THE RUN IS FOUR LONG SO THE THREE CLAUSES DISAGREE. `floor((4 - 1) / 2)` is
// index 1, so a build falling back to the middle index, or to an end, or to the
// swap, answers a different cell in each of the three scenarios and each is
// caught by the point that is about it.
//
// EVERY READING IS TAKEN AT STEP 1. specs/rules.md has an accepted swap exchange
// its two cells at once, set `phase` to `swapping` with `chainStep` at `0`, and
// clear nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1
// then resolves, R8 and R9 both inside it. `swapAndResolve` carries the game
// through that animation and hands back `first`, the reading of step 1's result,
// which is what the scenario reads. A later step is seeded from whatever R9's
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

afterEach(() => {
  h.dispose();
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

  loadBoard(h, posed);
  const { first } = await captureReplay(h, "placement", () =>
    swapAndResolve(h, from, to),
  );
  assertEqual(first.lastCleared, 4, "cells the step cleared");

  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].col, 5, "the column the created gem was placed at");
  assertEqual(created[0].row, 3, "the row the created gem was placed at");
});
