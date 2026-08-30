// economy/hull-upgrade-adds-its-difference — a bigger hull is not a free repair.
//
// `specs/upgrades.md` puts the hull on the same rule as the fuel tank: the
// purchase raises the maximum and adds the same amount to the value held, so a
// 100 to 150 hull at 40 of 100 becomes 90 of 150. A build that repaired to full
// on the purchase would let a player buy hull tiers instead of paying
// `REPAIR_PRICE`, which is why both figures are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { HULL_MAX, UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The hull held when the tier is bought, well short of the tier-1 maximum. */
const HULL_BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises maxHull to the new tier and adds the same amount to the hull held", async () => {
  await openCamp(h);
  await h.debug.setHull(HULL_BEFORE);
  await h.debug.setCredits(UPGRADE_PRICES[2]);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("hull");
  await h.advance(1);
  await captureStill(h, "hull");

  const after = await h.snapshot();
  const added = HULL_MAX[1] - HULL_MAX[0];
  assertEqual(after.tiers.hull, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxHull, HULL_MAX[1], 6, "specs/upgrades.md");
  assertCloseTo(
    after.miner.hull,
    HULL_BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a repair to full",
  );
});
