// Cascade — draw-three/fan-clear-of-neighbours: the fan stays between the waste anchor and the first foundation.
//
// specs/table.md, The waste: "At most three cards fan, so the fan begins at `346`
// and its right edge never passes `498`." The third column position, `468`, "is
// the space that separates the two draw piles on the left from the foundations on
// the right, and the only thing drawn over any of it is the right end of the
// waste's fan."
//
// So the fan has room to its right and none to its left: the stock sits at `224`
// and ends at `324`, the waste's own anchor is `346`, and the first foundation
// begins at `590`. This point decides that the fan lives inside that gap — that
// no card of it is drawn left of the waste anchor, over the stock, and that none
// of it reaches the foundations. A build that fanned to the LEFT, that fanned at
// a pitch wide enough to run into the foundations, or that fanned every card the
// waste holds rather than the three of the shown set, all show up here as an edge
// on the wrong side of one of those two lines.
//
// The bounds are the ones the manifest states, and they are the neighbours' own
// anchors rather than the `498` the specification derives for three cards at a
// pitch of `26`: this point is about CLEARANCE, and holding the fan to `498` would
// be re-deciding the pitch that `draw-three/waste-fans-shown-set` already decides.
// A build whose fan sits between `346` and `590` clears its neighbours whatever
// pitch it chose, and is graded on the pitch elsewhere.
//
// The waste is posed at its widest — five cards under an older set of two and a
// newest set of three — because the fan is at its longest with three cards shown,
// and a build that fans everything it holds is at its longest with cards buried
// too. The rest of the table is empty, so the only card-sized marks in the top
// row are the fan's and the empty-slot marks the stock and the four foundations
// draw at their own anchors, which are excluded by name.
//
// AND THE FOUR FOUNDATION ANCHORS ARE COUNTED, because excluding them by name is
// what would otherwise let the very fault this point exists to catch through: a
// card of the fan drawn exactly ON a foundation's anchor is dropped from the fan
// along with that foundation's own mark, and the surviving edges then sit inside
// the bounds. The four foundations are empty alike and draw the same mark as each
// other, so the number of card-sized marks at each of the four anchors is the
// same number — and any difference between them is a card of the fan parked on
// one. A card parked on foundation 0 raises 0's count above 1's; a card parked on
// 3 raises 3's above 0's; either way the four stop agreeing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  CARD_H,
  CARD_W,
  FOUNDATION_X,
  STOCK_X,
  TOP_ROW_Y,
  WASTE_X,
} from "../../src/constants";
import {
  ACE,
  FIVE,
  NINE,
  QUEEN,
  captureStill,
  card,
  createHarness,
  drawnShapes,
  openTable,
  poseWaste,
  type DrawnShape,
  type Harness,
} from "../harness";

/**
 * The left line: the waste's own anchor, `346` (specs/table.md).
 *
 * The fan begins there and runs right, so nothing it draws may sit left of it —
 * which is also what keeps it off the stock, whose card ends at `324`.
 */
const FAN_LEFT_LIMIT = WASTE_X;

/**
 * The right line: the first foundation's left edge, `590` (specs/table.md).
 *
 * The fan's right edge must stay strictly left of it, so no card of the fan is
 * drawn over a foundation.
 */
const FAN_RIGHT_LIMIT = FOUNDATION_X[0];

/** How far a drawn card's top-left may sit from an anchor, in logical units. */
const ANCHOR_TOLERANCE = 2;

/** How far a drawn footprint may differ from `CARD_W x CARD_H` (specs/table.md). */
const SIZE_TOLERANCE = 2;

/** The anchors of the piles that are NOT the waste, whose own marks are not the fan's. */
const NEIGHBOUR_X = [STOCK_X, ...FOUNDATION_X];

/** The waste at its widest fan: two buried under an older set, three shown. */
const WASTE = [
  card("clubs", FIVE),
  card("spades", NINE),
  card("spades", ACE),
  card("hearts", QUEEN),
  card("diamonds", ACE),
];
const SETS = [2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the fan between the waste anchor and the first foundation", async () => {
  openTable(h);
  poseWaste(h, WASTE, SETS);

  const calls = await h.drawFrame();
  captureStill(h, "fan");

  const topRow = drawnShapes(h, calls).filter(
    (shape: DrawnShape) =>
      Math.abs(shape.w - CARD_W) <= SIZE_TOLERANCE &&
      Math.abs(shape.h - CARD_H) <= SIZE_TOLERANCE &&
      Math.abs(shape.y - TOP_ROW_Y) <= ANCHOR_TOLERANCE,
  );
  const fan = topRow.filter(
    (shape: DrawnShape) =>
      !NEIGHBOUR_X.some((x) => Math.abs(shape.x - x) <= ANCHOR_TOLERANCE),
  );

  assertGreaterThanOrEqual(
    fan.length,
    1,
    "a card drawn for the waste, which holds five (specs/table.md)",
  );

  const left = Math.min(...fan.map((shape) => shape.x));
  const right = Math.max(...fan.map((shape) => shape.x + shape.w));

  // The tolerance is folded into the bound rather than into the reading, so a
  // failure prints the edge the build actually drew.
  assertGreaterThanOrEqual(
    left,
    FAN_LEFT_LIMIT - ANCHOR_TOLERANCE,
    `the fan's leftmost edge, at or right of the waste anchor ` +
      `(${FAN_LEFT_LIMIT}), which keeps it clear of the stock ` +
      `(ending at ${STOCK_X + CARD_W})`,
  );
  assertLessThan(
    right,
    FAN_RIGHT_LIMIT + ANCHOR_TOLERANCE,
    `the fan's rightmost edge, left of the first foundation ` +
      `(${FAN_RIGHT_LIMIT})`,
  );

  // The four foundations are empty alike, so each of their anchors carries the
  // same number of card-sized marks. A card of the fan drawn onto one of them
  // was excluded from `fan` above and shows up here instead.
  const marks = FOUNDATION_X.map(
    (x) =>
      topRow.filter((shape) => Math.abs(shape.x - x) <= ANCHOR_TOLERANCE)
        .length,
  );
  marks.forEach((count, index) => {
    assertEqual(
      count,
      marks[0],
      `card-sized shapes drawn at foundation ${index}'s anchor ` +
        `(${FOUNDATION_X[index]}), against foundation 0's ${marks[0]}: the ` +
        "four hold nothing and draw the same empty mark, so a difference is a " +
        "card of the fan parked on one of them (specs/table.md)",
    );
  });
});
