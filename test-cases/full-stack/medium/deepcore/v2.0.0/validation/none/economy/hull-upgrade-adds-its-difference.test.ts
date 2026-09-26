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
import { assertCloseTo, assertEqual } from "../assert";
import { HULL_MAX, UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The hull held when the tier is bought, well short of the tier-1 maximum. */
const BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds the tier's difference to the hull held", async () => {
  await openCamp(h);
  await h.debug.setHull(BEFORE);
  await h.debug.setCredits(UPGRADE_PRICES[2]);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("hull");
  await h.advance(1);
  await captureStill(h, "hull");

  const after = await h.snapshot();
  const added = HULL_MAX[1] - HULL_MAX[0];
  assertEqual(after.tiers.hull, 2, "specs/upgrades.md");
  assertCloseTo(
    after.miner.hull,
    BEFORE + added,
    6,
    "specs/upgrades.md, the difference added rather than a repair to full",
  );
});
