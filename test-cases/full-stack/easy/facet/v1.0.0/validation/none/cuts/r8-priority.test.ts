// cuts/r8-priority — when more than one row of R8's table applies to one cell,
// `prism` beats `star` and `star` beats `brilliant`, and the cell takes exactly
// one created gem.
//
// specs/rules.md, under R8: "Where more than one row applies to one cell, `prism`
// wins over `star`, and `star` wins over `brilliant`, and that cell takes one
// created gem."
//
// HOW A CELL IS MADE TO BE CONTESTED. Two rows apply to one cell only when the
// cell a run's created gem is placed at is also the cell two runs cross at. Both
// scenarios below arrange exactly that, and they arrange it so that it holds under
// either reading of R8's placement paragraph, which is what keeps this point about
// PRIORITY and not about placement:
//
//   - the crossing cell (4,4) is one of the two cells the swap exchanged, and it
//     lies in the row run — so the placement paragraph's first clause puts the
//     run's gem there;
//   - and (4,4) is also the run's cell at index `floor((n - 1) / 2)` — index 2 of
//     the five-run at columns 2..6, index 1 of the four-run at columns 3..6 — so
//     the paragraph's last clause puts it there too.
//
// A build that reads the placement rule either way therefore contests the same
// cell, and the only question left is which cut wins it. `cuts/r8-run-placement`
// is where the placement rule itself is decided.
//
// WHAT EACH SCENARIO PROVES. Five along the row crossing three down the column
// makes `prism` and `star` both apply, and the prism must win. Four along the row
// crossing three down the column makes `star` and `brilliant` both apply, and the
// star must win. In each, the whole step must create exactly ONE gem: a build that
// honored the losing row as well would leave two.
//
// BOTH ARE READ AT STEP 1. specs/rules.md has an accepted swap exchange its two
// cells at once, set `phase` to `swapping` with `chainStep` at `0`, and clear
// nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1 then
// resolves, R8 and R9 both inside it. `swapAndResolve` carries the game through
// that animation and hands back `first`, the reading of step 1's result, which is
// what each scenario reads. A later step is seeded from whatever R9's refill
// dealt and may create cuts of its own.
//
// Neither scenario reads WHERE the gem ended up: R9 settles after R8 in the same
// step, and the emptied column below the crossing lets the created gem fall.

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
  captureReplay,
  createHarness,
  loadBoard,
  swapAndResolve,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/**
 * The column arm both scenarios share: two rubies below the crossing, and the
 * ruby that completes the cross waiting one row above it.
 *
 * The filler holds a sapphire at (4,3) once the swap has carried the ruby out of
 * it and a beryl at (4,7), so the column's run is bounded at both ends and is
 * maximal at exactly three — too short for either length row of R8's table, which
 * is what leaves the row run as the only other claimant on the crossing.
 */
const COLUMN_ARM: readonly PlacedToken[] = [
  { col: 4, row: 5, token: "R0" },
  { col: 4, row: 6, token: "R0" },
  { col: 4, row: 3, token: "R0" },
];

/** The swap both scenarios make: the waiting ruby drops into the crossing. */
const FROM: CellRef = { col: 4, row: 3 };
const TO: CellRef = { col: 4, row: 4 };

/**
 * Every gem a reading reports that is not `plain`.
 *
 * Under both scenarios that is exactly the set R8 created: the posed board carries
 * no cut gem, the clear set holds none, and R9 refills every emptied cell with a
 * `plain` gem at strain 0.
 */
function cutCells(snapshot: FacetSnapshot): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut !== "plain");
}

/**
 * Establish that the exchange really does produce the two crossing runs the
 * scenario claims, and that they cross at the cell the swap filled.
 *
 * The fixture's own arithmetic, checked before the build is asked anything, so a
 * scenario that stopped posing what its comment says fails as a fixture fault
 * rather than as a verdict about the build.
 */
function assertCrossing(posed: readonly string[], rowRunLength: number): void {
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  const produced = maximalRuns(swapped(posed, FROM, TO));
  assertLength(produced, 2, "maximal runs the exchange produces");
  const along = produced.filter((run) => run.horizontal);
  const down = produced.filter((run) => !run.horizontal);
  assertLength(along, 1, "row runs the exchange produces");
  assertLength(down, 1, "column runs the exchange produces");
  assertLength(along[0].cells, rowRunLength, "cells in the row run");
  assertLength(down[0].cells, 3, "cells in the column run");
  const shared = along[0].cells.filter((cell) =>
    down[0].cells.some(
      (other) => other.col === cell.col && other.row === cell.row,
    ),
  );
  assertLength(shared, 1, "cells the two runs share");
  assertEqual(shared[0].col, TO.col, "the column the two runs cross at");
  assertEqual(shared[0].row, TO.row, "the row the two runs cross at");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives a contested cell a prism rather than a star", async () => {
  // Row 4 carries five rubies across columns 2 to 6 once the swap lands, bounded by
  // a citrine at (1,4) and an amber at (7,4). The crossing cell lies in a run of
  // five, which R8's second row makes a prism, and in two crossing runs, which its
  // third row makes a star.
  const posed = quietRowsWith([
    { col: 2, row: 4, token: "R0" },
    { col: 3, row: 4, token: "R0" },
    { col: 5, row: 4, token: "R0" },
    { col: 6, row: 4, token: "R0" },
    ...COLUMN_ARM,
  ]);
  assertCrossing(posed, 5);

  const before = await loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  const { first } = await captureReplay(h, "cut", () =>
    swapAndResolve(h, FROM, TO),
  );

  // The clear set is the union of the two runs: five along the row and three down
  // the column, sharing the crossing.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertEqual(first.lastCleared, 7, "cells the step cleared");

  // One gem created, and the prism won the cell the two rows contested.
  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "prism", "the cut that won the contested cell");
});

it("gives a contested cell a star rather than a brilliant", async () => {
  // Row 4 carries four rubies across columns 3 to 6 once the swap lands, bounded by
  // a jade at (2,4) and an amber at (7,4). The crossing cell lies in a run of four,
  // which R8's first row makes a brilliant, and in two crossing runs, which its
  // third row makes a star.
  //
  // This scenario writes no replay: the two here share one output id, and the one
  // the item keeps is the prism above, where the cut that wins is the rarest.
  const posed = quietRowsWith([
    { col: 3, row: 4, token: "R0" },
    { col: 5, row: 4, token: "R0" },
    { col: 6, row: 4, token: "R0" },
    ...COLUMN_ARM,
  ]);
  assertCrossing(posed, 4);

  const before = await loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  const { first } = await swapAndResolve(h, FROM, TO);

  // The clear set is the union of the two runs: four along the row and three down
  // the column, sharing the crossing.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertEqual(first.lastCleared, 6, "cells the step cleared");

  // One gem created, and the star won the cell the two rows contested.
  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "star", "the cut that won the contested cell");
});
