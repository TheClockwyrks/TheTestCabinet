// pickups/draft-rate — a draft drops at DRAFT_CHANCE, on the kills that
// dropped no bread.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") tables
// "Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005`" and
// gives the roll its condition: "only when it dropped no bread it drops a
// draft with probability `DRAFT_CHANCE`." So a draft is rolled for on the
// 1 − `BREAD_CHANCE` share of kills that dropped no bread, and over
// `DROP_SAMPLE` (4000) kills the draft count is
// Binomial(4000, 0.98 × 0.005): mean 19.6, deviation 4.42.
// `DRAFT_COUNT_RANGE` is [3, 45], the bounds `constants.ts` places where each
// tail is below one in a hundred thousand, so a conformant build falls
// outside them at most that often while a build that never drops a draft reads
// 0 and one that rolls for a draft on every kill drifts high.
//
// THE WORLD. The sample of `pickups/sample.ts`: 4000 moths killed by
// posed Ember bolts, each on a point no other kill uses, with every driver
// switch off but `drops` and no weapon held, so nothing but a kill can leave
// a pickup. Nothing is posed for the roll itself, so each kill's roll is the
// build's own.
//
// WHAT IS READ. The number of drafts the sample left, inside [3, 45].
//
// TOLERANCE. The range is the tolerance, and it is a statistical one rather
// than a numeric one: it is stated in `constants.ts` beside the tail
// probability that makes it honest.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { BREAD_CHANCE, DRAFT_CHANCE, DRAFT_COUNT_RANGE } from "../constants";
import { createHarness, type Harness } from "../harness";
import { drawDrops } from "./sample";

/** (1 − BREAD_CHANCE) × DRAFT_CHANCE, the share of kills that drop a draft. */
const RATE = (1 - BREAD_CHANCE) * DRAFT_CHANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops between 3 and 45 drafts across 4000 common kills", async () => {
  const sample = await drawDrops(h, "rate");

  assertBetween(
    sample.counts.draft,
    DRAFT_COUNT_RANGE[0],
    DRAFT_COUNT_RANGE[1],
    `drafts over ${sample.kills} common kills, expected ${sample.kills * RATE}`,
  );
});
