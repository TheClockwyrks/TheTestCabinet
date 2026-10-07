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
import { FUEL_TIERS } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** The fuel held when the tier is bought, well short of the tier-1 maximum. */
const BEFORE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises maxFuel to the new tier", async () => {
  openCamp(h);
  h.debug.setFuel(BEFORE);
  h.debug.setCredits(upgradePrice("fuel", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("fuel");
  await h.advance(1);
  captureStill(h, "tank");

  const after = h.snapshot();
  assertEqual(after.tiers.fuel, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxFuel, FUEL_TIERS[1], 6, "specs/upgrades.md");
});
