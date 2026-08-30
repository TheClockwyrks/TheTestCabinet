// cargo/credits-earned-accumulates — the expedition tracks what it has earned.
//
// specs/instrumentation.md: `creditsEarned` is "the running total earned this
// expedition", read beside the balance rather than derived from it.
// specs/gameplay.md has the Victory and Game Over screens report the total
// Credits earned among what they summarize, and makes selling the only source of
// Credits and the Upgrade Shop one of the four sinks.
//
// So two sales are made and part of the proceeds spent on an upgrade. The running
// total must be the two sales added together — unmoved by the spending — which
// puts it above the balance. A build reading the total off the balance reports
// the sales less the upgrade instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ORES, UPGRADE_PRICES, type Ore } from "../constants";
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

/** The two hauls sold, and the track a tier is bought on afterwards. */
const FIRST: Partial<Record<Ore, number>> = { ferron: 10 };
const SECOND: Partial<Record<Ore, number>> = { argenite: 4 };
const TRACK = "drill";

/** What each haul is worth, as specs/mining.md prices them. */
const value = (haul: Partial<Record<Ore, number>>) =>
  Object.entries(haul).reduce(
    (sum, [ore, count]) => sum + ORES[ore as Ore].value * (count as number),
    0,
  );
const EARNED = value(FIRST) + value(SECOND);

/** What the second tier on a five-tier track costs. */
const PRICE = UPGRADE_PRICES[2];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds up every sale, and does not fall when the proceeds are spent", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtBuilding(h, "ore-market");
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setPanel("ore-market");

  const opening = await h.snapshot();
  assertEqual(opening.credits, 0, "specs/gameplay.md");
  assertEqual(opening.creditsEarned, 0, "specs/instrumentation.md");

  await stageCargo(h, FIRST);
  await h.debug.sell();
  const first = await h.snapshot();
  assertEqual(first.creditsEarned, value(FIRST), "specs/instrumentation.md");

  await stageCargo(h, SECOND);
  await h.debug.sell();
  const both = await h.snapshot();
  assertEqual(both.creditsEarned, EARNED, "specs/instrumentation.md");
  assertEqual(both.credits, EARNED, "specs/gameplay.md");

  // Spend part of it, at a sink that is not the Ore Market.
  await standAtBuilding(h, "upgrade-shop");
  await h.debug.setPanel("upgrade-shop");
  await h.debug.buyUpgrade(TRACK);
  await h.advance(1);
  await captureStill(h, "earned");

  const after = await h.snapshot();
  assertEqual(after.tiers[TRACK], 2, "specs/upgrades.md");
  assertEqual(after.credits, EARNED - PRICE, "specs/upgrades.md");
  assertEqual(after.creditsEarned, EARNED, "specs/instrumentation.md");
  assertGreaterThan(after.creditsEarned, after.credits, "specs/gameplay.md");
});
