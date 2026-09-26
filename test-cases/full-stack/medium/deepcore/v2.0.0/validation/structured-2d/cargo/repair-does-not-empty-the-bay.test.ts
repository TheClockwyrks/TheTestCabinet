// cargo/repair-does-not-empty-the-bay — buying hull repair leaves the cargo alone.
//
// specs/mining.md: "the bay is emptied by selling. Refueling and repairing do not
// empty it." specs/expedition.md keeps the two apart the same way: the Ore Market
// is the one source of Credits and the one place the bay is emptied, while the
// Fuel Depot is a sink that buys fuel and hull repair.
//
// TWO TRANSACTIONS, TWO POINTS. Buying fuel and buying repair are separate
// purchases at separate controls, so a build whose refuel keeps the haul and
// whose repair throws it away must grade differently from one that throws it away
// either way. The other half is `cargo/refuel-does-not-empty-the-bay`.
//
// So the miner arrives at the Fuel Depot with a haul and a damaged hull, and the
// panel's two repair controls are run: the fixed increment and the fill to full.
// The reading is the bay afterwards, unchanged down to the kilogram — and, so the
// check is not passing on a depot that did nothing, that the hull really did rise
// and the balance really did fall.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  mineralOf,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standAtBuilding,
  type Harness,
  type Ore,
} from "../harness";

/** The bay posed: a haul worth carrying through a stop at the depot. */
const HAUL: Partial<Record<Ore, number>> = { cobaltine: 4, halcite: 2 };

/** The weight that haul carries, as specs/mining.md weighs it. */
const LOAD_KG = Object.entries(HAUL).reduce(
  (sum, [ore, count]) =>
    sum + mineralOf(ore as Ore).weightKg * (count as number),
  0,
);

/** What the climb is posed as having left, and the balance to spend. */
const FUEL_LEFT = 50;
const HULL_LEFT = 50;
const CREDITS = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the bay exactly as it was through a repair stop", async () => {
  openScene(h);
  layCamp(h);
  standAtBuilding(h, "fuel-depot");
  pinMiner(h);
  pinDrill(h);
  stageCargo(h, HAUL);
  h.debug.setCredits(CREDITS);
  h.debug.setFuel(FUEL_LEFT);
  h.debug.setHull(HULL_LEFT);
  h.debug.setPanel("fuel-depot");
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.cargo.slotsUsed, 6, "specs/mining.md");
  assertEqual(before.cargo.loadKg, LOAD_KG, "specs/mining.md");

  h.debug.buyRepair();
  h.debug.repairFull();
  await h.advance(1);
  captureStill(h, "bay");

  const after = h.snapshot();
  // The depot did its work, so the bay below survived a stop rather than a no-op.
  assertGreaterThan(after.miner.hull, before.miner.hull, "specs/expedition.md");
  assertLessThan(after.credits, CREDITS, "specs/expedition.md");

  // And the bay is untouched.
  assertEqual(after.cargo.slotsUsed, before.cargo.slotsUsed, "specs/mining.md");
  assertEqual(after.cargo.loadKg, LOAD_KG, "specs/mining.md");
  for (const [ore, count] of Object.entries(HAUL)) {
    assertEqual(after.cargo.ore[ore as Ore], count, `${ore} (specs/mining.md)`);
  }
  assertEqual(after.creditsEarned, 0, "specs/expedition.md");
});
