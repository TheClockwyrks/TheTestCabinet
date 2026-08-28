// cascade/tier-ladder — the tier climbs on exactly the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": "The tier climbs one step every
// TIER_ADVANCE (4) boards solved: state.tier is
// min(floor(state.solvedCount / TIER_ADVANCE) + 1, MAX_TIER)", and "MAX_TIER is
// the top of the ladder and holds from the sixteenth board solved onward." The
// sweep solves twenty boards and reads the tier after each: after the k-th
// solve it must be tierForSolvedCount(k) — the spec's own formula from
// notation.ts — which climbs at solves 4, 8, 12 and 16 and holds at MAX_TIER
// (5) from the sixteenth on. The boards being solvable at all is
// boards-are-solvable's point; a sweep that did not solve fails here as an
// unmet precondition, named as such, because an unsolved board leaves no
// "after the solve" to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { tierForSolvedCount } from "../notation";
import {
  captureStill,
  createHarness,
  fireAction,
  solveGenerated,
  type Harness,
} from "../harness";

const SWEEP = 20;
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("after every solve, tier is min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER)", async () => {
  const sweep = await solveGenerated(h, SWEEP, SEED);

  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the sweep solved (see boards-are-solvable)`,
    );
    assertEqual(
      after.tier,
      tierForSolvedCount(index + 1),
      `after solve ${index + 1}: tier = min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER)`,
    );
  }

  // The evidence: the readout on a board of the held top tier, entered off the
  // twentieth solved screen.
  await fireAction(h, "confirm");
  await captureStill(h, "tier");
});
