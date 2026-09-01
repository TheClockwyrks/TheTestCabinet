// handling/stock-click-turns — a press and release on the stock turns cards onto the
// waste.
//
// specs/controls.md: a click "turns the stock, as specs/stock.md states, when the
// press point lies in the stock's drop rectangle", and a click is a release "within
// `DRAG_THRESHOLD` (`5`) of the press point". specs/table.md fixes that rectangle as
// `CARD_W x CARD_H` at `(STOCK_X, TOP_ROW_Y)`, so the press below lands at its
// center. specs/stock.md fixes what the turn moves: "`TURN_COUNT` cards, or all that
// remain when the stock holds fewer than that".
//
// THE FIGURE IS THE ONE THE BUILD WAS SEEDED. `TURN_COUNT` is read from
// `src/constants.ts`, the module the case supplies and the build does not edit, so
// this point holds a build to the deal mode it was given rather than to the number
// it reports for itself; `draw-one/turn-count` and `draw-three/turn-count` are the
// items that grade the reported figure. That is also what makes one validator serve
// both variants: the pose is `TURN_COUNT + SPARE` cards whatever `TURN_COUNT` is.
//
// THE STOCK HOLDS MORE THAN ONE TURN, so the reading separates a build that turns
// the deal mode's count from one that turns the whole stock, and the waste starts
// empty so what it holds afterwards IS what the click moved.
//
// WHAT THIS DOES NOT DECIDE. The order the cards arrive in, their faces, and the set
// the turn appends are the `stock` group's items. This point reads the gesture: that
// a press and a release over the stock is what turns it.

import { afterEach, beforeEach, it } from "vitest";
import { STOCK_X, TOP_ROW_Y, TURN_COUNT } from "../../src/constants";
import { assertLength } from "../assert";
import {
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";

/** Cards left in the stock after one turn, so the turn cannot have emptied it. */
const SPARE = 2;

/**
 * The stock, bottom card first, holding one turn and `SPARE` cards over.
 *
 * Long enough for either deal mode: `TURN_COUNT` is `1` under Draw One and `3` under
 * Draw Three (specs/stock.md), so the pose is three or five cards off this list.
 */
const DECK = ["2C", "3D", "4S", "5H", "6C", "7D", "8S"];
const STOCK = DECK.slice(0, TURN_COUNT + SPARE);

/** The center of the stock's drop rectangle, which the press lands in. */
const AT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grows the waste by the deal mode's turn count on a click over the stock", async () => {
  openTable(h);
  poseStock(h, STOCK);

  clickAt(h, AT.x, AT.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "turned");

  assertLength(
    after.waste,
    TURN_COUNT,
    `the cards on the waste after one click over the stock, which held ` +
      `${STOCK.length}: a turn moves TURN_COUNT of them (specs/controls.md, ` +
      "specs/stock.md)",
  );
  assertLength(
    after.stock,
    SPARE,
    `the cards left in the stock after that click: the ${STOCK.length} it ` +
      `held, less the ${TURN_COUNT} the turn moved (specs/stock.md)`,
  );
});
