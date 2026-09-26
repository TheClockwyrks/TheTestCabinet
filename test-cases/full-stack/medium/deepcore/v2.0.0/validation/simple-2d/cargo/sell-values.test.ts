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

/** The bay posed: the cheapest mineral, two mid ones, and the dearest gemstone. */
const HAUL: Partial<Record<Ore, number>> = {
  ferron: 3,
  cuprite: 2,
  cobaltine: 1,
  aurite: 1,
};

/** What those units are worth, as specs/mining.md prices them. */
const VALUE = Object.entries(HAUL).reduce(
  (sum, [ore, count]) => sum + mineralOf(ore as Ore).value * (count as number),
  0,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays the sum of the stated values of the units held", async () => {
  openScene(h);
  layCamp(h);
  standAtBuilding(h, "ore-market");
  pinMiner(h);
  pinDrill(h);
  stageCargo(h, HAUL);
  h.debug.setPanel("ore-market");
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.credits, 0, "specs/expedition.md");
  assertEqual(before.creditsEarned, 0, "specs/expedition.md");

  h.debug.sell();
  await h.advance(1);
  captureStill(h, "credits");

  const after = h.snapshot();
  assertEqual(after.credits, VALUE, "specs/mining.md");
  assertEqual(after.creditsEarned, VALUE, "specs/expedition.md");
});
