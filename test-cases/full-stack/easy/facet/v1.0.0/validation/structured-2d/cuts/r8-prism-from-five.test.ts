// cuts/r8-prism-from-five — a maximal run of five leaves one prism behind, and a
// prism carries no kind.
//
// R8's second table row in specs/rules.md: "A maximal run of `5` or more — A
// `prism`", read together with "A created gem carries strain `0` and the kind of
// the run that created it, a created `prism` carrying no kind". specs/board.md
// fixes how a kindless gem is reported: "a cell's `kind` is `null` for a `prism`".
//
// WHAT THE SCENARIO ISOLATES. Five rubies in one row over the quiet filler, with a
// kind other than ruby immediately beyond each end, so the run is maximal at
// exactly five and no second run crosses it. Nothing else on the board seeds the
// step; nothing in the clear set is a brilliant or a star to grow it under R6; and
// every gem is at strain 0, so no flawed neighbor is drawn in. The clear set is
// the run's five cells, and the posed board carries no cut gem at all — so any
// gem that is not `plain` afterwards is one R8 created.
//
// THE READING IS TAKEN AT STEP 1. specs/rules.md has an accepted swap exchange
// its two cells at once, set `phase` to `swapping` with `chainStep` at `0`, and
// clear nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1
// then resolves, R8 and R9 both inside it. `swapAndResolve` carries the game
// through that animation and hands back `first`, the reading of step 1's result,
// which is what this check reads. A later step is seeded from whatever R9's
// refill dealt and may create cuts of its own, so the settled board would answer
// a different question.
//
// WHERE the prism lands is the three `cuts/r8-run-placement-at-the-*` points';
// this check finds the
// created gem wherever on the board it stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
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

/** How many cells the run holds — the R8 row this point is about. */
const RUN_LENGTH = 5;

/**
 * The cells written over the quiet filler.
 *
 * Four rubies stand in row 4 at columns 2, 3, 5 and 6, and the fifth waits one row
 * above at (4,3), so the swap that drops it in closes the gap at (4,4) and makes
 * the line five long. The filler holds a citrine at (1,4) and an amber at (7,4),
 * so the run is bounded at both ends and is maximal at exactly five.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 4, token: "R0" },
  { col: 5, row: 4, token: "R0" },
  { col: 6, row: 4, token: "R0" },
  { col: 4, row: 3, token: "R0" },
];

/** The swap: the waiting ruby drops from (4,3) into the gap at (4,4). */
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

afterEach(() => {
  h.dispose();
});

it("leaves one prism, carrying no kind, at strain 0", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: the posed board
  // rests under R4, and the exchange produces exactly one maximal run, of exactly
  // five gems of one kind.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  const produced = maximalRuns(swapped(posed, FROM, TO));
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, RUN_LENGTH, "cells in the run it produces");

  const before = loadBoard(h, posed);
  assertLength(cutCells(before), 0, "cut gems on the posed board");

  const { first } = await captureReplay(h, "cut", () =>
    swapAndResolve(h, FROM, TO),
  );

  // The reading is step 1's, and that step cleared the run and nothing besides
  // it.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertEqual(first.lastCleared, RUN_LENGTH, "cells the step cleared");

  // R8's second row: the run of five creates one gem, that gem is a prism, and a
  // prism belongs to no kind — reported as `null` — at strain 0.
  const created = cutCells(first);
  assertLength(created, 1, "gems the step created");
  assertEqual(created[0].cut, "prism", "the cut of the created gem");
  assertNull(created[0].kind, "the kind a created prism carries");
  assertEqual(created[0].strain, 0, "the strain the created gem carries");
});
