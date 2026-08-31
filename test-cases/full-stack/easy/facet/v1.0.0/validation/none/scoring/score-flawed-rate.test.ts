// Facet — scoring/score-flawed-rate: a gem the step clears at MAX_STRAIN pays
// FLAWED_SCORE.
//
// The second row of specs/rules.md's scoring table: strain `3` scores
// `FLAWED_SCORE` (20) x `M`. The rule that binds it to the row above is the
// sentence beside the table — "Each gem in the clear set scores by the strain it
// carried when the step scored it" — so the rate follows the GEM, not the step,
// and one step can pay both rates at once.
//
// WHAT THE FLAWED GEM IS WORTH, MEASURED RATHER THAN RECKONED. The figure this
// point owns is what ONE gem at MAX_STRAIN adds, and the way to read one gem's
// share of a step is to run the step twice, once without it. So the same run of
// three is cleared by the same swap on TWO boards: the first carries the run
// alone, the second carries the run and one flawed gem beside it, which R6 draws
// into the clear set. The two clear sets are otherwise the same cells at the same
// strains, so what the clean gems are paid is paid on both boards and falls out
// of the difference — and the difference is the flawed gem's own share.
//
// WHY IT IS NOT RECKONED FROM THE OTHER RATE. What a gem below MAX_STRAIN pays is
// `scoring/score-base-rate`'s claim. An expectation of `3 x BASE_SCORE +
// FLAWED_SCORE` would fail this point for a build that priced clean gems wrongly
// and flawed ones exactly as the specification says — charging one build two
// points for one fault. The subtraction leaves this point holding the one figure
// it owns, whatever the build pays for a clean gem.
//
// HOW THE FLAWED GEM GETS INTO THE CLEAR SET. It is not in the run. R6's third
// addition draws in "every flawed gem orthogonally adjacent to a cell in the
// set", so the flawed amber sitting directly above the left end of the run is
// pulled in by the rule rather than placed in the run by the fixture — which
// keeps the scenario one a real board reaches.
//
// WHAT IS READ, AND WHERE. `score` either side of each swap: specs/rules.md's
// table is about what a cleared gem ADDS, so the running total is where a rate is
// observable. `lastPoints` is not read — what that field reports of a step is
// `scoring/last-step-reported`'s claim. Both steps run at chain step 1, where `M`
// is 1, so each reading is one step's worth at the bare rate.
//
// The clear sets and their strains are computed here from R4, R5 and R6 as
// `board.ts` restates them, over the boards these swaps produce. Nothing is read
// off the build to decide what it owes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { FLAWED_SCORE, MAX_STRAIN } from "../constants";
import {
  clearSetFromRuns,
  isFlawed,
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

/** A ruby three at strain 0 that the swap completes across row 4. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];

/**
 * One flawed amber orthogonally above the run's left end: R6's third addition,
 * posed, and the only thing the second board carries that the first does not.
 *
 * The amber is the kind the quiet filler already holds at `(2,3)`, so the only
 * thing the fixture changes there is the strain: the cell joins the clear set
 * because it is FLAWED, never because it matches anything.
 */
const FLAWED_CELL: PlacedToken = { col: 2, row: 3, token: "A3" };

/** The swap that drops the waiting ruby into the gap and completes the run. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/**
 * Frames recorded after each step, so the replay shows the flawed gem going with
 * the run. The figures are read before these run: a second step would overwrite
 * them.
 */
const AFTERMATH_FRAMES = 24; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays FLAWED_SCORE for a cleared gem at MAX_STRAIN", async () => {
  const bare = quietRowsWith(RUN_CELLS);
  const grown = quietRowsWith([...RUN_CELLS, FLAWED_CELL]);
  const bareResolved = swapped(bare, SWAP_A, SWAP_B);
  const grownResolved = swapped(grown, SWAP_A, SWAP_B);
  const bareCleared = clearSetFromRuns(bareResolved);
  const grownCleared = clearSetFromRuns(grownResolved);

  // The fixture. Neither posed board carries a run of its own, so each step is
  // its swap's alone, and the same swap produces exactly one run on each.
  assertEqual(maximalRuns(bare).length, 0, "maximal runs on the posed board");
  assertEqual(
    maximalRuns(grown).length,
    0,
    "maximal runs on the posed board carrying the flawed gem",
  );
  assertEqual(
    maximalRuns(bareResolved).length,
    1,
    "maximal runs the first swap produces",
  );
  assertEqual(
    maximalRuns(grownResolved).length,
    1,
    "maximal runs the second swap produces",
  );

  // The first step clears the run and nothing else, every gem in it below
  // MAX_STRAIN.
  assertDeepEqual(
    bareCleared.map((cell) => strainAt(bareResolved, cell.col, cell.row)),
    [0, 0, 0],
    "the strains the first step's cleared gems carry when the step scores them",
  );

  // The second step clears those same cells, at those same strains, and exactly
  // one cell more: the flawed gem R6 draws in. What the shared cells are paid is
  // therefore paid on both boards, whatever it is.
  for (const cell of bareCleared) {
    assertEqual(
      strainAt(grownResolved, cell.col, cell.row),
      strainAt(bareResolved, cell.col, cell.row),
      `strain at (${cell.col},${cell.row}) on the board carrying the flawed gem`,
    );
  }
  const added = grownCleared.filter(
    (cell) =>
      !bareCleared.some(
        (shared) => shared.col === cell.col && shared.row === cell.row,
      ),
  );
  assertEqual(added.length, 1, "cells the flawed gem adds to the clear set");
  assertEqual(
    strainAt(grownResolved, added[0].col, added[0].row),
    MAX_STRAIN,
    `the strain the cell R6 adds at (${added[0].col},${added[0].row}) carries`,
  );
  assertEqual(
    grownCleared.filter((cell) =>
      isFlawed(strainAt(grownResolved, cell.col, cell.row)),
    ).length,
    1,
    "gems at MAX_STRAIN in the second step's clear set",
  );

  const driven = await captureReplay(h, "score", async () => {
    await loadBoard(h, bare);
    // One frame of the board as it stands, so the replay opens on the run the
    // first swap is about to complete.
    await h.advance(1);
    // The standing score, read on the settled board the swap is about to be made
    // on. What the step paid is what it moves this figure by.
    const beforeBare = await h.snapshot();
    const bareStep = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    // The same run again, with the flawed gem standing beside it this time.
    await loadBoard(h, grown);
    await h.advance(1);
    const beforeGrown = await h.snapshot();
    const grownStep = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    return { beforeBare, bareStep, beforeGrown, grownStep };
  });

  const { beforeBare, bareStep, beforeGrown, grownStep } = driven;

  // Both readings are of a single step at chain step 1, where `M` is 1 — so the
  // difference between them is one gem's rate rather than one gem's rate times
  // something.
  assertEqual(bareStep.chainStep, 1, "the chain step the first swap opened");
  assertEqual(grownStep.chainStep, 1, "the chain step the second swap opened");

  const bareBanked = bareStep.score - beforeBare.score;
  const grownBanked = grownStep.score - beforeGrown.score;

  // The run of three was paid something. Without this the difference below could
  // be read off two steps that banked nothing at all.
  assertGreaterThan(bareBanked, 0, "the points the run of three banked");
  assertEqual(
    grownBanked - bareBanked,
    FLAWED_SCORE,
    `the flawed gem's own share of the step, which specs/rules.md prices at ` +
      `FLAWED_SCORE (${FLAWED_SCORE}) on a step whose multiplier is 1`,
  );
});
