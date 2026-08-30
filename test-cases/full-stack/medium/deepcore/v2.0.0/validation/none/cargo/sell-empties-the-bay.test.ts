// cargo/sell-empties-the-bay — a sale takes the whole cargo.
//
// specs/mining.md: "`SELL` at the Ore Market converts the whole cargo to Credits
// at the values above and empties the bay", and the bay is emptied by selling.
// specs/gameplay.md names the Ore Market as the one Credits source and says the
// sale empties the bay there too.
//
// The bay is posed as a mix of four minerals and a gemstone, so a build that
// emptied only the ore it happened to look at would still be holding something
// afterwards. The miner is stood on the Ore Market's own footprint — the surface
// answers where that is, so no layout is assumed — and its panel is opened
// through the surface rather than by pressing the activate control, since a build
// with a broken activate key and a working sale must fail the panel points and
// pass this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { type Ore } from "../constants";
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

/** The bay posed: four minerals from across the depth range, and a gemstone. */
const HAUL: Partial<Record<Ore, number>> = {
  ferron: 4,
  cuprite: 3,
  cobaltine: 2,
  pyronium: 1,
  verdite: 1,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the bay of every ore it held", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtBuilding(h, "ore-market");
  await pinMiner(h);
  await pinDrill(h);
  await stageCargo(h, HAUL);
  await h.debug.setPanel("ore-market");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.panel, "ore-market", "specs/instrumentation.md");
  assertLength(Object.keys(before.cargo.ore), 5, "specs/instrumentation.md");
  assertEqual(before.cargo.slotsUsed, 11, "specs/mining.md");

  await h.debug.sell();
  await h.advance(1);
  await captureStill(h, "sale");

  const after = await h.snapshot();
  assertLength(Object.keys(after.cargo.ore), 0, "specs/mining.md");
  assertEqual(after.cargo.slotsUsed, 0, "specs/mining.md");
  assertEqual(after.cargo.loadKg, 0, "specs/mining.md");
  assertEqual(after.miner.overloaded, false, "specs/character.md");
});
