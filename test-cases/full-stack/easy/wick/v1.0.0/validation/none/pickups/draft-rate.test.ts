// pickups/draft-rate — a draft drops at DRAFT_CHANCE, on the rolls that
// dropped no bread.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll"):
// "Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005`", and
// "only when it dropped no bread it drops a draft with probability
// `DRAFT_CHANCE`." The roll is a probability, so it is read over a sample of
// the roll alone: `rollDrop()` "Makes one drop roll exactly as `specs/world.md`
// states under The drop roll and returns what it decided"
// (specs/instrumentation.md, "Drawn outcomes"). A draft is rolled for on the
// `1 − BREAD_CHANCE` share of rolls that dropped no bread, so over `DROP_ROLLS`
// (`40000`) rolls the draft count is binomial with mean `196` and deviation
// `14`. `DRAFT_COUNT_RANGE` (`112` to `280`) is the band `constants.ts`
// computes from that distribution, six deviations either side of the mean, so
// a conformant build lands inside it and a build that never rolls a draft, or
// rolls at half or twice the stated chance, lands outside it every time.
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
import { DRAFT_COUNT_RANGE, DROP_ROLLS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rolls a draft count inside the six-deviation band over 40000 rolls", async () => {
  await isolate(h);
  const sample = await rollDrops(h);
  await captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.draft,
    DRAFT_COUNT_RANGE.min,
    DRAFT_COUNT_RANGE.max,
    `the drafts rolled over ${DROP_ROLLS} rolls, expected 196 at DRAFT_CHANCE after a failed bread roll`,
  );
});
