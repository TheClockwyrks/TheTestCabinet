// pickups/draft-rate — a draft drops at DRAFT_CHANCE, on the rolls that
// dropped no bread.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") tables
// "Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005`" and
// gives the roll its condition: "only when it dropped no bread it drops a
// draft with probability `DRAFT_CHANCE`." The roll is a probability, so it is
// read over a sample of the roll alone: `rollDrop(state)` "Makes one drop
// roll exactly as `specs/world.md` states under The drop roll and returns
// what it decided" (specs/instrumentation.md, "Drawn outcomes"). A draft is
// rolled for on the 1 − `BREAD_CHANCE` share of rolls that dropped no bread,
// and over `DROP_ROLLS` (40000) rolls the draft count is
// Binomial(40000, 0.98 × 0.005): mean 196, deviation 14. `DRAFT_COUNT_RANGE`
// is [112, 280], the bounds `constants.ts` places six deviations either side
// of the mean, so a conformant build falls outside them about once in a
// thousand million runs while a build that never rolls a draft reads 0, one
// that rolls it at half the chance reads about 98, and one at twice it about
// 392.
//
// THE WORLD. An isolated night, which the rolls leave as it is; the sample of
// `pickups/sample.ts` is 40000 calls of `rollDrop` over it, with nothing posed
// for the roll, so each roll is the build's own.
//
// WHAT IS READ. The number of rolls that decided a draft, inside [112, 280].
//
// TOLERANCE. The range is the tolerance, and it is a statistical one rather
// than a numeric one: it is stated in `constants.ts` beside the deviation
// that makes it honest.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  BREAD_CHANCE,
  DRAFT_CHANCE,
  DRAFT_COUNT_RANGE,
  DROP_ROLLS,
} from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "./sample";

/** (1 − BREAD_CHANCE) × DRAFT_CHANCE, the share of rolls that decide a draft. */
const RATE = (1 - BREAD_CHANCE) * DRAFT_CHANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rolls between 112 and 280 drafts across 40000 rolls", async () => {
  isolate(h);
  const sample = rollDrops(h);
  await h.tick(1);
  captureStill(h, "rate");

  assertEqual(sample.rolls, DROP_ROLLS, "the rolls the sample made");
  assertBetween(
    sample.counts.draft,
    DRAFT_COUNT_RANGE[0],
    DRAFT_COUNT_RANGE[1],
    `drafts over ${sample.rolls} rolls, expected ${sample.rolls * RATE}`,
  );
});
