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

it("adds the tier's difference to the fuel held", async () => {
  openCamp(h);
  h.debug.setFuel(BEFORE);
  h.debug.setCredits(upgradePrice("fuel", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("fuel");
  await h.advance(1);
  captureStill(h, "tank");

  const after = h.snapshot();
  const added = FUEL_TIERS[1] - FUEL_TIERS[0];
  assertEqual(after.tiers.fuel, 2, "specs/upgrades.md");
  assertCloseTo(
    after.miner.fuel,
    BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a refill",
  );
});
