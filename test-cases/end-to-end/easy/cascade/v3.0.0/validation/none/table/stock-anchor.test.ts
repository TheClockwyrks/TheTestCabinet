// table/stock-anchor — the stock's card is drawn at (224, 24).
//
// THE RULE. `specs/table.md` anchors the top row at `TOP_ROW_Y` (`24`) and the
// stock at `(STOCK_X, TOP_ROW_Y)`, `(224, 24)`, and it is a squared pile: "every
// card sits at the pile's anchor, so the pile shows its top card alone".
//
// THE POSE. One card on the stock and nothing anywhere else. The stock is then
// the only pile on the table holding a card, so it is the only pile drawing one,
// and the other twelve are empty and draw the card-sized mark `specs/table.md`
// gives an empty pile "at its anchor". Under either deal mode the waste is empty,
// so nothing fans out of it and the top row carries nothing but the six anchors.
//
// WHAT IS READ, IN TWO DIRECTIONS THAT FAIL DIFFERENTLY.
//
//   1. A card-sized shape sits at `(224, 24)`. The stock holds a card, so it is
//      not empty and the mark an empty pile draws is not what is being read
//      here — a build that drew its stock somewhere else leaves that anchor bare.
//   2. No card-sized shape sits away from all thirteen anchors. That is the other
//      half of the same reading: a build that kept drawing a mark at the stock's
//      anchor while putting the card itself elsewhere would satisfy the first
//      direction alone, and the card it drew off the anchor is a shape at no
//      pile's anchor. The empty piles' marks are AT their anchors by the rule
//      above, so nothing else can put a shape there.
//
// Where an empty pile's mark is drawn is `presentation/empty-slot-drawn`; how
// wide the card itself is, `table/card-size`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  COLUMN_X,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
} from "../constants";
import {
  captureStill,
  cards,
  createHarness,
  cardFootprints,
  openTable,
  poseStock,
  type Harness,
  type Point,
} from "../harness";

/** The one card posed. Its value decides nothing about where it is drawn. */
const CARD = "7H";

/**
 * The thirteen anchors `specs/table.md` fixes: the six of the top row, and the
 * seven columns'. Every pile in this scenario but the stock is empty and draws
 * its card-sized mark on its own.
 */
const ANCHORS: Point[] = [
  { x: STOCK_X, y: TOP_ROW_Y },
  { x: WASTE_X, y: TOP_ROW_Y },
  ...FOUNDATION_X.map((x) => ({ x, y: TOP_ROW_Y })),
  ...COLUMN_X.map((x) => ({ x, y: TABLEAU_Y })),
];

/**
 * How far a painted shape's size may sit from the card footprint and still be
 * read as a card, in logical units: room for the unit a build loses insetting a
 * stroke, on a footprint `specs/table.md` fixes at `CARD_W x CARD_H` and
 * `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a card's corner may sit from an anchor and still be read as sitting on
 * it, in logical units. The same allowance, applied to the corner; the anchors
 * this tells apart are `122` units across and `156` down.
 */
const PLACEMENT_TOLERANCE = 2;

/** Whether a corner sits on `anchor`, within the placement tolerance. */
function sitsOn(corner: Point, anchor: Point): boolean {
  return (
    Math.abs(corner.x - anchor.x) <= PLACEMENT_TOLERANCE &&
    Math.abs(corner.y - anchor.y) <= PLACEMENT_TOLERANCE
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the stock's card at its anchor and nowhere else", async () => {
  await openTable(h);
  await poseStock(h, cards(CARD));

  const calls = await h.frameCalls();
  await captureStill(h, "stock");

  const drawn = cardFootprints(calls, CARD_SIZE_TOLERANCE);
  const anchor = { x: STOCK_X, y: TOP_ROW_Y };

  assertGreaterThan(
    drawn.filter((corner) => sitsOn(corner, anchor)).length,
    0,
    `card-sized shapes drawn at the stock's anchor (${STOCK_X}, ${TOP_ROW_Y}), ` +
      "where the one card this scenario put on the stock sits; the stock holds " +
      "a card, so nothing there is the mark an empty pile draws " +
      "(specs/table.md)",
  );

  const stray = drawn.filter((corner) =>
    ANCHORS.every((at) => !sitsOn(corner, at)),
  );
  assertDeepEqual(
    stray.map((corner) => [Math.round(corner.x), Math.round(corner.y)]),
    [],
    "the corners of the card-sized shapes drawn away from all thirteen pile " +
      "anchors: the stock is the only pile holding a card and the other twelve " +
      "draw their marks at their own anchors, so a shape anywhere else is the " +
      "stock's card off its anchor (specs/table.md)",
  );
});
