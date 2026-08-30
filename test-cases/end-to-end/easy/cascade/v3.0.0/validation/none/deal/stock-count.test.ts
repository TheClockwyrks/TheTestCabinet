// Cascade — deal/stock-count: the stock takes the twenty-four cards the tableau
// did not.
//
// specs/deal.md, The deal: "The remaining `DEAL_STOCK_CARDS` (`24`) cards form
// the stock, face-down, in the order they were left in after the tableau was
// dealt." Twenty-four is what is left of fifty-two once the staircase has taken
// twenty-eight, and it is the figure the whole stock cycle rests on:
// specs/stock.md turns the deal mode's count at a time and recycles the waste
// when the stock runs out, so a deal that leaves a different number changes how
// many passes a player gets through the deck.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles, so every card in the stock afterwards is one this deal put there; then
// `deal()`, the game's own deal path (specs/instrumentation.md), lays the board.
//
// WHAT FACE those cards carry is deal/stock-face-down, and that the fifty-two on
// the table are one full deck is deal/full-deck.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { DEAL_STOCK_CARDS } from "../constants";
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

it("leaves twenty-four cards in the stock", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { stock } = await h.snapshot();
  assertLength(
    stock,
    DEAL_STOCK_CARDS,
    "cards the deal left in the stock (specs/deal.md)",
  );
});
