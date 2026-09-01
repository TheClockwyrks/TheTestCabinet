// table/stock-anchor — the stock draws its cards at (224, 24).
//
// THE RULE. specs/table.md anchors the stock at `(STOCK_X, TOP_ROW_Y)`,
// `(224, 24)`, and calls it a squared pile: "every card sits at the pile's anchor,
// so the pile shows its top card alone". So a card on the stock is drawn with its
// top-left exactly there.
//
// THE SCENARIO IS ONE CARD ON AN OTHERWISE EMPTY TABLE. The stock is the only
// pile holding anything, so the only card the frame draws is the one this point is
// about. The twelve empty piles draw their own slot marks, which are card-sized
// too (specs/table.md), but none of them is anchored at `(224, 24)`: the waste is
// `122` to the right, the foundations further right again, and column `0` shares
// the `x` but sits at `TABLEAU_Y` (`180`), `156` lower. So a card-sized box at this
// anchor can only be the stock's card.
//
// NO GESTURE DRIVES IT. The card is posed straight onto the pile. Clicking the
// stock to fill it would charge a broken stock click to this point, which
// `handling.stock-click-turns` owns.

import { afterEach, beforeEach, it } from "vitest";
import { STOCK_X, TOP_ROW_Y } from "../../src/constants";
import { fail } from "../assert";
import {
  boxAt,
  captureStill,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  posePile,
  type Harness,
} from "../harness";
import { CARD_SEARCH_TOLERANCE, cardCorners } from "./geometry";

/**
 * How far a drawn card's top-left may sit from the anchor, in logical units.
 *
 * specs/table.md fixes the anchor exactly, so this is not a placement allowance:
 * it is the unit a build may lose insetting a stroke inside the footprint it
 * draws, which is the same room `harness.ts` gives a box's size
 * (`CARD_BOX_TOLERANCE`). A pile drawn at the wrong anchor misses by the `122`
 * that separates two pile positions.
 */
const ANCHOR_TOLERANCE = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws the stock's card at the stock anchor", async () => {
  openTable(harness);
  posePile(harness, "stock", 0, ["#7C"]);

  const calls = await drawFrame(harness);
  captureStill(harness, "stock");

  const boxes = cardBoxes(drawnBoxes(harness, calls), CARD_SEARCH_TOLERANCE);
  if (boxAt(boxes, STOCK_X, TOP_ROW_Y, ANCHOR_TOLERANCE) === null) {
    fail(
      `a card-sized box with its top-left at (${STOCK_X}, ${TOP_ROW_Y}), the ` +
        `stock's anchor (specs/table.md), among the card-sized boxes the frame ` +
        `drew`,
      cardCorners(boxes),
    );
  }
});
