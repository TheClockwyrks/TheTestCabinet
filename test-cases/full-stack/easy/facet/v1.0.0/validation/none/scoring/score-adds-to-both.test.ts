// Facet — scoring/score-adds-to-both: a step's points land on `score` and on
// `levelScore`, both, and by the same amount.
//
// specs/rules.md states it in one sentence: "A step's points are the sum over its
// clear set, and they are added to both `score` and `levelScore`". The two
// figures answer different questions — `score` is the round's running total and
// carries across a level, `levelScore` is what is banked toward this level's
// target and returns to 0 when the level turns over — so a build can easily keep
// one and forget the other, or bank the level score and forget the total.
//
// WHAT MAKES THE TWO SEPARABLE. They are posed APART before the step: `score` at
// 500 and `levelScore` at 100, figures no arithmetic relates. A build that keeps
// one figure and reports it twice, or that assigns the step's points rather than
// adding them, moves the two by different amounts and fails.
//
// WHAT THE STEP IS WORTH IS NOT DECIDED HERE. That is `scoring/score-base-rate`'s
// claim and `scoring/score-flawed-rate`'s, and this point never names a rate: it
// reads both standings before the step and both after, and requires the two
// figures to have moved by the SAME amount — an amount only the build's own step
// supplies. A build that priced the clear set wrongly and banked its own figure
// on both moves them alike and passes here, owing the point that owns the rate.
// A step that banked nothing at all would satisfy any equality between two
// unmoved figures, so the reading requires the score to have moved.
//
// The level must not turn over while the reading is taken: specs/rules.md returns
// `levelScore` to 0 when it does, and the figure the step added to would be gone
// before it could be read. The level score is posed far below the target the
// round reports and the step is a plain three, and the level is read after the
// step to show it did not turn over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  clearSetFromRuns,
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
  swap,
  type Harness,
} from "../harness";

/** A ruby three at strain 0 that the swap completes across row 4. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];

/** The swap that drops the waiting ruby into the gap. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/**
 * The two standings the step is added to, chosen so that neither can stand in for
 * the other: they differ, neither is zero, and neither is reachable from the
 * other by a small step's points.
 */
const SCORE_BEFORE = 500;
const LEVEL_SCORE_BEFORE = 100;

/** Frames recorded after the step, so the replay shows both readouts move. */
const AFTERMATH_FRAMES = 24; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds a step's points to both score and levelScore", async () => {
  const posed = quietRowsWith(RUN_CELLS);
  const resolved = swapped(posed, SWAP_A, SWAP_B);
  const cleared = clearSetFromRuns(resolved);

  // The fixture. The posed board carries no run of its own, the swap produces
  // exactly one, and nothing in R6 grows it — so the step under test is one small
  // clear rather than whatever a cascade happened to do.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertEqual(maximalRuns(resolved).length, 1, "maximal runs the swap produces");
  assertEqual(cleared.length, 3, "cells the step clears");

  await loadBoard(h, posed);
  await h.debug.setScore(SCORE_BEFORE);
  await h.debug.setLevelScore(LEVEL_SCORE_BEFORE);

  const before = await h.snapshot();
  assertEqual(before.score, SCORE_BEFORE, "the score the step is added to");
  assertEqual(
    before.levelScore,
    LEVEL_SCORE_BEFORE,
    "the level score the step is added to",
  );
  // The standing the step is added to is short of the target the round is playing
  // to, so a small clear cannot complete the level under the reading.
  assertLessThan(
    before.levelScore,
    before.levelTarget,
    "the level score the step is added to, against the target the round reports",
  );

  const first = await captureReplay(h, "score", async () => {
    // One frame of the two standings before the step, so the replay shows both
    // readouts moving rather than only where they ended.
    await h.advance(1);
    const step = await swap(h, SWAP_A, SWAP_B);
    await h.advance(AFTERMATH_FRAMES);
    return step;
  });

  assertEqual(first.chainStep, 1, "the chain step the accepted swap opened");
  // And the level did not turn over on the step, so `levelScore` is still the
  // figure the step was added to rather than a level's fresh 0.
  assertEqual(
    first.level,
    before.level,
    "the level the step left, which the reading needs unchanged",
  );

  const banked = first.score - before.score;
  // The step banked something. Two figures that never moved would satisfy any
  // equality between them.
  assertGreaterThan(banked, 0, "the points the step added to the score");
  assertEqual(
    first.levelScore - before.levelScore,
    banked,
    `what the step added to the level score standing at ${LEVEL_SCORE_BEFORE}, ` +
      `against the ${banked} it added to the score standing at ${SCORE_BEFORE}`,
  );
});
