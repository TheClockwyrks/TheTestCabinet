// handling/drag-threshold — `DRAG_THRESHOLD` decides a click from a drop: a
// release `4` units from its press is a click, and one `6` units from it is a
// drop.
//
// `specs/controls.md` fixes both sides. A release "Within `DRAG_THRESHOLD` (`5`)
// of the press point" is "A click", and one "Farther than `DRAG_THRESHOLD` from
// the press point" is "A drop". A click "turns the stock, as `specs/stock.md`
// states, when the press point lies in the stock's drop rectangle", while "A drop
// resolves the run in hand against the drop rectangles `specs/table.md` fixes. It
// activates no control AND TURNS NO STOCK."
//
// WHY THE STOCK, AND NOT A CARD CARRIED TOWARD A COLUMN. Because on this table a
// card cannot say which kind of gesture it was. `specs/table.md` puts the thirteen
// drop rectangles at least `16` units apart — the `22`-unit gaps between the
// columns, and the gap between the top row's bottom edge at `y = 164` and the
// columns' top edge at `TABLEAU_Y` (`180`) — so a run moved four or six units from
// where it was lifted still has its leading card's centre inside its OWN source
// pile's rectangle, or inside no rectangle at all. A drop resolving to the source
// pile returns the run to exactly where a click would have returned it, and a drop
// resolving to no pile does the same. Both readings of the threshold therefore
// leave the card in its source column, and a check built that way would grade
// nothing. The stock is the one place the two kinds of gesture part company over a
// distance this small, so it is where this check reads them.
//
// HOW THE TWO SIDES ARE SEPARATED. Both halves are the same gesture at the same
// point on the same posed stock, differing only in the two units between `4` and
// `6`, and both are read off the same quantity — the cards on the waste. A build
// whose threshold is too small turns nothing on the four-unit gesture; a build
// whose threshold is too large turns cards on the six-unit gesture; a build with
// no threshold at all fails one half or the other whichever way it decided. The
// margin either side of `5` is a single logical unit, which is the smallest
// margin that can straddle a whole-numbered figure, and neither gesture sits on
// the boundary itself.
//
// THE TURN COUNT IS READ RATHER THAN WRITTEN, since it is one of the four figures
// that differ between the deal modes; `handling/stock-click-turns` is the item
// that grades the click's turn on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  cardCenter,
  cards,
  captureStill,
  createHarness,
  openTable,
  pileTopLeft,
  poseStock,
  type Harness,
} from "../harness";
import { DRAG_THRESHOLD } from "../constants";

/** The stock, bottom card first. More than any deal mode's turn takes. */
const STOCK = ["2C", "5H", "9S", "JD", "4C", "7H"] as const;

/**
 * The two gesture lengths, a unit either side of `DRAG_THRESHOLD` (`5`).
 *
 * The item's own figures. `4` is within the threshold and is therefore a click;
 * `6` is farther than it and is therefore a drop. The rule puts the boundary
 * itself on the click's side, and neither gesture lands on it.
 */
const CLICK_TRAVEL = DRAG_THRESHOLD - 1;
const DROP_TRAVEL = DRAG_THRESHOLD + 1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Press on the stock, travel `distance` units, and release there. */
async function gestureOnStock(distance: number): Promise<void> {
  const anchor = pileTopLeft("stock");
  const press = cardCenter(anchor.x, anchor.y);
  await h.debug.pointerDown(press.x, press.y);
  await h.debug.pointerMove(press.x + distance, press.y);
  await h.debug.pointerUp(press.x + distance, press.y);
}

it("turns the stock on a four-unit gesture and not on a six-unit one", async () => {
  await openTable(h);
  await poseStock(h, cards(...STOCK));

  const turnCount = (await h.snapshot()).turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");

  // Within the threshold: a click, which turns the stock.
  await gestureOnStock(CLICK_TRAVEL);
  await h.advance(SETTLE_FRAMES);
  const clicked = await h.snapshot();
  assertLength(
    clicked.waste,
    turnCount,
    `the cards on the waste after a ${CLICK_TRAVEL}-unit gesture, which is a click`,
  );

  // The same posed stock again, and this time past the threshold: a drop, which
  // turns no stock.
  await openTable(h);
  await poseStock(h, cards(...STOCK));
  await gestureOnStock(DROP_TRAVEL);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "both");

  const dropped = await h.snapshot();
  assertLength(
    dropped.waste,
    0,
    `the cards on the waste after a ${DROP_TRAVEL}-unit gesture, which is a drop`,
  );
});
