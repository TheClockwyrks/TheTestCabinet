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
import { MINERALS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  mineralOf,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standAtCamp,
  type Harness,
  type Ore,
} from "../harness";

/** Every mineral the tables carry: the ten ores and the three gemstones. */
const IDS: readonly Ore[] = MINERALS.map((mineral) => mineral.id);

/** The lightest mineral and the heaviest gemstone the tables carry. */
const LIGHTEST = IDS.reduce((a, b) =>
  mineralOf(a).weightKg <= mineralOf(b).weightKg ? a : b,
);
const HEAVIEST = IDS.reduce((a, b) =>
  mineralOf(a).weightKg >= mineralOf(b).weightKg ? a : b,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("counts one slot per unit, whatever the unit weighs", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);

  for (const ore of IDS) {
    stageCargo(h, { [ore]: 1 } as Partial<Record<Ore, number>>);
    const { cargo } = h.snapshot();
    assertEqual(cargo.slotsUsed, 1, `one unit of ${ore} (specs/mining.md)`);
    assertEqual(
      cargo.loadKg,
      mineralOf(ore).weightKg,
      `one unit of ${ore} (specs/mining.md)`,
    );
  }

  // The lightest and the heaviest together: two slots, and a load that is
  // plainly not the slot count.
  stageCargo(h, { [LIGHTEST]: 1, [HEAVIEST]: 1 });
  h.debug.setPanel("inventory");
  await h.advance(1);
  captureStill(h, "slots");

  const { cargo } = h.snapshot();
  assertEqual(cargo.slotsUsed, 2, "specs/mining.md");
  assertEqual(
    cargo.loadKg,
    mineralOf(LIGHTEST).weightKg + mineralOf(HEAVIEST).weightKg,
    "specs/mining.md",
  );
});
