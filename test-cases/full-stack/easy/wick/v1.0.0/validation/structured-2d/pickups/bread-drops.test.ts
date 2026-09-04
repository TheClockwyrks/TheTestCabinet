// Wick — pickups/bread-drops: bread drop over a seeded sweep of common kills.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll") tabulates
// both chances, "| Probability a common kill drops bread | `BREAD_CHANCE` |
// `0.02` |" and "| Probability a common kill drops a draft | `DRAFT_CHANCE` |
// `0.005` |", and both draws happen on a common's death. Over `DROP_TRIALS`
// (`4000`) kills the expected counts are `80` bread and `19.6` drafts, so a
// build that makes both draws leaves at least one of each with probability
// beyond any doubt (the chance of no draft at all is `0.995 ** 4000`, about
// `2e-9`), and a build that never drops one of the kinds leaves none of it.
// This is the presence of the two kinds; `pickups/bread-rate` and
// `pickups/draft-rate` read how often each arrives.
//
// WHY THE WORLD IS POSED AS IT IS. `pickups/roll` makes the sample: an isolated
// night, every driver switch off, and four thousand moths killed by their own
// level-1 Oil Splash puddles on a lattice `200` units apart, far enough from
// the lamplighter that nothing is attracted or collected, so every drop is
// still on the field when its tick's snapshot is read. The seed is fixed, so a
// build's answer here is the same on every run of the check. No chest can
// appear in the sample, because "Elites and the Dark make no draw" and every
// kill is a moth.
//
// THE TOLERANCE. None: a count is at least one or it is zero.
//
// The other kind is `pickups/drafts-drop`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { DEFAULT_SEED, DROP_TRIALS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { countOf, sampleDrops } from "./roll";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("drops at least one bread over 4000 seeded kills", async () => {
  const sample = await sampleDrops(h, DEFAULT_SEED, DROP_TRIALS);
  // The still is the last batch's own frame: the field its kills left.
  captureStill(h, "bread");

  assertEqual(sample.kills, DROP_TRIALS, "the common kills the sample made");
  assertGreaterThanOrEqual(
    countOf(sample.drops, "bread"),
    1,
    `the bread ${DROP_TRIALS} common kills dropped (specs/world.md, The drop roll)`,
  );
});
