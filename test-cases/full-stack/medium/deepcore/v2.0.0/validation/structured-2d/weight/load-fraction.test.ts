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
import { JETPACK_TIERS, MAX_TIER } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  loadFraction,
  mineralOf,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  stageTiers,
  standAtCamp,
  type Harness,
  type Ore,
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
  (sum, [ore, count]) =>
    sum + mineralOf(ore as Ore).weightKg * (count as number),
  0,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the load as the weight of the units held, over the tier's lift", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);
  stageTiers(h, { jetpack: TIER });
  stageCargo(h, HAUL);
  h.debug.setPanel("inventory");
  await h.advance(1);
  captureStill(h, "load");

  const { cargo } = h.snapshot();
  assertEqual(cargo.loadKg, LOAD_KG, "specs/mining.md");
  assertEqual(cargo.slotsUsed, 6, "specs/mining.md");
  assertEqual(
    cargo.liftLimitKg,
    JETPACK_TIERS[TIER - 1].liftLimitKg,
    "specs/upgrades.md",
  );
  assertEqual(
    loadFraction(h.snapshot()),
    LOAD_KG / JETPACK_TIERS[TIER - 1].liftLimitKg,
    "specs/character.md",
  );

  // And the lift limit follows the tier across the whole track.
  for (let tier = 1; tier <= MAX_TIER.jetpack; tier += 1) {
    stageTiers(h, { jetpack: tier });
    assertEqual(
      h.snapshot().cargo.liftLimitKg,
      JETPACK_TIERS[tier - 1].liftLimitKg,
      `jetpack tier ${tier} (specs/upgrades.md)`,
    );
  }
});
