// cuts/r8-star-from-intersection — a cell lying in two crossing maximal runs, one
// horizontal and one vertical, leaves a star carrying those runs' kind at strain
// 0.
//
// R8's third table row in specs/rules.md: "A cell lying in two intersecting
// maximal runs, one horizontal and one vertical — A `star`", read together with "A
// created gem carries strain `0` and the kind of the run that created it".
//
// WHAT THE SCENARIO ISOLATES, AND WHY BOTH RUNS ARE THREE LONG. The two runs cross
// at (4,4): rubies fill row 4 at columns 4 to 6 and column 4 at rows 4 to 6. Each
// run is exactly `MATCH_MIN` long, so neither of the two length rows of R8's table
// applies to any cell of either — the only row that applies anywhere on this board
// is the crossing one, and a single created gem is the whole of what R8 owes.
// That is what makes the check about the crossing rather than about priority,
// which is `cuts/r8-priority-prism-over-star`'s and
// `cuts/r8-priority-star-over-brilliant`'s point.
//
// Nothing else on the board seeds the step; nothing in the clear set is a
// brilliant or a star to grow it under R6; every gem is at strain 0, so no flawed
// neighbor is drawn in. The clear set is the five cells of the two runs, and the
// posed board carries no cut gem — so any gem that is not `plain` afterwards is
// one R8 created.
//
// THE READING IS TAKEN AT STEP 1. specs/rules.md has an accepted swap exchange
// its two cells at once, set `phase` to `swapping` with `chainStep` at `0`, and
// clear nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1
// then resolves, R8 and R9 both inside it. `swapAndResolve` carries the game
// through that animation and hands back `first`, the reading of step 1's result,
// which is what this check reads. A later step is seeded from whatever R9's
// refill dealt and may create cuts of its own.
//
// WHERE the star lands is `cuts/r8-star-placement`'s point; this check finds it
// wherever it stands, which matters here because R9 runs after R8 in the same
// step and this arrangement leaves emptied cells below the crossing for the star
// to fall into.

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

/** The kind both runs are made of, and so the kind the star must carry. */
const RUN_KIND = "ruby";

/** Cells in the union of the two runs: three and three, sharing the crossing. */
const CLEARED = 5;

/**
 * The cells written over the quiet filler.
 *
 * Two arms of a cross whose corner cell is missing: (5,4) and (6,4) to the right
 * of it, (4,5) and (4,6) below it, and the ruby that completes it waiting one row
 * above at (4,3). The filler holds a beryl at (3,4) and an amber at (7,4), and a
 * sapphire above and a beryl below the column's arm, so each run is bounded at
 * both ends and is maximal at exactly three.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 5, row: 4, token: "R0" },
  { col: 6, row: 4, token: "R0" },
  { col: 4, row: 5, token: "R0" },
  { col: 4, row: 6, token: "R0" },
  { col: 4, row: 3, token: "R0" },
];

/** The swap: the waiting ruby drops from (4,3) into the corner at (4,4). */
const FROM: CellRef = { col: 4, row: 3 };
const TO: CellRef = { col: 4, row: 4 };

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

afterEach(async () => {
  await h.dispose();
});

it("leaves one star of the crossing runs' kind at strain 0", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: the posed board
  // rests under R4, and the exchange produces exactly two maximal runs — one along
  // a row and one down a column, each of exactly three rubies, sharing one cell.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  const produced = maximalRuns(swapped(posed, FROM, TO));
  assertLength(produced, 2, "maximal runs the exchange produces");
  for (const run of produced) {
    assertLength(run.cells, 3, "cells in each run it produces");
    assertEqual(run.kind, RUN_KIND, "the kind of each run it produces");
  }
  assertLength(
    produced.filter((run) => run.horizontal),
    1,
    "horizontal runs among the two",
  );
  const shared = produced[0].cells.filter((cell) =>
    produced[1].cells.some(
      (other) => other.col === cell.col && other.row === cell.row,
    ),
  );
  assertLength(shared, 1, "cells the two runs share");

  const before = await loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  const { first } = await captureReplay(h, "cut", () =>
    swapAndResolve(h, FROM, TO),
  );

  // The reading is step 1's, and its clear set was the union of the two runs.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertEqual(first.lastCleared, CLEARED, "cells the step cleared");

  // R8's third row: the crossing creates one gem, that gem is a star, and it
  // carries the runs' kind at strain 0. Neither run is long enough for the two
  // length rows, so this one gem is the whole of what the step created.
  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "star", "the cut of the created gem");
  assertEqual(created[0].kind, RUN_KIND, "the kind the created gem carries");
  assertEqual(created[0].strain, 0, "the strain the created gem carries");
});
