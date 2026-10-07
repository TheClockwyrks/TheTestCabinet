// economy/maxed-scanner-refused — tier 3 is the end of the scanner's track.
//
// `specs/upgrades.md` gives the scanner three tiers where the other six tracks
// have five, and says the shop disables a track that is maxed out. So a purchase
// attempted on the scanner at tier 3 changes nothing: the tier does not rise past
// the table and no Credits are taken. The balance is posed far above every price
// on the ladder, so a refusal here can only be the ceiling rather than the cost.
//
// The scanner's shorter ladder is its own edge case: a build that stops the six
// long tracks at 5 but lets the scanner climb to 4 must fail here and pass
// `economy/maxed-track-refused`.

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
  assertEqual(after.tiers.scanner, MAX_TIER.scanner, "specs/upgrades.md");
  assertEqual(after.credits, CREDITS_BEFORE, "specs/upgrades.md");
});
