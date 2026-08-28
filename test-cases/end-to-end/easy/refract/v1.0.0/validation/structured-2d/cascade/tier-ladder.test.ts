// Refract — cascade/tier-ladder: the tier climbs on the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": the tier climbs one step every
// TIER_ADVANCE (4) boards solved — tier is
// min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) — and MAX_TIER (5)
// holds from the sixteenth board solved onward. The twenty-board sweep solves
// board after board, and the reading after each solve is the next board's
// arrival snapshot: a board arrives after exactly k solves, so its tier must
// be the formula's value at k, exactly. The twentieth solve's own reading is
// taken off the solved screen the sweep ends on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE, tierForSolvedCount } from "../notation";

const SEED = 1;
const BOARDS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes tier as min(floor(solvedCount / 4) + 1, 5) after every solve", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);

  for (let k = 0; k < solved.length; k += 1) {
    const { arrival } = solved[k];
    assertEqual(arrival.solvedCount, k, `solves counted at board ${k + 1}`);
    assertEqual(
      arrival.tier,
      tierForSolvedCount(k),
      `tier after ${k} solves: min(floor(${k} / ${TIER_ADVANCE}) + 1, ${MAX_TIER})`,
    );
  }

  const end = h.snapshot();
  assertEqual(end.solvedCount, BOARDS, "the twentieth solve is counted");
  assertEqual(
    end.tier,
    tierForSolvedCount(BOARDS),
    `tier after ${BOARDS} solves holds at MAX_TIER`,
  );

  // The tier read after each solve, shown where the player reads it: the
  // playing frame after the sweep, at the ladder's top.
  await tapAction(h, "confirm");
  captureStill(h, "tier");
});
