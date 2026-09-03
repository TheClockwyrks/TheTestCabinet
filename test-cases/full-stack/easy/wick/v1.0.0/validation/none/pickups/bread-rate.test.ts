// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"):
// "Probability a common kill drops bread | `BREAD_CHANCE` | `0.02`", drawn as
// "A first draw, uniform on `[0, 1)`, drops bread when it is below
// `BREAD_CHANCE`." Every common kill makes that draw, so over `DROP_ROLL_KILLS`
// (`4000`) kills the count is binomial with mean `80`. `BREAD_COUNT_RANGE`
// (`40` to `125`) is the interval `constants.ts` computes from that
// distribution: both tails outside it fall under one in a hundred thousand, so a
// conformant build lands inside it and a build that never rolls, or rolls at
// half or twice the stated chance, lands outside it every time.
//
// WHY THE WORLD IS POSED AS IT IS. `sweepCommonKills` in `./stage` poses the
// sample: an isolated night, every driver switch off and no slot held, so
// `spawning` and `events` bring nothing in, no weapon of the lamplighter's own
// draws, and the only draws the ticks make are the kills' own;
// `DROP_ROLL_KILLS` real kills of a moth by a level-1 Ember bolt, each at its
// own point, every one far outside the radii that attract or collect, so nothing
// a kill drops is taken off the field before it is counted. The seed is
// `DEFAULT_SEED` (`1`), so the sample is the same one every time this runs and
// the reading is deterministic rather than flaky.
//
// THE TOLERANCE. The interval itself is the tolerance, and it is the
// specification's probability carried through the binomial rather than an
// allowance chosen by hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BREAD_COUNT_RANGE, DROP_ROLL_KILLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sweepCommonKills } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops a bread count inside the binomial interval over 4000 seeded common kills", async () => {
  const sweep = await sweepCommonKills(h);
  await captureStill(h, "rate");

  assertEqual(sweep.kills, DROP_ROLL_KILLS, "the kills the sample made");
  assertBetween(
    sweep.counts.bread,
    BREAD_COUNT_RANGE.min,
    BREAD_COUNT_RANGE.max,
    `the breads dropped over ${DROP_ROLL_KILLS} kills, expected 80 at BREAD_CHANCE`,
  );
});
