// pickups/draft-rate — drafts drop at DRAFT_CHANCE after a failed bread roll.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"):
// "Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005`", and
// "only when it dropped no bread it drops a draft with probability
// `DRAFT_CHANCE`." Over `DROP_ROLL_KILLS` (`4000`) kills the count is binomial
// with mean `4000 × 0.98 × 0.005 = 19.6`. `DRAFT_COUNT_RANGE` (`3` to `45`) is
// the interval `constants.ts` computes from that distribution: both tails
// outside it fall under one in a hundred thousand, so a conformant build lands
// inside it and a build that never rolls for a draft, or rolls at ten times the
// stated chance, lands outside it every time.
//
// WHY THE WORLD IS POSED AS IT IS. `sweepCommonKills` in `./stage` poses the
// sample, as `pickups/bread-rate` describes: an isolated night with `drops`
// alone, `DROP_ROLL_KILLS` real kills at distinct points far outside the radii
// that attract or collect, and nothing posed for the roll itself.
//
// THE TOLERANCE. The interval itself is the tolerance, and it is the
// specification's probability carried through the binomial rather than an
// allowance chosen by hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { DRAFT_COUNT_RANGE, DROP_ROLL_KILLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sweepCommonKills } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops a draft count inside the binomial interval over 4000 common kills", async () => {
  const sweep = await sweepCommonKills(h);
  await captureStill(h, "rate");

  assertEqual(sweep.kills, DROP_ROLL_KILLS, "the kills the sample made");
  assertBetween(
    sweep.counts.draft,
    DRAFT_COUNT_RANGE.min,
    DRAFT_COUNT_RANGE.max,
    `the drafts dropped over ${DROP_ROLL_KILLS} kills, expected 19.6 at DRAFT_CHANCE after a failed bread roll`,
  );
});
