// stock/empty-stock-empty-waste — a turn with nothing anywhere does nothing.
//
// THE RULE. specs/stock.md: "A turn with the stock and the waste both empty leaves
// both empty." It is the corner the recycle rule leaves over: the stock is empty, so
// the turn recycles, and the waste it would recycle holds nothing. A player reaches
// it by playing every card off the waste and then pressing the stock, which happens
// in the endgame of a deal that is going well, and the game has to answer it without
// inventing a card or throwing.
//
// THE WHOLE TABLE IS READ, not only the two piles. A build that answered the empty
// recycle by fabricating a card would put it somewhere, and `openTable` leaves all
// thirteen piles empty, so the count of cards anywhere on the table stays the
// evidence that nothing was invented. The set memory is read for the same reason: a
// set counted onto an empty waste would have it claiming to show a card that does
// not exist.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  tableCards,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the stock and the waste both empty when neither holds a card", async () => {
  openTable(harness);
  harness.debug.turnStock();

  await harness.advance(1);
  captureStill(harness, "empty");

  const after = harness.snapshot();
  assertLength(
    after.stock,
    0,
    "cards on the stock after a turn with nothing anywhere (specs/stock.md)",
  );
  assertLength(
    after.waste,
    0,
    "cards on the waste after a turn with nothing anywhere (specs/stock.md)",
  );
  assertLength(
    after.wasteSets,
    0,
    "entries in the waste's set memory after a turn with nothing anywhere " +
      "(specs/stock.md)",
  );
  assertLength(
    tableCards(after),
    0,
    "cards anywhere on the table after a turn with nothing anywhere " +
      "(specs/stock.md)",
  );
});
