// Facet — scoring/score-base-rate: a gem the step clears below MAX_STRAIN pays
// BASE_SCORE, times the step's multiplier.
//
// specs/rules.md's scoring table has exactly two rows, and this point owns the
// first of them: strain `0`, `1` or `2` scores `BASE_SCORE` (10) x `M`. The
// second row is `scoring/score-flawed-rate`'s, and the multiplier itself is
// `scoring/score-multiplier`'s, so the scenario here is pinned to chain step 1,
// where `M = min(1, MAX_MULTIPLIER)` is 1 and the step's points are the plain sum
// of the rate over the clear set.
//
// WHY THE THREE GEMS CARRY THREE DIFFERENT STRAINS. The rule is one rate across a
// BAND of strains, not a rate for clean gems. A run written entirely at strain 0
// would be paid the same 30 by a build that scored `(MAX_STRAIN - strain) * 10`,
// or by one that scored 10 for strain 0 and something else for 1 and 2. Clearing
// one gem at each of 0, 1 and 2 in a single step is what makes the band itself
// observable: all three must be paid the same 10.
//
// WHERE THE EXPECTED FIGURE COMES FROM. The clear set is computed here, from the
// board this scenario produces, by `board.ts`'s restatement of R4, R5 and R6 —
// not read back off the build. The point asserts what specs/rules.md says the
// step is worth, so a build that clears a different set fails with the count as
// well as the figure.
//
// AND WHERE THE MEASURED FIGURE IS READ. `score` is read on the settled board the
// swap is about to be made on and again on the state the swap left, and what the
// step paid is the difference. specs/rules.md's table is about what a cleared gem
// ADDS, so the running total is where the rate is observable. `lastPoints` is not
// read: what that field reports of a step is `scoring/last-step-reported`'s
// claim, and a build that banks the right points and reports them badly owes that
// point and not this one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThan,
} from "../assert";
import { BASE_SCORE, MAX_STRAIN } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  strainAt,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/**
 * The ruby three the swap completes across row 4, one gem at each strain the
 * BASE_SCORE row covers.
 *
 * The third ruby waits one row above the gap so the swap that drops it in is the
 * move that makes the run, which is what puts the clear on chain step 1.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R1" },
  { col: 4, row: 4, token: "R2" },
];

/** The swap that drops the waiting ruby into the gap. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/**
 * Frames recorded after the step, so the replay shows the clear and the settle
 * rather than stopping on the swap. Read the figures BEFORE these run: they carry
 * the chain past `STEP_SECONDS` and a second step would overwrite them.
 */
const AFTERMATH_FRAMES = 24; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays BASE_SCORE for each cleared gem below MAX_STRAIN", async () => {
  const posed = quietRowsWith(RUN_CELLS);
  const resolved = swapped(posed, SWAP_A, SWAP_B);
  const cleared = clearSetFromRuns(resolved);

  // The fixture, established before the build is asked anything. The posed board
  // carries no run of its own, so the step under test is the swap's alone; the
  // swap produces exactly one maximal run; and nothing in R6 grows it, so the
  // clear set is the three gems the scenario wrote.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertEqual(maximalRuns(resolved).length, 1, "maximal runs the swap produces");
  assertEqual(cleared.length, 3, "cells the step clears");
  assertDeepEqual(
    cleared.map((cell) => strainAt(resolved, cell.col, cell.row)),
    [0, 1, 2],
    "the strains the cleared gems carry when the step scores them",
  );
  for (const cell of cleared) {
    assertLessThan(
      strainAt(resolved, cell.col, cell.row),
      MAX_STRAIN,
      `strain at (${cell.col},${cell.row}), which must be below MAX_STRAIN`,
    );
  }

  await loadBoard(h, posed);

  const driven = await captureReplay(h, "score", async () => {
    // One frame of the board as it stands, so the replay opens on the run the
    // swap is about to complete.
    await h.advance(1);
    // The standing score, read on the settled board the swap is about to be made
    // on. What the step paid is what it moves this figure by.
    const before = await h.snapshot();
    const step = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    return { before, step };
  });

  const { before, step } = driven;

  // Chain step 1, which is what fixes `M` at 1 and makes the step's points the
  // bare sum of the rate. Asserted as the scenario's premise, not as this point's
  // claim.
  assertEqual(step.chainStep, 1, "the chain step the accepted swap opened");
  assertEqual(
    step.score - before.score,
    cleared.length * BASE_SCORE,
    `${cleared.length} gems below MAX_STRAIN at BASE_SCORE (${BASE_SCORE}) each, ` +
      `on a step whose multiplier is 1`,
  );
});
