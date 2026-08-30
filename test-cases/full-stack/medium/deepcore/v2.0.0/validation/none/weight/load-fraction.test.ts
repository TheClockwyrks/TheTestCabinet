// weight/load-fraction — the load is the weight of what is held.
//
// specs/character.md: the load fraction is `load = loadKg / liftLimitKg`, where
// `loadKg` is the total weight in the cargo bay and `liftLimitKg` is the heaviest
// load the current jetpack tier can climb with. specs/mining.md fixes each ore's
// and each gemstone's weight in kilograms, and specs/upgrades.md the lift limit
// of each of the five jetpack tiers.
//
// So the bay is posed as a known mix drawn from all three of those tables — a
// light mineral, a mid one, and the heaviest gemstone — and `loadKg` is read
// against the sum of the weights the specification prints for them. `liftLimitKg`
// is then read at every jetpack tier, since it is the other half of the fraction
// and the one the tier sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { JETPACK_LIFT_LIMIT, MAX_TIER, ORES, type Ore } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  loadFraction,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";

/** The jetpack tier the fraction is read at. */
const TIER = 3;

/** The bay posed: a light mineral, a mid one, and the heaviest gemstone. */
const HAUL: Partial<Record<Ore, number>> = {
  ferron: 3,
  argenite: 2,
  aurite: 1,
};

/** The weight those units carry, as specs/mining.md prices them. */
const LOAD_KG = Object.entries(HAUL).reduce(
  (sum, [ore, count]) => sum + ORES[ore as Ore].weight * (count as number),
  0,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the load as the weight of the units held, over the tier's lift", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await stageTiers(h, { jetpack: TIER });
  await stageCargo(h, HAUL);
  await h.debug.setPanel("inventory");
  await h.advance(1);
  await captureStill(h, "load");

  const { cargo } = await h.snapshot();
  assertEqual(cargo.loadKg, LOAD_KG, "specs/mining.md");
  assertEqual(cargo.slotsUsed, 6, "specs/mining.md");
  assertEqual(
    cargo.liftLimitKg,
    JETPACK_LIFT_LIMIT[TIER - 1],
    "specs/upgrades.md",
  );
  assertEqual(
    loadFraction(await h.snapshot()),
    LOAD_KG / JETPACK_LIFT_LIMIT[TIER - 1],
    "specs/character.md",
  );

  // And the lift limit follows the tier across the whole track.
  for (let tier = 1; tier <= MAX_TIER.jetpack; tier += 1) {
    await stageTiers(h, { jetpack: tier });
    assertEqual(
      (await h.snapshot()).cargo.liftLimitKg,
      JETPACK_LIFT_LIMIT[tier - 1],
      `jetpack tier ${tier} (specs/upgrades.md)`,
    );
  }
});
