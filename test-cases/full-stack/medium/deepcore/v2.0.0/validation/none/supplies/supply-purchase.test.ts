// Deepcore — supplies/supply-purchase: buying one pays its price and adds one.
//
// `specs/items.md`: "Buying one deducts its price and increments its count", at
// the prices its table fixes — `300`, `1000`, `1500`, `8000`, `4000`, `2000`. All
// six are bought from one known balance, and each purchase is read on the call:
// the balance down by exactly that item's price and that item's count up by one.
//
// The miner stands at the Supply Depot with its panel open, which is where
// `specs/world.md` and `specs/ui.md` put the transaction, and the footprint is
// asked of the build rather than assumed, because where the six buildings sit
// along the camp is the build's to choose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ITEM_IDS, ITEM_PRICES } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtBuilding,
  type Harness,
} from "../harness";

/** More than the six together cost, so nothing is refused for want of Credits. */
const BALANCE = 30_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deducts each supply's price and adds one to its count", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtBuilding(h, "supply-depot");
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.clearItems();
  await h.debug.setCredits(BALANCE);
  await h.debug.setPanel("supply-depot");

  for (const id of ITEM_IDS) {
    const before = await h.snapshot();
    await h.debug.buyItem(id);
    const after = await h.snapshot();

    assertEqual(
      before.credits - after.credits,
      ITEM_PRICES[id],
      `Credits ${id} cost`,
    );
    assertEqual(
      after.items[id],
      before.items[id] + 1,
      `${id} held after buying one`,
    );
  }

  await h.advance(2);
  await captureStill(h, "depot");

  const end = await h.snapshot();
  const total = ITEM_IDS.reduce((sum, id) => sum + ITEM_PRICES[id], 0);
  assertEqual(end.credits, BALANCE - total, "the balance after buying all six");
});
