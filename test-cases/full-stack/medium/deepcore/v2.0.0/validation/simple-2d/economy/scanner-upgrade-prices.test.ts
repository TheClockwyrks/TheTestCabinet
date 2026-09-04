// economy/scanner-upgrade-prices — the scanner takes the ladder's first two rungs.
//
// `specs/upgrades.md` gives the scanner three tiers, so two purchasable levels,
// and charges them from the same `UPGRADE_PRICES` ladder the six five-tier tracks
// use: 300 for tier 2 and 750 for tier 3. Each step is bought from a balance large
// enough that neither can be refused, and the deduction is read off the balance
// rather than inferred, so a build that charges the right total by the wrong steps
// still fails on the step it got wrong.
//
// The scanner's shorter ladder is its own requirement: a build that charges the
// six long tracks correctly and starts the scanner at the ladder's third rung must
// fail here and pass `economy/upgrade-prices`.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_TIER } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** More than the 1050 the scanner's two rungs cost together. */
const CREDITS_BEFORE = 20000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("charges the ladder's first two rungs for the scanner's two levels", async () => {
  openCamp(h);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("upgrade-shop");

  for (let tier = 2; tier <= MAX_TIER.scanner; tier += 1) {
    const before = h.snapshot();
    h.debug.buyUpgrade("scanner");
    const after = h.snapshot();
    assertEqual(after.tiers.scanner, tier, `specs/upgrades.md, scanner tier`);
    assertEqual(
      before.credits - after.credits,
      upgradePrice("scanner", tier),
      `specs/upgrades.md, scanner tier ${tier - 1} to ${tier}`,
    );
  }

  await h.advance(1);
  captureStill(h, "scanner");
});
