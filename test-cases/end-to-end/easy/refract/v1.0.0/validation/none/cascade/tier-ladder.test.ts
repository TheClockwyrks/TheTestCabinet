// cascade/tier-ladder — the tier climbs on exactly the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": "The tier climbs one step every
// TIER_ADVANCE (5) boards solved: state.tier is
// min(floor(state.solvedCount / TIER_ADVANCE) + 1, MAX_TIER)", and "MAX_TIER is
// the top of the ladder and holds from the twentieth board solved onward." The
// run is posed at every count from 0 to 24 through `setSolvedCount` and
// `setTier` (specs/instrumentation.md), a posed board is solved at each, and
// the tier after the solve must be tierForSolvedCount(count + 1) — the spec's
// own formula from notation.ts — which climbs at solves 5, 10, 15 and 20 and
// holds at MAX_TIER (5) from the twentieth on. The run is posed at the tier the
// formula gives its count, so a build that never recomputes the tier fails at
// the first climb.
//
// The board solved at each count is the minimal board, posed through
// `loadBoard`: "a board posed this way is a board like any other"
// (specs/instrumentation.md), so the solve counts and the tier is recomputed
// exactly as for a generated one. That a solve counts at all is
// cascade-solved-copy's point, named here as a precondition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_TIER, TIER_ADVANCE, tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  fireAction,
  poseCascadeRun,
  solvePosedBoard,
  type Harness,
} from "../harness";

/** The last count posed: one short of the twenty-fifth solve. */
const LAST_COUNT = TIER_ADVANCE * MAX_TIER - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("after a solve at every count, tier is min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER)", async () => {
  for (let count = 0; count <= LAST_COUNT; count += 1) {
    await poseCascadeRun(h, count);
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
      `after solve ${count + 1}: tier = min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER)`,
    );
  }

  // The evidence: the readout on a board of the held top tier, entered off the
  // twenty-fifth solved screen.
  await fireAction(h, "confirm");
  await captureStill(h, "tier");
});
