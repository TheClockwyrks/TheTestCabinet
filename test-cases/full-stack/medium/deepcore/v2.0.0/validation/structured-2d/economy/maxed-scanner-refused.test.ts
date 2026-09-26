// economy/maxed-scanner-refused — tier 3 is the end of the scanner's track.
//
// `specs/upgrades.md` gives the scanner three tiers rather than the five the
// other six tracks carry, and says the shop disables a track that is maxed out.
// So a purchase attempted at tier 3 changes nothing: the tier does not rise and
// no Credits are taken. The balance is posed far above every price on the ladder,
// so a refusal here can only be the ceiling rather than the cost.
//
// WHY THE SCANNER IS ITS OWN CHECK. Three is the exception to the table's five,
// and a build that reads one ceiling for every track stops the scanner two rungs
// late while stopping the six long tracks correctly.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_TIER } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** More than any rung of the ladder, so nothing is refused for want of it. */
const CREDITS_BEFORE = 100000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a further purchase on the scanner at tier 3", async () => {
  openCamp(h);
  h.debug.setTier("scanner", MAX_TIER.scanner);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("scanner");
  await h.advance(1);
  captureStill(h, "maxed");

  const after = h.snapshot();
  assertEqual(
    after.tiers.scanner,
    MAX_TIER.scanner,
    "specs/upgrades.md: the scanner's tier does not rise past 3",
  );
  assertEqual(
    after.credits,
    CREDITS_BEFORE,
    "specs/upgrades.md: and nothing is taken for it",
  );
});
