// economy/scanner-upgrade-prices — the scanner charges the ladder's first two rungs.
//
// One price ladder, `UPGRADE_PRICES`, serves all six five-tier tracks: 300, 750,
// 1900 and 4100 for the four steps. The scanner has two purchasable levels and
// takes the first two rungs of that same ladder, 300 then 750. This is the scanner's pair. Each step
// is bought from a balance large enough that none of them can be refused, and the
// deduction is read off the balance rather than inferred, so a build that charges
// the right total by the wrong steps still fails on the step it got wrong.
//
// ONE LADDER PER SCRIPT. The four-step ladder and the scanner's two rungs are two
// statements in `specs/upgrades.md`, so a build that charges the long tracks
// correctly and the scanner wrongly must grade differently from one that gets
// both wrong.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_TIER, UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** More than the whole ladder costs, so nothing is refused for want of it. */
const CREDITS_BEFORE = 20000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("charges the ladder's first two rungs for the scanner's two levels", async () => {
  await openCamp(h);
  await h.debug.setCredits(CREDITS_BEFORE);
  await h.debug.setPanel("upgrade-shop");

  for (let tier = 2; tier <= MAX_TIER.scanner; tier += 1) {
    const before = await h.snapshot();
    await h.debug.buyUpgrade("scanner");
    const after = await h.snapshot();
    assertEqual(after.tiers.scanner, tier, `specs/upgrades.md, scanner tier`);
    assertEqual(
      before.credits - after.credits,
      UPGRADE_PRICES[tier],
      `specs/upgrades.md, scanner tier ${tier - 1} to ${tier}`,
    );
  }

  await h.advance(1);
  await captureStill(h, "scanner");
});
