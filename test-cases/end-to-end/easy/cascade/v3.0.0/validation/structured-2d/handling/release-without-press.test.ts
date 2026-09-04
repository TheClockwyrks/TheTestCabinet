// handling/release-without-press — a release with nothing held changes nothing.
//
// THE RULE. specs/controls.md: "A gesture runs from a press to the release that
// follows it", and "A release with nothing in hand and no control or stock under
// its press changes nothing." A release that follows no press at all has neither a
// run to put down nor a press point to activate anything from, so it is that
// sentence's case with nothing left to argue about.
//
// WHERE THE RELEASE LANDS. On the centre of the STOCK's drop rectangle, which
// specs/table.md fixes as `CARD_W x CARD_H` at `(STOCK_X, TOP_ROW_Y)`. That is the
// one point on the table where a gesture with nothing in hand has an effect to
// have — a CLICK there turns the stock (specs/controls.md), which
// `handling/stock-click-turns` decides — so a build that answers a bare release as
// though it were a click turns cards here and fails, while a build that
// distinguishes the two leaves the stock alone.
//
// WHAT IS READ. The thirteen piles and the waste's set memory, before the release
// and again after it, and the hand. "Nothing" is not one field: a check that read
// only the stock would pass a build that left the stock alone and disturbed a
// column.
//
// THE BOARD CARRIES A STOCK, A COLUMN AND A STARTED FOUNDATION, so a build that
// answers a bare release by landing, turning or sending something home has
// somewhere to do it and is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  dropRectIn,
  openTable,
  poseColumn,
  poseFoundation,
  poseStock,
  rectCenter,
  releaseAt,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./gestures";

/** The board the release must not disturb. */
const FOUNDATION = 0;
const SUIT = "spades";
const COLUMN = 0;
const CARDS = [card(SUIT, TWO)];
const STOCK = [card("hearts", ACE), card("hearts", TWO), card("hearts", 3)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the whole board and the hand as they were when a release follows no press", async () => {
  // `reset`, which `openTable` runs first, clears the last press
  // (specs/instrumentation.md), so the release below follows no press at all.
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  poseColumn(h, COLUMN, CARDS);
  poseStock(h, STOCK);

  const before = boardText(h.snapshot());
  const at = rectCenter(dropRectIn(h.snapshot(), "stock"));
  releaseAt(h, at.x, at.y);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    boardText(after),
    before,
    "the thirteen piles and the waste's set memory after a release over the " +
      "stock that followed no press: a gesture runs from a press, and a " +
      "release with nothing in hand changes nothing (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the release, which was empty before it and has " +
      "nothing to put down (specs/controls.md)",
  );
});
