// Cascade — table/stock-anchor: the stock is drawn at `(STOCK_X, TOP_ROW_Y)`.
//
// specs/table.md, The top row: the row "sits at `TOP_ROW_Y` (`24`)" and the
// stock is anchored at "`(STOCK_X, TOP_ROW_Y)`, `(224, 24)`". The same section
// fixes how a squared pile draws: "The stock and the foundations are squared
// piles: every card sits at the pile's anchor, so the pile shows its top card
// alone."
//
// So one card on the stock is read for the corner it was drawn at, and nothing
// else. No other pile stands at `(224, 24)`: the waste is a card and a gap to
// the right of it and the foundations are three positions further still, so a
// build that drew the stock anywhere but here misses this box.
//
// A face-DOWN card is posed, because that is the face the stock is dealt with
// (specs/deal.md) and the one a player ever sees on it. Which face a build draws
// is `presentation`'s; the footprint of a card is the same either way
// (specs/table.md, A card).

import { afterEach, beforeEach, it } from "vitest";
import { STOCK_X, TOP_ROW_Y } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  down,
  openTable,
  poseCard,
  SEVEN,
  type Harness,
} from "../harness";
import { boxesAt, cardBoxes, corners } from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far the drawn card's top-left may sit from `(224, 24)`, in logical units.
 * The anchor is a whole number in a space that maps one-to-one onto the canvas
 * here, so a conformant build lands on it exactly.
 */
const ANCHOR_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the stock's card at (224, 24)", async () => {
  openTable(h);
  poseCard(h, "stock", 0, down(card("spades", SEVEN)));

  const calls = await h.drawFrame();
  captureStill(h, "stock");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  assertGreaterThan(
    boxesAt(boxes, STOCK_X, TOP_ROW_Y, ANCHOR_TOLERANCE).length,
    0,
    `the stock's card drawn with its top-left at (${STOCK_X}, ${TOP_ROW_Y}); ` +
      `the frame drew card-sized boxes at ${corners(boxes)}`,
  );
});
