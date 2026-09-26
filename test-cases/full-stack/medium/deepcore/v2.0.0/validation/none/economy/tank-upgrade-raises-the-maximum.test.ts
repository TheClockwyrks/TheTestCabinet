// economy/tank-upgrade-raises-the-maximum — the tier moves the ceiling.
//
// `specs/upgrades.md`: "A bigger fuel tank or hull raises the maximum and adds
// the same amount to the current value, so a 100 to 175 tank at 30/100 fuel
// becomes 105/175. It is not a refill: the rest is still bought at the Fuel
// Depot."
//
// THE CEILING AND WHAT IS HELD ARE TWO POINTS. This one decides that a purchased
// tier really does move `maxFuel` onto the tier's own figure, and
// `economy/tank-upgrade-adds-its-difference` decides that the amount held rises
// by the same difference — so a build that raises the ceiling and leaves the
// fuel where it stood grades differently from one that does neither.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { FUEL_TANK_MAX, UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The fuel held when the tier is bought, well short of the tier-1 maximum. */
const BEFORE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises maxFuel to the new tier", async () => {
  await openCamp(h);
  await h.debug.setFuel(BEFORE);
  await h.debug.setCredits(UPGRADE_PRICES[2]);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("fuel");
  await h.advance(1);
  await captureStill(h, "tank");

  const after = await h.snapshot();
  assertEqual(after.tiers.fuel, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxFuel, FUEL_TANK_MAX[1], 6, "specs/upgrades.md");
});
