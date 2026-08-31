// Facet — scoring/last-step-reported: `lastCleared` and `lastPoints` report the
// MOST RECENT chain step, and report what that step actually took off the board
// and what it actually banked.
//
// specs/instrumentation.md gives the two fields one sentence each — "cells
// cleared by the most recent chain step" and "points the most recent chain step
// scored" — and each carries a load-bearing word. "Most recent" is one: a field
// that accumulated across steps, or that reported the first step of a round
// forever after, would answer a single reading correctly and be useless. So the
// scenario drives TWO steps of different size and different worth, and requires
// both fields to be reporting the second one afterwards.
//
// "CLEARED" IS THE OTHER, AND IT IS THE ONE A SINGLE ISOLATED RUN CANNOT TEST.
// specs/rules.md builds a step's clear set in two moves: R5 SEEDS it with the
// maximal runs, and R6 GROWS the seed — by a `brilliant`'s ring, by a `star`'s
// row and column, and by "every flawed gem orthogonally adjacent to a cell in the
// set". Where a step's seed happens to be closed already the two are the same
// cells, and a field reporting the seed and a field reporting what was cleared
// are indistinguishable. So the two steps here are SEEDED IDENTICALLY and clear
// different sets: both boards carry the same ruby three and the same swap
// completes it, and the second board additionally carries one flawed gem beside
// that run, which R6 draws into the clear set and the step then removes and
// scores. The seed is three cells on both. A build reporting the size of the seed
// says three twice; a build reporting the cells the step cleared says three and
// then four.
//
// WHAT `lastPoints` IS READ AGAINST, AND WHY IT IS NOT A RATE. What a cleared
// gem pays is `scoring/score-base-rate`'s claim and `scoring/score-flawed-rate`'s,
// and this point decides neither of them a second time. The claim here is that
// the figure the build REPORTS for a step is the figure that step was worth, so
// `score` is read either side of each swap and `lastPoints` is required to equal
// the difference. A build that reports a stale figure, an accumulated one, the
// seed's worth, or the cell count in the points field fails here whatever its
// rates are; a build whose rates are wrong reports its own figure consistently
// and fails only where the rates are decided.
//
// Both steps run at chain step 1, so each is a single step's worth and the two
// readings are of one step each rather than of a chain.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { MATCH_MIN } from "../constants";
import {
  expandClearSet,
  maximalRuns,
  quietRowsWith,
  runSeed,
  swapped,
  type BoardRows,
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
 * The ruby three at strain 0 that the swap completes across row 4.
 *
 * Both boards carry it and both boards are swapped the same way, so both steps
 * are seeded with the same three cells and the two readings differ only by what
 * R6 adds.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/**
 * One flawed gem directly below the middle of that run: R6's third addition,
 * posed.
 *
 * It is orthogonally adjacent to a seeded cell, so R6 draws it into the clear set
 * and the step clears four cells from a seed of three. Its kind is `amber` rather
 * than the run's `ruby`, so it can join no run of its own and the seed stays the
 * three cells the swap completed — which {@link expectedStep} decides rather than
 * assumes.
 */
const FLAWED_CELL: PlacedToken = { col: 3, row: 5, token: "A3" };

/** Frames recorded after each step, so a replay shows the clear it reports. */
const AFTERMATH_FRAMES = 24; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * What one step over `posed` seeds and what it clears, by specs/rules.md over the
 * board the swap produces — the counts the build then has to report.
 *
 * `seeded` is R5's union of the maximal runs and `cleared` is that seed grown by
 * R6, so a scenario can state the relation it means to pose between the two. Both
 * are counts of cells the rules decide, carrying no scoring rate with them.
 *
 * It fails the FIXTURE if the arrangement is not the isolated single run the
 * scenario means it to be, so a scenario that drifted is reported as a scenario
 * fault rather than traveling into the build.
 */
function expectedStep(
  posed: BoardRows,
  a: CellRef,
  b: CellRef,
): { seeded: number; cleared: number } {
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  const resolved = swapped(posed, a, b);
  assertEqual(
    maximalRuns(resolved).length,
    1,
    "maximal runs the swap produces",
  );
  const seed = runSeed(resolved);
  const cells = expandClearSet(resolved, seed);
  return { seeded: seed.length, cleared: cells.length };
}

it("reports the cells and the points of the most recent chain step", async () => {
  const bare = quietRowsWith(RUN_CELLS);
  const grown = quietRowsWith([...RUN_CELLS, FLAWED_CELL]);
  const first = expectedStep(bare, SWAP_A, SWAP_B);
  const second = expectedStep(grown, SWAP_A, SWAP_B);

  // The first step's clear set is its seed, and the second step's is that same
  // seed with R6's addition in it. A reading of the seed cannot answer for both.
  assertEqual(first.seeded, MATCH_MIN, "cells R5 seeds the first step with");
  assertEqual(
    second.seeded,
    first.seeded,
    "cells R5 seeds the second step with",
  );
  assertEqual(first.cleared, first.seeded, "cells the first step clears");
  assertNotEqual(second.cleared, second.seeded, "cells the second step clears");

  // And the two steps have to clear different numbers of cells, or the second
  // reading could not tell a build that moved the field on from one that left it
  // holding the first step's answer.
  assertNotEqual(second.cleared, first.cleared, "cells the second step clears");

  const drive = await captureReplay(h, "report", async () => {
    await loadBoard(h, bare);
    // One frame of the board as it stands, so the replay opens on the run the
    // first swap is about to complete.
    await h.advance(1);
    // The standing score, read on the settled board the swap is about to be made
    // on. What the step is worth is what it moves this figure by.
    const beforeFirst = await h.snapshot();
    const opening = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    // A fresh board, which leaves both fields holding the first step's figures
    // until the second step overwrites them.
    await loadBoard(h, grown);
    await h.advance(1);
    const beforeSecond = await h.snapshot();
    const later = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    return { beforeFirst, opening, beforeSecond, later };
  });

  const { beforeFirst, opening, beforeSecond, later } = drive;

  assertEqual(opening.chainStep, 1, "the chain step the first swap opened");
  assertEqual(
    opening.lastCleared,
    first.cleared,
    "the cells the first step removed",
  );
  assertEqual(
    opening.lastPoints,
    opening.score - beforeFirst.score,
    "the points the first step reported, against what it added to the score",
  );

  assertEqual(later.chainStep, 1, "the chain step the second swap opened");
  assertEqual(
    later.lastCleared,
    second.cleared,
    "the cells the second step removed, which the fields must now report",
  );
  assertEqual(
    later.lastPoints,
    later.score - beforeSecond.score,
    "the points the second step reported, against what it added to the score",
  );
});
