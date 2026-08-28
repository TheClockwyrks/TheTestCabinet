// Refract — cascade/tier-ladder: the tier climbs on the ladder specified.
//
// specs/modes/cascade.md "The tier ladder": the tier climbs one step every
// TIER_ADVANCE (5) boards solved — tier is
// min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) — and holds at
// MAX_TIER (5) from the twentieth solve onward. The sweep really solves
// twenty-five boards and reads the tier back after every solve, holding it
// to the formula exactly; twenty-five solves cover every climb (5, 10, 15,
// 20) and five solves holding at the top. The still is the solved screen
// after the twentieth solve, the moment the ladder tops out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { tierForSolvedCount } from "../notation";
import { sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes the tier from the ladder formula after every solve", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onSolved: (snapshot, round) => {
      if (round === 20) captureStill(h, "tier");
      assertEqual(
        snapshot.tier,
        tierForSolvedCount(snapshot.solvedCount),
        `after solve ${round}: tier is ` +
          "min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER) for " +
          `solvedCount ${snapshot.solvedCount} (specs/modes/cascade.md)`,
      );
    },
  });
});
