// Refract — cascade/tier-ladder: the tier climbs on the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": the tier climbs one step every
// TIER_ADVANCE (5) boards solved — tier is
// min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) — and MAX_TIER (5)
// holds from the twentieth board solved onward. The run is posed at every
// count from 0 to 24 through `setSolvedCount` and `setTier`
// (specs/instrumentation.md), a posed board is solved at each, and the tier
// read back after the solve must be the formula's value at count + 1,
// exactly. The run is posed at the tier the formula gives its count, so a
// build that never recomputes the tier fails at the first climb.
//
// The board solved at each count is the minimal board, posed through
// `loadBoard`: "a board posed this way is a board like any other"
// (specs/instrumentation.md), so the solve counts and the tier is recomputed
// exactly as for a generated one. That a solve counts at all is
// cascade-solved-copy's point, named here as a precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  tapAction,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE, tierForSolvedCount } from "../notation";

/** The last count posed: one short of the twenty-fifth solve. */
const LAST_COUNT = TIER_ADVANCE * MAX_TIER - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes tier as min(floor(solvedCount / 5) + 1, 5) after a solve at every count", async () => {
  await resetTo(h);

  for (let count = 0; count <= LAST_COUNT; count += 1) {
    poseCascadeRun(h, count);
    const after = await solvePosedBoard(h);
    assertEqual(
      after.solved,
      true,
      `precondition: the board posed at count ${count} solves`,
    );
    assertEqual(
      after.solvedCount,
      count + 1,
      `precondition: the solve at count ${count} is counted (see cascade-solved-copy)`,
    );
    assertEqual(
      after.tier,
      tierForSolvedCount(count + 1),
      `tier after ${count + 1} solves: min(floor(${count + 1} / ${TIER_ADVANCE}) + 1, ${MAX_TIER})`,
    );
  }

  // The tier read after each solve, shown where the player reads it: the
  // playing frame after the last solve, at the ladder's top.
  await h.advance(1);
  await tapAction(h, "confirm");
  captureStill(h, "tier");
});
