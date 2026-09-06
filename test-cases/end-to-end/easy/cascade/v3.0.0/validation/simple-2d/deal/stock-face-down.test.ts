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
// THERE HAS TO BE A CARD TO READ. A pile of no cards shows no face-up card, so a
// build that dealt no stock at all would satisfy a bare sweep of its faces without
// ever having drawn one face-down. So the pile is asserted to hold at least one
// card before its faces are read: specs/deal.md's step 3 forms the stock out of the
// cards the tableau did not take, so a dealt stock has cards in it. That is a
// precondition for the reading rather than the count itself — how many it holds is
// `deal/stock-count`, and a stock of nineteen face-down cards passes here and fails
// there.
//
// WHAT IT LEAVES ALONE. The faces alone. How many cards the stock holds is
// `deal/stock-count`, and the order they are in is not a claim this item makes:
// specs/deal.md fixes the dealt order, but a shuffled deck makes any particular
// order unobservable from outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
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
  assertGreaterThanOrEqual(
    stock.length,
    1,
    "cards in the stock a deal formed, whose faces are read below " +
      "(specs/deal.md)",
  );
  for (const [row, card] of stock.entries()) {
    assertEqual(
      card.faceUp,
      false,
      `stock row ${row}, the card ${cardSpec(card)} face-down (specs/deal.md)`,
    );
  }
});
