// economy/hull-upgrade-raises-the-maximum — the tier moves the ceiling.
//
// `specs/upgrades.md`: "A bigger fuel tank or hull raises the maximum and adds
// the same amount to the current value, so a 100 to 175 tank at 30/100 fuel
// becomes 105/175. It is not a refill: the rest is still bought at the Fuel
// Depot."
//
// THE CEILING AND WHAT IS HELD ARE TWO POINTS. This one decides that a purchased
// tier really does move `maxHull` onto the tier's own figure, and
// `economy/hull-upgrade-adds-its-difference` decides that the amount held rises
// by the same difference — so a build that raises the ceiling and leaves the
// hull where it stood grades differently from one that does neither.

import { afterEach, beforeEach, it } from "vitest";
import { HULL_TIERS } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** The hull held when the tier is bought, well short of the tier-1 maximum. */
const BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises maxHull to the new tier", async () => {
  openCamp(h);
  h.debug.setHull(BEFORE);
  h.debug.setCredits(upgradePrice("hull", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("hull");
  await h.advance(1);
  captureStill(h, "hull");

  const after = h.snapshot();
  assertEqual(after.tiers.hull, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxHull, HULL_TIERS[1], 6, "specs/upgrades.md");
});
