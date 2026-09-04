// cargo/sell-values — a sale pays each unit its stated value.
//
// specs/mining.md prints a value in Credits for each of the ten ores and each of
// the three gemstones, and has `SELL` at the Ore Market convert the whole cargo
// "to Credits at the values above". A gemstone "behaves exactly like an ore once
// collected: it fills one cargo slot, carries its weight, and sells at the Ore
// Market", so it is priced from the same reading.
//
// The bay is posed as a known mix spanning the range of those tables — the
// cheapest mineral, two from the middle, and the dearest gemstone — and the
// Credits the sale pays are read against the sum of the printed values. The
// balance opens at `0`, so what the sale pays is the whole of what is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ORES, type Ore } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standAtBuilding,
  type Harness,
} from "../harness";

/** The bay posed: the cheapest mineral, two mid ones, and the dearest gemstone. */
const HAUL: Partial<Record<Ore, number>> = {
  ferron: 3,
  cuprite: 2,
  cobaltine: 1,
  aurite: 1,
};

/** What those units are worth, as specs/mining.md prices them. */
const VALUE = Object.entries(HAUL).reduce(
  (sum, [ore, count]) => sum + ORES[ore as Ore].value * (count as number),
  0,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pays the sum of the stated values of the units held", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtBuilding(h, "ore-market");
  await pinMiner(h);
  await pinDrill(h);
  await stageCargo(h, HAUL);
  await h.debug.setPanel("ore-market");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.credits, 0, "specs/gameplay.md");
  assertEqual(before.creditsEarned, 0, "specs/gameplay.md");

  await h.debug.sell();
  await h.advance(1);
  await captureStill(h, "credits");

  const after = await h.snapshot();
  assertEqual(after.credits, VALUE, "specs/mining.md");
  assertEqual(after.creditsEarned, VALUE, "specs/gameplay.md");
});
