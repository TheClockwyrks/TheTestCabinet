// economy/tank-upgrade-adds-its-difference — a bigger tank is not a refill.
//
// `specs/upgrades.md` states the arithmetic exactly: "A bigger fuel tank or hull
// raises the maximum and adds the same amount to the current value, so a 100 to
// 175 tank at 30/100 fuel becomes 105/175. It is not a refill: the rest is still
// bought at the Fuel Depot." The two failures this separates are a purchase that
// tops the tank up to the new maximum and one that raises the maximum alone and
// leaves the fuel where it stood, so both figures are read.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_TIERS } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

/** The fuel held when the tier is bought, well short of the tier-1 maximum. */
const FUEL_BEFORE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises maxFuel to the new tier and adds the same amount to the fuel held", async () => {
  openCamp(h);
  h.debug.setFuel(FUEL_BEFORE);
  h.debug.setCredits(upgradePrice("fuel", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("fuel");
  await h.advance(1);
  captureStill(h, "tank");

  const after = h.snapshot();
  const added = FUEL_TIERS[1] - FUEL_TIERS[0];
  assertEqual(after.tiers.fuel, 2, "specs/upgrades.md");
  assertCloseTo(after.miner.maxFuel, FUEL_TIERS[1], 6, "specs/upgrades.md");
  assertCloseTo(
    after.miner.fuel,
    FUEL_BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a refill",
  );
});
