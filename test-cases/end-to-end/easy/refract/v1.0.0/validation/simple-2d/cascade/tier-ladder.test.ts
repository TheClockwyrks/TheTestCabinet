// Refract — cascade/tier-ladder: the tier climbs on the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": the tier climbs one step every
// TIER_ADVANCE (5) boards solved — tier is
// min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) — and holds at
// MAX_TIER (5) from the twentieth solve onward. The run is posed at every
// count from 0 to 24 through `setSolvedCount` and `setTier`
// (specs/instrumentation.md), a posed board is solved at each, and the tier
// read back after the solve is held to the formula exactly; the twenty-five
// counts cover every climb (5, 10, 15, 20) and five solves holding at the top.
// The run is posed at the tier the formula gives its count, so a build that
// never recomputes the tier fails at the first climb.
//
// The board solved at each count is the minimal board, posed through
// `loadBoard`: "a board posed this way is a board like any other"
// (specs/instrumentation.md), so the solve counts and the tier is recomputed
// exactly as for a generated one. That a solve counts at all is
// cascade-solved-copy's point, named here as a precondition. The still is the
// solved screen after the twentieth solve, the moment the ladder tops out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE, tierForSolvedCount } from "../notation";

/** The last count posed: one short of the twenty-fifth solve. */
const LAST_COUNT = TIER_ADVANCE * MAX_TIER - 1;
/** The solve the ladder tops out on. */
const TOP_SOLVE = TIER_ADVANCE * (MAX_TIER - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes the tier from the ladder formula after a solve at every count", async () => {
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
      `precondition: the solve at count ${count} is counted ` +
        "(see cascade-solved-copy)",
    );
    assertEqual(
      after.tier,
      tierForSolvedCount(count + 1),
      `after solve ${count + 1}: tier is ` +
        "min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) for " +
        `solvedCount ${count + 1} (specs/modes/cascade.md)`,
    );
    if (count + 1 === TOP_SOLVE) {
      await h.advance(1);
      captureStill(h, "tier");
    }
  }
});
