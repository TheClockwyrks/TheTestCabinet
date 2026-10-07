// economy/maxed-scanner-refused — tier 3 is the end of the scanner's track.
//
// `specs/upgrades.md` gives six tracks five tiers and the scanner three, and says
// the shop disables a track that is maxed out. So a purchase attempted on a track
// already at its highest tier changes nothing: the tier does not rise past the
// table and no Credits are taken. The balance is posed far above every price on
// the ladder, so a refusal here can only be the ceiling rather than the cost.
//
// ONE CEILING PER SCRIPT. The five-tier ladder and the scanner's three are two
// figures in `specs/upgrades.md` and two edge cases, so a build that stops the
// long tracks at 5 and lets the scanner run past 3 must grade differently from
// one that gets both wrong.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_TIER } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** More than any rung of the ladder, so nothing is refused for want of it. */
const CREDITS_BEFORE = 100000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a further purchase on the scanner at tier 3", async () => {
  await openCamp(h);
  await h.debug.setTier("scanner", MAX_TIER.scanner);
  await h.debug.setCredits(CREDITS_BEFORE);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("scanner");
  await h.advance(1);
  await captureStill(h, "maxed");

  const after = await h.snapshot();
  assertEqual(after.tiers.scanner, MAX_TIER.scanner, "specs/upgrades.md");
  assertEqual(after.credits, CREDITS_BEFORE, "specs/upgrades.md");
});
