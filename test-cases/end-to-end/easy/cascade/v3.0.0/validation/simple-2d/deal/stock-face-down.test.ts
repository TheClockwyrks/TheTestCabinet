// deal/stock-face-down — every card a deal puts in the stock is face-down.
//
// THE RULE. specs/deal.md: "The remaining `DEAL_STOCK_CARDS` (`24`) cards form the
// stock, face-down, in the order they were left in after the tableau was dealt." A
// face-up stock hands the player the whole reserve at a glance, which is
// information Klondike does not give.
//
// EVERY CARD IS NAMED. Each stock card is its own assertion carrying its row from
// the bottom of the pile, so a build that turns only its top card face-up fails
// with that row named.
//
// WHAT IT LEAVES ALONE. The faces alone. How many cards the stock holds is
// `deal/stock-count`, and the order they are in is not a claim this item makes:
// specs/deal.md fixes the dealt order, but a shuffled deck makes any particular
// order unobservable from outside, and `instrumentation/reset-seed-repeats-deal`
// is what holds a build to dealing reproducibly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("forms the stock face-down", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const { stock } = harness.snapshot();
  for (const [row, card] of stock.entries()) {
    assertEqual(
      card.faceUp,
      false,
      `stock row ${row}, the card ${cardSpec(card)} face-down (specs/deal.md)`,
    );
  }
});
