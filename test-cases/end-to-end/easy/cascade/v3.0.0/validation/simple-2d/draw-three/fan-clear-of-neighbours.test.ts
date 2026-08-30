// draw-three/fan-clear-of-neighbours — the fan stays off the stock and the foundations.
//
// THE RULE. specs/table.md fans the waste's shown cards "to the right from the waste
// anchor", and fixes how far that may reach: "at most three cards fan, so the fan
// begins at `346` and its right edge never passes `498`". The piles either side of
// it are the stock, anchored at `224`, and the first foundation, anchored at `590`.
// So the fan's leftmost edge is at or right of the waste anchor and its rightmost
// edge is left of the first foundation, and the top row's three groups never
// collide. The bound this reads is the neighbour's anchor rather than the `498` the
// specification fans to, so a build with a wider fan that still clears its
// neighbours is docked at `draw-three/waste-fans-shown-set` alone.
//
// THE POSE IS THE WIDEST FAN THE RULE ALLOWS. Three cards on the waste, all in one
// set, which is the most that ever fan. Every other pile is empty, so the only
// card-sized shapes in the top row are the fan's cards and the empty-slot marks
// specs/table.md has each empty pile draw at its own anchor.
//
// WHAT IS READ, AND WHY IT IS READ TWICE. The fan's extent comes off every
// card-sized box in the top row that does not sit at the stock's anchor or at one of
// the four foundations', because those five anchors carry the neighbours' own marks
// and nothing there could be told apart by position. That leaves one way for a fan
// to overrun and go unseen: a card parked exactly on a neighbour's anchor, which a
// fan pitched at `122` or `244` would do. So the four foundations are read as well.
// They are all empty, so specs/table.md has each draw the same card-sized mark, and
// a count that differs between them is a card the waste put on one of them.
//
// The exact fan positions are `draw-three/waste-fans-shown-set`; this point decides
// only that the fan clears what sits either side of it.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_X, STOCK_X, TOP_ROW_Y, WASTE_X } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  CARD_BOX_TOLERANCE,
  cardBoxes,
  captureStill,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseWaste,
  type DrawnBox,
  type Harness,
} from "../harness";

/** The three cards of the shown set, which is the most the fan ever holds. */
const SHOWN = ["3S", "7H", "KD"];

/** One set holding all three, so the waste shows every card it holds. */
const SETS = [SHOWN.length];

/** The anchors the top row's other piles draw on (specs/table.md). */
const NEIGHBOUR_X = [STOCK_X, ...FOUNDATION_X];

/**
 * How far a drawn box's corner may sit from an anchor and still be read as sitting
 * on it, in logical units. The harness's own allowance for the unit a build loses
 * insetting a stroke; the piles this tells apart are `122` units apart.
 */
const PLACEMENT_TOLERANCE = CARD_BOX_TOLERANCE;

/** The card-sized boxes drawn at `x` in the top row. */
function boxesAt(boxes: readonly DrawnBox[], x: number): DrawnBox[] {
  return boxes.filter((box) => Math.abs(box.x - x) <= PLACEMENT_TOLERANCE);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the fan between the waste anchor and the first foundation", async () => {
  openTable(h);
  poseWaste(h, SHOWN, SETS);

  const calls = await drawFrame(h);
  captureStill(h, "fan");

  const topRow = cardBoxes(drawnBoxes(h, calls)).filter(
    (box) => Math.abs(box.y - TOP_ROW_Y) <= PLACEMENT_TOLERANCE,
  );
  const fan = topRow.filter((box) =>
    NEIGHBOUR_X.every(
      (anchor) => Math.abs(box.x - anchor) > PLACEMENT_TOLERANCE,
    ),
  );

  assertGreaterThan(
    fan.length,
    0,
    "card-sized shapes the waste drew for its shown set, which is what this " +
      "point measures the fan from (specs/table.md)",
  );
  assertGreaterThanOrEqual(
    Math.min(...fan.map((box) => box.x)),
    WASTE_X - PLACEMENT_TOLERANCE,
    `the fan's leftmost edge, which begins at the waste anchor ${WASTE_X} and ` +
      "never reaches the stock (specs/table.md)",
  );
  assertLessThan(
    Math.max(...fan.map((box) => box.x + box.w)),
    FOUNDATION_X[0],
    "the fan's rightmost edge, which stays left of the first foundation at " +
      `${FOUNDATION_X[0]} (specs/table.md)`,
  );

  const marks = FOUNDATION_X.map((x) => boxesAt(topRow, x).length);
  for (const [index, count] of marks.entries()) {
    assertEqual(
      count,
      marks[0],
      `card-sized shapes drawn at foundation ${index}'s anchor ` +
        `${FOUNDATION_X[index]}, against foundation 0's ${marks[0]}: the four ` +
        "are empty alike and draw the same mark, so a difference is a card of " +
        "the fan parked on one of them (specs/table.md)",
    );
  }
});
