// handling/empty-stock-click-recycles — a click on the empty stock slot returns the
// waste to the stock.
//
// specs/controls.md: a click "turns the stock, as specs/stock.md states, when the
// press point lies in the stock's drop rectangle". specs/stock.md: "A turn of an
// empty stock recycles instead: every card on the waste returns to the stock
// face-down, in reverse order... The waste is left empty." specs/table.md fixes the
// rectangle the press lands in as `CARD_W x CARD_H` at `(STOCK_X, TOP_ROW_Y)`, and
// an empty pile "draws a card-sized mark at its anchor", so the slot a player clicks
// is exactly that rectangle whether or not the stock holds anything.
//
// THE STOCK IS EMPTY AND THE WASTE IS NOT, which is the only state in which this
// gesture recycles: with cards in the stock the same click turns instead
// (`handling/stock-click-turns`), and with both empty it leaves both empty
// (`stock/empty-stock-empty-waste`).
//
// THE POSE DOES NOT DEPEND ON THE DEAL MODE. The waste's three cards are posed as
// three sets of one, which is a memory either deal mode can reach, so the same
// validator reads both variants.
//
// WHAT THIS DOES NOT DECIDE. The order the cards come back in, their faces, and the
// set memory the recycle empties are the `stock` group's items. This point reads the
// gesture: that a press and a release over the empty stock is what recycles.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { STOCK_X, TOP_ROW_Y } from "../constants";
import {
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The waste, bottom card first, with one set per card. */
const WASTE = ["3C", "9D", "JS"];
const WASTE_SETS = [1, 1, 1];

/** The center of the stock's drop rectangle, which the press lands in. */
const AT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the waste to the stock on a click over the empty stock slot", async () => {
  openTable(h);
  poseWaste(h, WASTE, WASTE_SETS);

  clickAt(h, AT.x, AT.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "recycled");

  assertLength(
    after.stock,
    WASTE.length,
    `the cards in the stock after a click over its empty slot, with ` +
      `${WASTE.length} on the waste: every card on the waste returns to the ` +
      "stock (specs/controls.md, specs/stock.md)",
  );
  assertLength(
    after.waste,
    0,
    "the cards left on the waste after that click: the recycle leaves it " +
      "empty (specs/stock.md)",
  );
});
