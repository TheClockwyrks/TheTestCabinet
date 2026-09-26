// cuts/r8-brilliant-from-four — a maximal run of exactly four leaves one
// brilliant behind, carrying that run's kind at strain 0.
//
// R8's first table row in specs/rules.md: "A maximal run of exactly `4` — A
// `brilliant`", read together with the sentence below the table, "A created gem
// carries strain `0` and the kind of the run that created it".
//
// WHAT THE SCENARIO ISOLATES. The run is posed over the quiet filler, so the only
// maximal run the swap produces is the four this point is about. Nothing else
// seeds the step under R5; no brilliant and no star stands in the clear set to
// grow it under R6; and every gem on the board is at strain 0, so no flawed
// neighbor is drawn in either. The clear set is exactly the run's four cells, and
// the posed board carries no cut gem at all — so any gem that is not `plain`
// afterwards is one R8 created, and there is no counting of "before" against
// "after" to get wrong.
//
// WHY THE READING IS TAKEN AT STEP 1. specs/rules.md has an accepted swap
// exchange its two cells at once, set `phase` to `swapping` with `chainStep` at
// `0`, and clear nothing until `SWAP_SECONDS` (`0.18`) of game time has passed;
// step 1 then resolves, R8 and R9 both inside it. `swapAndResolve` carries the
// game through that animation and hands back `first`, the reading of step 1's
// result, beside `settled`, where the chain came to rest. `first` is what this
// check reads. A later step is seeded by whatever R9's drawn refill dropped in
// and is entitled to create cuts of its own — reading the settled board would be
// reading a different question, and one whose answer the build's random source
// decides.
//
// WHERE the brilliant lands is the three `cuts/r8-run-placement-at-the-*`
// points'. This check finds
// the created gem wherever on the board it stands.

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

/** The kind the run is made of, and so the kind the created gem must carry. */
const RUN_KIND = "ruby";

/** How many cells the run holds — the R8 row this point is about. */
const RUN_LENGTH = 4;

/**
 * The cells written over the quiet filler.
 *
 * Three rubies stand in row 3 at columns 3, 4 and 6, and the fourth waits one row
 * above at (5,2), so the swap that drops it in is what completes the run. The
 * filler holds a kind other than ruby at (2,3) and (7,3), which is what bounds the
 * run at both ends and makes it maximal at exactly four rather than longer.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 6, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The swap: the waiting ruby drops from (5,2) into the gap at (5,3). */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

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

it("leaves one brilliant of the run's kind at strain 0", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything. The posed board
  // is at rest under R4, and the exchange produces exactly one maximal run, of
  // exactly four rubies — so whatever the step does afterwards, that run is what
  // did it.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  const produced = maximalRuns(swapped(posed, FROM, TO));
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, RUN_LENGTH, "cells in the run it produces");
  assertEqual(produced[0].kind, RUN_KIND, "the kind of the run it produces");

  const before = await loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  const { first } = await captureReplay(h, "cut", () =>
    swapAndResolve(h, FROM, TO),
  );

  // The reading is step 1's, and that step cleared the run and nothing besides
  // it.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertEqual(first.lastCleared, RUN_LENGTH, "cells the step cleared");

  // R8's first row: the run of four creates one gem, that gem is a brilliant, and
  // it carries the run's kind at strain 0.
  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "brilliant", "the cut of the created gem");
  assertEqual(created[0].kind, RUN_KIND, "the kind the created gem carries");
  assertEqual(created[0].strain, 0, "the strain the created gem carries");
});
