// economy/hull-upgrade-adds-its-difference — a bigger hull is not a repair to full.
//
// `specs/upgrades.md`: "A bigger fuel tank or hull raises the maximum and adds
// the same amount to the current value, so a 100 to 175 tank at 30/100 fuel
// becomes 105/175. It is not a refill: the rest is still bought at the Fuel
// Depot."
//
// THE CEILING AND WHAT IS HELD ARE TWO POINTS. This one decides that the hull
// held rises by exactly the difference between the two tiers — the failure it
// separates is a purchase that tops the hull up to the new maximum instead —
// and `economy/hull-upgrade-raises-the-maximum` decides the ceiling itself.

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

it("adds the tier's difference to the hull held", async () => {
  openCamp(h);
  h.debug.setHull(BEFORE);
  h.debug.setCredits(upgradePrice("hull", 2) ?? 0);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("hull");
  await h.advance(1);
  captureStill(h, "hull");

  const after = h.snapshot();
  const added = HULL_TIERS[1] - HULL_TIERS[0];
  assertEqual(after.tiers.hull, 2, "specs/upgrades.md");
  assertCloseTo(
    after.miner.hull,
    BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a repair to full",
  );
});
