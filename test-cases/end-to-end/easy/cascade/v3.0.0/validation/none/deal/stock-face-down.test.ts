// Cascade — deal/stock-face-down: the stock a deal leaves is face-down.
//
// specs/deal.md, The deal: "The remaining `DEAL_STOCK_CARDS` (`24`) cards form
// the stock, face-down, in the order they were left in after the tableau was
// dealt." A face-down stock is what makes turning it a decision rather than a
// formality: specs/stock.md turns cards from it onto the waste one at a time, and
// a player who can already read the deck has nothing left to turn it for.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles, so every card read here is one this deal put in the stock; then
// `deal()`, the game's own deal path (specs/instrumentation.md), lays the board.
//
// The reading is the COUNT of face-up cards in the stock rather than each card in
// turn, because there is no ordering to the fault: a stock is either dealt
// face-down or it is not, and the number showing is what says how far a build
// missed. HOW MANY cards the stock holds is deal/stock-count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("deals every stock card face-down", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { stock } = await h.snapshot();
  assertGreaterThanOrEqual(
    stock.length,
    1,
    "cards in the stock a deal formed, whose faces are read below (specs/deal.md) — an empty stock would make the reading below vacuous",
  );
  assertEqual(
    stock.filter((card) => card.faceUp).length,
    0,
    `face-up cards among the ${stock.length} the deal left in the stock (specs/deal.md)`,
  );
});
