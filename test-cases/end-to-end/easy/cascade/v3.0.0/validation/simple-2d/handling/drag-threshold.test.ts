// handling/drag-threshold — `DRAG_THRESHOLD` is what separates a click from a drop.
//
// specs/controls.md fixes the whole rule in one table: a release "within
// `DRAG_THRESHOLD` (`5`) of the press point" is a click, and a release "farther than
// `DRAG_THRESHOLD` from the press point" is a drop. It then fixes what each of them
// does, and the two lists differ in exactly the way this point reads:
//
//   A click ... "turns the stock, as specs/stock.md states, when the press point
//   lies in the stock's drop rectangle."
//   A drop ... "resolves the run in hand against the drop rectangles specs/table.md
//   fixes. It activates no control and turns no stock."
//
// So one gesture, driven twice over the stock, decides the threshold in both
// directions: pressing on the stock and releasing `4` units away turns cards, and
// pressing on the stock and releasing `6` units away turns none. A build whose
// threshold is too small answers the four-unit gesture as a drop and turns nothing;
// a build with no threshold at all, or one too large, answers the six-unit gesture as
// a click and turns cards. Only a build that reads `5` as stated passes both.
//
// WHY THE STOCK AND NOT A CARD. The item's own description names a press on a
// column's lowest card and a `6`-unit move onto a legal target, and that scenario
// cannot be built on this table. A held run travels exactly as far as the pointer
// does (specs/controls.md), so `6` units carries the leading card's center `6` units
// from where the pressed card was drawn; specs/table.md puts the columns at a pitch
// of `122`, so the nearest OTHER pile's rectangle is `72` units away and the only
// rectangle within `6` units is the source column's own. A drop resolved back to the
// pile the run was lifted from leaves the same board a click's return leaves, card
// for card, so the two gestures would be indistinguishable and the point would
// decide nothing. The stock is where the specification itself states an outcome that
// a click has and a drop does not, so it is where the threshold is observable. This
// is reported as a gap in the item's description, not in the rule: the rule this
// check asserts is the one specs/controls.md states, in both directions.
//
// EACH HALF IS POSED AFRESH. `openTable` resets the game between them, so the second
// press is measured against no press before it and cannot pair with the first into a
// double click (specs/controls.md), and the stock each half turns is the same stock.
//
// The still is the four-unit gesture's board, the half where something happened: a
// waste holding the cards the click turned. The six-unit gesture's board is the pose
// it started from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { DRAG_THRESHOLD, STOCK_X, TOP_ROW_Y } from "../constants";
import {
  cardCenter,
  captureStill,
  createHarness,
  openTable,
  poseStock,
  type Harness,
  type Point,
} from "../harness";

/** Cards left in the stock after one turn, so a turn cannot have emptied it. */
const SPARE = 2;

/**
 * The cards the stock is posed from, bottom card first.
 *
 * A turn moves one card under Draw One and three under Draw Three
 * (specs/stock.md), so the pose takes three or five off this list and the same
 * check reads both. The count comes off `snapshot().turnCount`, the reading
 * `draw-one/deal-mode-reported` and `draw-three/deal-mode-reported` pin to the
 * specification, rather than out of the build's own `src/constants` — a build that
 * turned the wrong number and named it consistently would otherwise be measured
 * against its own mistake.
 */
const DECK = ["2C", "3D", "4S", "5H", "6C", "7D", "8S"];

/** The center of the stock's drop rectangle, which every press below lands in. */
const AT = cardCenter(STOCK_X, TOP_ROW_Y);

/** A release this far from its press is a click: `4` against `DRAG_THRESHOLD`. */
const CLICK_MOVE = 4;

/** A release this far from its press is a drop: `6` against `DRAG_THRESHOLD`. */
const DROP_MOVE = 6;

/** Press at `AT`, move `distance` units along x, and release there. */
function gesture(h: Harness, distance: number): void {
  const to: Point = { x: AT.x + distance, y: AT.y };
  h.debug.pointerDown(AT.x, AT.y);
  h.debug.pointerMove(to.x, to.y);
  h.debug.pointerUp(to.x, to.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers a release inside DRAG_THRESHOLD as a click and one outside it as a drop", async () => {
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  const stock = DECK.slice(0, turnCount + SPARE);

  poseStock(h, stock);
  gesture(h, DROP_MOVE);
  const dropped = h.snapshot();

  openTable(h);
  poseStock(h, stock);
  gesture(h, CLICK_MOVE);
  const clicked = h.snapshot();
  await h.advance(1);
  captureStill(h, "both");

  assertLength(
    clicked.waste,
    turnCount,
    `the cards on the waste after a press on the stock and a release ` +
      `${CLICK_MOVE} units away, within DRAG_THRESHOLD (${DRAG_THRESHOLD}): ` +
      "the gesture is a click, and a click over the stock turns it " +
      "(specs/controls.md)",
  );
  assertLength(
    dropped.waste,
    0,
    `the cards on the waste after a press on the stock and a release ` +
      `${DROP_MOVE} units away, past DRAG_THRESHOLD (${DRAG_THRESHOLD}): the ` +
      "gesture is a drop, and a drop turns no stock (specs/controls.md)",
  );
  assertLength(
    dropped.stock,
    stock.length,
    `the cards left in the stock after that ${DROP_MOVE}-unit gesture: it was ` +
      "a drop, so nothing was turned off it (specs/controls.md)",
  );
});
