// pickups/bread-rate — bread drops at BREAD_CHANCE.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") tables
// "Probability a common kill drops bread | `BREAD_CHANCE` | `0.02`" and gives
// the draw: "A first draw, uniform on `[0, 1)`, drops bread when it is below
// `BREAD_CHANCE`." Every common kill makes that draw, so over `DROP_SAMPLE`
// (4000) kills the bread count is Binomial(4000, 0.02): mean 80, deviation
// 8.85. `BREAD_COUNT_RANGE` is [40, 125], the bounds `constants.ts` places
// where each tail is below one in a hundred thousand, so a conformant
// generator falls outside them at most that often while a build that never
// drops bread reads 0 and one that drops on every kill reads 4000.
//
// THE WORLD. The seeded sample of `pickups/sample.ts`: 4000 moths killed by
// posed Ember bolts, each on a point no other kill uses, with every driver
// switch off and no weapon held, so the drop roll is the only draw the
// generator is asked for and nothing but a kill can leave a pickup. The sample
// runs from one seed and one unbroken sequence of operations, so the count is
// the same on every run of this point against the same build.
//
// WHAT IS READ. The number of bread the sample left, inside [40, 125].
//
// TOLERANCE. The range is the tolerance, and it is a statistical one rather
// than a numeric one: it is stated in `constants.ts` beside the tail
// probability that makes it honest.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { BREAD_CHANCE, BREAD_COUNT_RANGE } from "../constants";
import { createHarness, type Harness } from "../harness";
import { drawDrops } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops between 40 and 125 bread across 4000 seeded kills", async () => {
  const sample = await drawDrops(h, "rate");

  assertBetween(
    sample.counts.bread,
    BREAD_COUNT_RANGE[0],
    BREAD_COUNT_RANGE[1],
    `bread over ${sample.kills} seeded common kills, expected ${sample.kills * BREAD_CHANCE}`,
  );
});
