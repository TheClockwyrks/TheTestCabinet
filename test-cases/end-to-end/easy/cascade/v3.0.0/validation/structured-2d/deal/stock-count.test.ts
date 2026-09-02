// deal/stock-count — the deal leaves twenty-four cards in the stock.
//
// THE RULE. specs/deal.md deals `DEAL_TABLEAU_CARDS` (`28`) cards to the tableau
// and states that "the remaining `DEAL_STOCK_CARDS` (`24`) cards form the stock".
// Twenty-four is the whole of the game's reserve, so a build that deals a stock of
// any other size gives the player a different game: too few and hands become
// unwinnable that should not be, too many and cards are missing from the table.
//
// `DEAL_STOCK_CARDS` comes from this project's own `constants.ts`, which
// transcribes it from specs/deal.md. The build writes an `src/constants.ts` of
// its own; reading the figure out of THAT would hold a build's stock against
// its own claim about its stock, which every build survives.
//
// WHAT IT LEAVES ALONE. The count alone. That every one of those cards is
// face-down is `deal/stock-face-down`, and that the fifty-two cards on the table
// are one of each is `deal/full-deck`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { DEAL_STOCK_CARDS } from "../constants";
import {
  captureStill,
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

it("leaves the twenty-four cards the tableau did not take in the stock", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  assertLength(
    harness.snapshot().stock,
    DEAL_STOCK_CARDS,
    "cards in the stock a deal leaves (specs/deal.md)",
  );
});
