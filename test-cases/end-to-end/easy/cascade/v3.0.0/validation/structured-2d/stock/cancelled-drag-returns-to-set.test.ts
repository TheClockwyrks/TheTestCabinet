// stock/cancelled-drag-returns-to-set — a lift that comes to nothing costs the
// waste nothing.
//
// THE RULE. specs/stock.md: "A lift leaves the set memory untouched. The set a
// lifted card came from keeps its count for as long as the card is in hand, and a
// set's count falls only when its card leaves the waste for good. So a card lifted
// off the waste and returned to it, because the move it began was refused or because
// the gesture was a click rather than a drop, rejoins the set it came from and finds
// the memory exactly as it was." specs/controls.md says what the release does: a
// drop whose leading card's centre "lies in no pile's rectangle" returns the run "to
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
// grabs the waste's top card is `handling/press-grabs-waste-top`; here it is
// asserted only so the reading below is of a card that really was in hand.
//
// WHERE THE PRESS LANDS. `wasteTopPoint()` is the harness's point that lies on the
// waste's TOP card under either deal mode — the overlap between the card at the
// waste anchor under Draw One and the card at the right end of the fan under Draw
// Three (specs/table.md).
//
// WHERE THE RELEASE LANDS. specs/table.md gives the top row six piles anchored on
// the column positions and says of the third of them, `x = 468`, that it "carries no
// pile in the top row". The waste's own drop rectangle is `CARD_W` wide at `346`,
// whatever the shown set fans to, so it ends at `446`; the first foundation's begins
// at `590`; and the columns' rectangles begin at `y = 180`. So the centre of that
// empty card-sized space, `(518, 94)`, lies in no drop rectangle under either deal
// mode. It is `96` units from the press, far past `DRAG_THRESHOLD` (`5`), so the
// gesture is a drop and not a click, which is the arm of the rule this point takes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  NINE,
  openTable,
  poseWaste,
  wasteTopPoint,
  type Harness,
} from "../harness";

/**
 * The waste the card is lifted off: a card left beneath, and the one that is lifted
 * on top of it, each on a set of its own so the lifted card is the one shown.
 */
const POSED_WASTE = [card("diamonds", NINE), card("spades", ACE)];
const POSED_SETS = [1, 1] as const;

/**
 * Where the run is released: the centre of the card-sized space at `x = 468` in the
 * top row, which specs/table.md states carries no pile. It is in no drop rectangle
 * under either deal mode, and it is far enough from the press for the gesture to be
 * a drop rather than a click (specs/controls.md).
 */
const EMPTY_POINT = { x: 518, y: 94 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a waste card released over nothing, with the set memory as it was", async () => {
  openTable(h);
  const ids = poseWaste(h, POSED_WASTE, POSED_SETS);

  const grab = wasteTopPoint();
  h.debug.pointerDown(grab.x, grab.y);
  // The precondition, not the requirement: without a run in hand there is no
  // cancelled drag for the rule below to be about (specs/controls.md).
  assertNotNull(
    h.snapshot().drag,
    "a run in hand after a press on the waste's top card (specs/controls.md)",
  );

  h.debug.pointerMove(EMPTY_POINT.x, EMPTY_POINT.y);
  h.debug.pointerUp(EMPTY_POINT.x, EMPTY_POINT.y);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "returned");

  assertEqual(
    after.drag,
    null,
    "the run in hand once the gesture has ended (specs/controls.md)",
  );
  assertDeepEqual(
    after.waste.map((reported) => reported.id),
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
