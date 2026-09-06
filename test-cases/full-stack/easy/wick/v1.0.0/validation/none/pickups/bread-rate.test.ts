// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"):
// "Probability a common kill drops bread | `BREAD_CHANCE` | `0.02`", and "The
// roll drops bread with probability `BREAD_CHANCE`." The roll is a
// probability, so it is read over a sample of the roll alone: `rollDrop()`
// "Makes one drop roll exactly as `specs/world.md` states under The drop roll
// and returns what it decided" (specs/instrumentation.md, "Drawn outcomes").
// Over `DROP_ROLLS` (`40000`) rolls the bread count is binomial with mean
// `800` and deviation `28`. `BREAD_COUNT_RANGE` (`632` to `968`) is the band
// `constants.ts` computes from that distribution, six deviations either side
// of the mean, so a conformant build lands inside it and a build that never
// rolls, or rolls at half or twice the stated chance, lands outside it every
// time.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so the picture is the
// run the rolls were made on; the rolls themselves touch nothing on it.
// Nothing is posed for the roll, so each roll is the build's own.
//
// THE TOLERANCE. The band itself is the tolerance, and it is the
// specification's probability carried through the binomial rather than an
// allowance chosen by hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BREAD_COUNT_RANGE, DROP_ROLLS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rolls a bread count inside the six-deviation band over 40000 rolls", async () => {
  await isolate(h);
  const sample = await rollDrops(h);
  await captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.bread,
    BREAD_COUNT_RANGE.min,
    BREAD_COUNT_RANGE.max,
    `the breads rolled over ${DROP_ROLLS} rolls, expected 800 at BREAD_CHANCE`,
  );
});
