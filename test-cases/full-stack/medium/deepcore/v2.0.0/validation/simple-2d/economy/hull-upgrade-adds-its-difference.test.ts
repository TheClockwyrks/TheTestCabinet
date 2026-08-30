// economy/hull-upgrade-adds-its-difference — a bigger hull is not a free repair.
//
// `specs/upgrades.md` puts the hull on the same rule as the fuel tank: the
// purchase raises the maximum and adds the same amount to the value held, so a
// 100 to 150 hull at 40 of 100 becomes 90 of 150. A build that repaired to full
// on the purchase would let a player buy hull tiers instead of paying
// `REPAIR_PRICE`, which is why both figures are read.

import { afterEach, beforeEach, it } from "vitest";
import { HULL_TIERS } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** The hull held when the tier is bought, well short of the tier-1 maximum. */
const HULL_BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises maxHull to the new tier and adds the same amount to the hull held", async () => {
  openCamp(h);
  h.debug.setHull(HULL_BEFORE);
  h.debug.setCredits(upgradePrice("hull", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("hull");
  await h.advance(1);
  captureStill(h, "hull");

  const after = h.snapshot();
  const added = HULL_TIERS[1] - HULL_TIERS[0];
  assertEqual(after.tiers.hull, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxHull, HULL_TIERS[1], 6, "specs/upgrades.md");
  assertCloseTo(
    after.miner.hull,
    HULL_BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a repair to full",
  );
});
