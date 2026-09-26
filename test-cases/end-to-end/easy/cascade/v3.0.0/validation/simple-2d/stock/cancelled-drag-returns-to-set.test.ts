// stock/cancelled-drag-returns-to-set — a lift that comes to nothing costs the
// waste nothing.
//
// THE RULE. specs/stock.md: "A lift leaves the set memory untouched. The set a
// lifted card came from keeps its count for as long as the card is in hand, and a
// set's count falls only when its card leaves the waste for good. So a card lifted
// off the waste and returned to it, because the move it began was refused or because
// the gesture was a click rather than a drop, rejoins the set it came from and finds
// the memory exactly as it was." specs/controls.md says what the release does: a
// drop whose leading card's center "lies in no pile's rectangle" returns the run "to
// the pile it was lifted from".
//
// A build that decremented the set on the LIFT rather than on the move would leave a
// player who thought better of a drag with a waste holding a card it no longer
// shows, and a build that put the card back on the wrong end would leave the pile
// out of order. Both are read here.
//
// THE GESTURE IS DRIVEN IN THREE STEPS RATHER THAN THROUGH `drag`, because the LIFT
// is this point's precondition and has to be seen to have happened: a press that
// picked nothing up leaves a check with no cancelled drag to decide, and it would
// otherwise pass on a build whose waste cannot be grabbed at all. That the press
// grabs the waste's top card is `handling`'s own point; here it is asserted only so
// the reading below is of a card that really was in hand.
//
// WHERE THE RELEASE LANDS. specs/table.md gives the top row six piles anchored on
// the column positions and says of the third of them, `x = 468`, that it "carries no
// pile in the top row". The waste's own drop rectangle is `CARD_W` wide at `346`,
// whatever the shown set fans to, so it ends at `446`; the first foundation's begins
// at `590`; and the columns' rectangles begin at `y = 180`. So the center of that
// empty card-sized space, `(518, 94)`, lies in no drop rectangle under either deal
// mode. It is `122` units from the press, far past `DRAG_THRESHOLD` (`5`), so the
// gesture is a drop and not a click, which is the arm of the rule this point takes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  pressPoint,
  type Harness,
} from "../harness";

/**
 * The waste the card is lifted off: a card left beneath, and the one that is lifted
 * on top of it, each on a set of its own so the lifted card is the one shown.
 */
const POSED_WASTE = ["9D", "AS"] as const;
const POSED_SETS = [1, 1] as const;

/** The row the lifted card sits at, counted from the bottom of the waste. */
const LIFTED_ROW = POSED_WASTE.length - 1;

/**
 * Where the run is released: the center of the card-sized space at `x = 468` in the
 * top row, which specs/table.md states carries no pile. It is in no drop rectangle
 * under either deal mode, and it is far enough from the press for the gesture to be
 * a drop rather than a click (specs/controls.md).
 */
const EMPTY_POINT = { x: 518, y: 94 };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("returns a waste card released over nothing, with the set memory as it was", async () => {
  openTable(harness);
  const ids = poseWaste(harness, POSED_WASTE, POSED_SETS);

  const grab = pressPoint(harness.snapshot(), "waste", 0, LIFTED_ROW);
  harness.debug.pointerDown(grab.x, grab.y);
  // The precondition, not the requirement: without a run in hand there is no
  // cancelled drag for the rule below to be about (specs/controls.md).
  assertNotNull(
    harness.snapshot().drag,
    "a run in hand after a press on the waste's top card (specs/controls.md)",
  );

  harness.debug.pointerMove(EMPTY_POINT.x, EMPTY_POINT.y);
  harness.debug.pointerUp(EMPTY_POINT.x, EMPTY_POINT.y);

  await harness.advance(1);
  captureStill(harness, "returned");

  const after = harness.snapshot();
  assertEqual(
    after.drag,
    null,
    "the run in hand once the gesture has ended (specs/controls.md)",
  );
  assertDeepEqual(
    after.waste.map((card) => card.id),
    ids,
    "the ids on the waste, bottom first, after a lift released over no pile " +
      "(specs/stock.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    [...POSED_SETS],
    "the waste's set memory after a lift that was returned to it " +
      "(specs/stock.md)",
  );
  assertEqual(
    after.wasteVisibleCount,
    POSED_SETS[POSED_SETS.length - 1],
    "wasteVisibleCount after the returned lift, which is the newest set's " +
      "count (specs/instrumentation.md)",
  );
});
