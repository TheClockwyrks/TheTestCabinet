// economy/upgrade-prices — the shop charges the ladder in specs/upgrades.md.
//
// One price ladder, `UPGRADE_PRICES`, serves all six five-tier tracks: 300, 750,
// 1900 and 4100 for the four steps. The scanner has two purchasable levels and
// takes the first two rungs of that same ladder, 300 then 750. Each step is
// bought from a balance large enough that none of them can be refused, and the
// deduction is read off the balance rather than inferred, so a build that
// charges the right total by the wrong steps still fails on the step it got
// wrong.
//
// `cargo` stands for the six long tracks. It is the one whose tier changes no
// figure this check reads: a fuel or hull tier would move the maxima and the
// values held with them, and a drill, jetpack, radiator or scanner tier moves a
// figure other points measure.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_TIER } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** More than the 8100 the two ladders cost together, so nothing is refused. */
const CREDITS_BEFORE = 20000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("charges UPGRADE_PRICES for each step of a five-tier track", async () => {
  openCamp(h);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("upgrade-shop");

  for (let tier = 2; tier <= MAX_TIER.cargo; tier += 1) {
    const before = h.snapshot();
    h.debug.buyUpgrade("cargo");
    const after = h.snapshot();
    assertEqual(after.tiers.cargo, tier, `specs/upgrades.md, cargo tier`);
    assertEqual(
      before.credits - after.credits,
      upgradePrice("cargo", tier),
      `specs/upgrades.md, cargo tier ${tier - 1} to ${tier}`,
    );
  }

  await h.advance(1);
  captureStill(h, "shop");
});

it("charges the ladder's first two rungs for the scanner's two levels", () => {
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
});
