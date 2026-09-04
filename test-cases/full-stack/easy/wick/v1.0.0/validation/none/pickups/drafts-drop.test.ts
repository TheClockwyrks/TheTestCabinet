// pickups/drafts-drop — drafts drops over a seeded sweep of common kills.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The drop roll") gives both
// kinds a non-zero probability: "Probability a common kill drops bread |
// `BREAD_CHANCE` | `0.02`" and "Probability a common kill drops a draft |
// `DRAFT_CHANCE` | `0.005`", drawn as "A first draw ... drops bread when it is
// below `BREAD_CHANCE`. Only when it did not, a second draw drops a draft when
// it is below `DRAFT_CHANCE`." Over `DROP_ROLL_KILLS` (`4000`) kills the
// expected counts are `80` breads and `4000 × 0.98 × 0.005 = 19.6` drafts, so a
// conformant build dropping none of either kind is beyond any tail worth
// naming: the reading here is the weakest one the rule supports, that each kind
// occurs at all, and it is the one a build that implemented only one of the two
// kinds fails. The counted rates are `pickups/bread-rate` and
// `pickups/draft-rate`.
//
// WHY THE WORLD IS POSED AS IT IS. `sweepCommonKills` in `./stage` poses the
// sample: an isolated night, every driver switch off and no slot held, so the
// only draws the ticks make are the kills' own; `DROP_ROLL_KILLS` real kills of
// a moth by a level-1 Ember bolt, each at its own point, every one far outside
// the radii that attract or collect, so nothing a kill drops is taken off the
// field before it is counted. The seed is `DEFAULT_SEED` (`1`), so the sample is
// the same one every time this runs.
//
// THE TOLERANCE. None: a kind occurred in the sample or it did not.
//
// The other kind is `pickups/bread-drops`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { DROP_ROLL_KILLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sweepCommonKills } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops at least one draft over 4000 seeded common kills", async () => {
  const sweep = await sweepCommonKills(h);
  await captureStill(h, "drafts");

  assertEqual(sweep.kills, DROP_ROLL_KILLS, "the kills the sample made");
  assertGreaterThanOrEqual(
    sweep.counts.draft,
    1,
    "the drafts dropped over the sample",
  );
});
