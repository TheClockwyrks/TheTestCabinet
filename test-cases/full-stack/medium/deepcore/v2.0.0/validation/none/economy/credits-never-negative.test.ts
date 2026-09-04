// economy/credits-never-negative — no sink ever borrows.
//
// `specs/expedition.md` fixes the floor over the whole economy: "Credits never go
// negative". This point drives every sink the specification names — the Fuel
// Depot's four controls, all seven upgrade tracks, all six field supplies and
// the Launch Pad's fabricate — twice: once from a balance of `0`, and once from
// a balance one Credit short of that sink's own price. The balance is read after
// every single call rather than once at the end, so a build that dips below zero
// and clamps back is caught on the call that dipped.
//
// Fill-to-full and repair-to-full are the two sinks that may legitimately spend
// on a thin balance, since `specs/expedition.md` has them buy as far as the
// Credits reach; what the floor requires of them is the same, that they never
// take more than there is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  ITEM_IDS,
  ITEM_PRICES,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  ROCKET_COMPONENTS,
  UPGRADE_PRICES,
  UPGRADE_TRACKS,
  type Panel,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** A sink, the panel it lives behind, and what it costs to use once. */
interface Sink {
  name: string;
  panel: Panel;
  price: number;
  use: () => Promise<void>;
}

/** A part-empty tank and hull, so every depot control has something to buy. */
const FUEL_BEFORE = 40;
const HULL_BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function sinks(h: Harness): Sink[] {
  const depot: Sink[] = [
    {
      name: "buyFuel",
      panel: "fuel-depot",
      price: FUEL_BUY_INCREMENT * FUEL_PRICE,
      use: () => h.debug.buyFuel(),
    },
    {
      name: "fillFuel",
      panel: "fuel-depot",
      price: FUEL_PRICE,
      use: () => h.debug.fillFuel(),
    },
    {
      name: "buyRepair",
      panel: "fuel-depot",
      price: REPAIR_BUY_INCREMENT * REPAIR_PRICE,
      use: () => h.debug.buyRepair(),
    },
    {
      name: "repairFull",
      panel: "fuel-depot",
      price: REPAIR_PRICE,
      use: () => h.debug.repairFull(),
    },
  ];
  const upgrades: Sink[] = UPGRADE_TRACKS.map((track) => ({
    name: `buyUpgrade(${track})`,
    panel: "upgrade-shop" as Panel,
    price: UPGRADE_PRICES[2],
    use: () => h.debug.buyUpgrade(track),
  }));
  const supplies: Sink[] = ITEM_IDS.map((item) => ({
    name: `buyItem(${item})`,
    panel: "supply-depot" as Panel,
    price: ITEM_PRICES[item],
    use: () => h.debug.buyItem(item),
  }));
  const rocket: Sink[] = [
    {
      name: "fabricate",
      panel: "launch-pad",
      price: ROCKET_COMPONENTS[0].credits,
      use: () => h.debug.fabricate(),
    },
  ];
  return [...depot, ...upgrades, ...supplies, ...rocket];
}

/** Pose the miner short of fuel and hull with `credits` banked, then buy. */
async function spendFrom(sink: Sink, credits: number): Promise<number> {
  await h.debug.setFuel(FUEL_BEFORE);
  await h.debug.setHull(HULL_BEFORE);
  await h.debug.setCredits(credits);
  await h.debug.setPanel(sink.panel);
  await sink.use();
  return (await h.snapshot()).credits;
}

it("holds the balance at or above 0 through every sink", async () => {
  await openCamp(h);
  // Every track back at tier 1 and every count at 0 is what `reset` leaves, so
  // each sink below is attempted on a track and an item it could really buy.
  for (const sink of sinks(h)) {
    assertGreaterThanOrEqual(
      await spendFrom(sink, 0),
      0,
      `specs/expedition.md, ${sink.name} from a balance of 0`,
    );
    assertGreaterThanOrEqual(
      await spendFrom(sink, sink.price - 1),
      0,
      `specs/expedition.md, ${sink.name} one Credit short`,
    );
  }

  await h.advance(1);
  await captureStill(h, "zero");

  // And nothing above bought a tier or a supply it could not pay for, which is
  // what a balance clamped back to 0 after a debt would look like.
  const after = await h.snapshot();
  for (const track of UPGRADE_TRACKS) {
    assertEqual(after.tiers[track], 1, `specs/upgrades.md, ${track}`);
  }
  for (const item of ITEM_IDS) {
    assertEqual(after.items[item], 0, `specs/items.md, ${item}`);
  }
  assertLength(after.rocket.installed, 0, "specs/rocket.md");
});
