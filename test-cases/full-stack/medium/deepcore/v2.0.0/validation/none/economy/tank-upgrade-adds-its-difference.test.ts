// economy/tank-upgrade-adds-its-difference — a bigger tank is not a refill.
//
// `specs/upgrades.md`: "A bigger fuel tank or hull raises the maximum and adds
// the same amount to the current value, so a 100 to 175 tank at 30/100 fuel
// becomes 105/175. It is not a refill: the rest is still bought at the Fuel
// Depot."
//
// THE CEILING AND WHAT IS HELD ARE TWO POINTS. This one decides that the fuel
// held rises by exactly the difference between the two tiers — the failure it
// separates is a purchase that tops the fuel up to the new maximum instead —
// and `economy/tank-upgrade-raises-the-maximum` decides the ceiling itself.

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

it("adds the tier's difference to the fuel held", async () => {
  await openCamp(h);
  await h.debug.setFuel(BEFORE);
  await h.debug.setCredits(UPGRADE_PRICES[2]);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("fuel");
  await h.advance(1);
  await captureStill(h, "tank");

  const after = await h.snapshot();
  const added = FUEL_TANK_MAX[1] - FUEL_TANK_MAX[0];
  assertEqual(after.tiers.fuel, 2, "specs/upgrades.md");
  assertCloseTo(
    after.miner.fuel,
    BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a refill",
  );
});
