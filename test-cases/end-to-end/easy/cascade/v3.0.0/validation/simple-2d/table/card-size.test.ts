// table/card-size — a card covers 100 x 140 wherever it sits.
//
// THE RULE. specs/table.md opens with the footprint: "Every card occupies a
// `CARD_W x CARD_H` (`100 x 140`) rectangle. That is its footprint wherever it
// sits: in a pile, overlapped in a column, held in hand, or in flight during the
// victory cascade." So the size is a constant of the game and not a property of
// the pile a card is on, which is why this point reads it at two unrelated places:
// a squared pile in the top row, and the first card of a tableau column.
//
// IT DECIDES THE SIZE, NOT THE PLACE. The card is found by looking for the drawn
// box NEAREST its pile's anchor within a generous radius, rather than by demanding
// a box exactly at the anchor: a build whose stock sits a few units off should
// fail `table/stock-anchor` and still have its footprint graded here. The radius
// is far smaller than the `122` that separates two pile positions, so what it
// finds can only be the card this point posed.
//
// FACE-UP AND FACE-DOWN BOTH. specs/table.md gives the footprint to a card "drawn
// face-up ... or face-down, showing its back", so the two are posed together: a
// build that draws its backs at some other size fails here rather than passing on
// the strength of its faces.
//
// THE MEASUREMENT IS OF THE BOX, NOT OF THE FOOTPRINT IT SHOULD HAVE. `drawnBoxes`
// maps each drawn rectangle's own corners through the transform the build issued
// it under, so a card drawn small and scaled up, or drawn about the origin under a
// translate, is measured where it landed on the stage.

import { afterEach, beforeEach, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../../src/constants";
import { assertBetween, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseColumn,
  posePile,
  type Harness,
} from "../harness";
import { boxNear, cardCorners } from "./geometry";

/**
 * How far a drawn card's width or height may sit from the footprint, in logical
 * units.
 *
 * `100 x 140` is exact in specs/table.md, so this is not a size allowance: it is
 * room for the unit a build loses insetting a stroke or rounding a corner inside
 * the footprint, which is the same room `harness.ts` reads a card-sized box with
 * (`CARD_BOX_TOLERANCE`). The next-smallest thing on the table, the `22`-unit gap
 * between two columns, is eleven times this.
 */
const SIZE_TOLERANCE = 2;

/**
 * How far from a pile's anchor the card is looked for, in logical units.
 *
 * A search radius rather than a placement tolerance — where a pile's cards belong
 * is decided by the anchor points of this same group. It is a third of the `122`
 * that separates two pile positions, so the nearest box it can reach is the card
 * this point posed and never a neighbouring pile's.
 */
const SEARCH_RADIUS = 40;

/** The column the face-down card is posed on, well away from the stock. */
const COLUMN = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws a card over its 100 x 140 footprint wherever it sits", async () => {
  openTable(harness);
  posePile(harness, "stock", 0, ["QH"]);
  poseColumn(harness, COLUMN, ["#8D"]);

  const calls = await drawFrame(harness);
  captureStill(harness, "card");

  const boxes = drawnBoxes(harness, calls);
  const places = [
    { what: "the face-up card on the stock", x: STOCK_X, y: TOP_ROW_Y },
    {
      what: `the face-down card on column ${COLUMN}`,
      x: COLUMN_X[COLUMN],
      y: TABLEAU_Y,
    },
  ];

  for (const place of places) {
    const drawn = boxNear(boxes, place.x, place.y, SEARCH_RADIUS);
    if (drawn === null) {
      fail(
        `something drawn within ${SEARCH_RADIUS} units of ` +
          `(${place.x}, ${place.y}), where ${place.what} was posed`,
        cardCorners(boxes),
      );
    }
    assertBetween(
      drawn.w,
      CARD_W - SIZE_TOLERANCE,
      CARD_W + SIZE_TOLERANCE,
      `the width of ${place.what}, CARD_W (specs/table.md)`,
    );
    assertBetween(
      drawn.h,
      CARD_H - SIZE_TOLERANCE,
      CARD_H + SIZE_TOLERANCE,
      `the height of ${place.what}, CARD_H (specs/table.md)`,
    );
  }
});
