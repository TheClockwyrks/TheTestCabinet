// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") tables
// "Probability a common kill drops bread | `BREAD_CHANCE` | `0.02`" and gives
// the roll: "The roll drops bread with probability `BREAD_CHANCE`." The roll
// is a probability, so it is read over a sample of the roll alone:
// `rollDrop(state)` "Makes one drop roll exactly as `specs/world.md` states
// under The drop roll and returns what it decided" (specs/instrumentation.md,
// "Drawn outcomes"). Over `DROP_ROLLS` (40000) rolls the bread count is
// Binomial(40000, 0.02): mean 800, deviation 28. `BREAD_COUNT_RANGE` is
// [632, 968], the bounds `constants.ts` places six deviations either side of
// the mean, so a conformant build falls outside them about once in a thousand
// million runs while a build that never rolls bread reads 0, one that rolls
// it at half the chance reads about 400, and one at twice it about 1600.
//
// THE WORLD. An isolated night, which the rolls leave as it is; the sample of
// `pickups/sample.ts` is 40000 calls of `rollDrop` over it, with nothing posed
// for the roll, so each roll is the build's own.
//
// WHAT IS READ. The number of rolls that decided bread, inside [632, 968].
//
// TOLERANCE. The range is the tolerance, and it is a statistical one rather
// than a numeric one: it is stated in `constants.ts` beside the deviation
// that makes it honest.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BREAD_CHANCE, BREAD_COUNT_RANGE, DROP_ROLLS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rolls between 632 and 968 breads across 40000 rolls", async () => {
  isolate(h);
  const sample = rollDrops(h);
  await h.tick(1);
  captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.bread,
    BREAD_COUNT_RANGE[0],
    BREAD_COUNT_RANGE[1],
    `breads over ${sample.rolls} rolls, expected ${sample.rolls * BREAD_CHANCE}`,
  );
});
