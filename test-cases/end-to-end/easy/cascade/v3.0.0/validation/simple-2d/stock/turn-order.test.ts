// stock/turn-order — the stock's top card ends up deepest of the turned group.
//
// THE RULE. specs/stock.md: the cards "are taken one at a time from the top of the
// stock and placed face-up on the waste, so the stock's top card is the deepest of
// the group the turn moved and the last card taken is the waste's new top card". A
// turn is therefore a REVERSAL of the cards it took, and that is what decides which
// card the player may play next.
//
// THE EXPECTED ORDER IS BUILT FROM THE BOARD, NOT FROM A LITERAL. The stock is read
// before the turn, the cards the turn actually moved are counted from what the stock
// lost, and the group expected on the waste is that many cards off the top of the
// stock, reversed. So the order is decided against the pile the build was handed
// whatever its deal mode turns, and a build that took its cards off the BOTTOM of
// the stock, or laid them down in the order it found them, fails by naming the cards
// it moved.
//
// CARDS ARE FOLLOWED BY ID. A card keeps its id for as long as it is on the table
// (specs/instrumentation.md), so an id says which card this is and not merely which
// rank and suit; two cards of the same rank and suit cannot be confused, because the
// posed stock holds each card once.
//
// THE WASTE IS POSED EMPTY, so the whole waste is the turned group and nothing
// underneath it can stand in for a card the turn should have moved. Whether the
// group is the right SIZE is `stock/turn-moves-to-waste`, and their faces are
// `stock/turned-cards-face-up`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { stockSpecs } from "./turning";

/** Cards posed on the stock, longer than either deal mode's turn. */
const STOCK_SIZE = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("lays the turned cards down in the reverse of the order they lay in", async () => {
  openTable(harness);
  poseStock(harness, stockSpecs(STOCK_SIZE));

  const before = harness.snapshot();
  harness.debug.turnStock();

  await harness.advance(1);
  captureStill(harness, "turned");

  const after = harness.snapshot();
  const moved = before.stock.length - after.stock.length;
  assertGreaterThanOrEqual(
    moved,
    1,
    "cards a turn of a twelve-card stock took off the stock (specs/stock.md)",
  );

  // The group the turn took, as it lay on the stock: the top `moved` cards, bottom
  // first. Reversed, that is the order specs/stock.md says the waste receives them
  // in, bottom of the waste first.
  const taken = before.stock.slice(before.stock.length - moved);
  const expected = [...taken].reverse().map((card) => card.id);

  assertDeepEqual(
    after.waste.map((card) => card.id),
    expected,
    "the ids on the waste, bottom first, after a turn took cards one at a time " +
      "off the top of the stock (specs/stock.md)",
  );
});
