// cargo/one-unit-one-slot — a unit of any mineral fills one slot.
//
// specs/mining.md: the cargo bay's capacity is a number of slots, and "one unit
// of any ore or gemstone fills one slot whatever its weight". Slots limit how
// much is picked up; weight limits whether the haul can be flown out. So the slot
// count is a count of units and never of kilograms.
//
// Every one of the ten ores and three gemstones is posed on its own, a single
// unit at a time, and each must read as one slot used against its own weight in
// kilograms. Then the lightest and the heaviest are held together: two slots
// against a load of `126` kilograms, which no reading of slots as weight
// reproduces.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ORES, ORE_IDS, type Ore } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";

/** The lightest mineral and the heaviest gemstone the tables carry. */
const LIGHTEST = ORE_IDS.reduce((a, b) =>
  ORES[a].weight <= ORES[b].weight ? a : b,
);
const HEAVIEST = ORE_IDS.reduce((a, b) =>
  ORES[a].weight >= ORES[b].weight ? a : b,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts one slot per unit, whatever the unit weighs", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);

  for (const ore of ORE_IDS) {
    await stageCargo(h, { [ore]: 1 } as Partial<Record<Ore, number>>);
    const { cargo } = await h.snapshot();
    assertEqual(cargo.slotsUsed, 1, `one unit of ${ore} (specs/mining.md)`);
    assertEqual(
      cargo.loadKg,
      ORES[ore].weight,
      `one unit of ${ore} (specs/mining.md)`,
    );
  }

  // The lightest and the heaviest together: two slots, and a load that is
  // plainly not the slot count.
  await stageCargo(h, { [LIGHTEST]: 1, [HEAVIEST]: 1 });
  await h.debug.setPanel("inventory");
  await h.advance(1);
  await captureStill(h, "slots");

  const { cargo } = await h.snapshot();
  assertEqual(cargo.slotsUsed, 2, "specs/mining.md");
  assertEqual(
    cargo.loadKg,
    ORES[LIGHTEST].weight + ORES[HEAVIEST].weight,
    "specs/mining.md",
  );
});
