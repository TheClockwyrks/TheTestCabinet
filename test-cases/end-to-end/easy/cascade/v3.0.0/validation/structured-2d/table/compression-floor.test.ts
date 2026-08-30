// Cascade — table/compression-floor: the reduced offset stops at
// `FACE_UP_OFFSET_MIN` and goes no lower.
//
// specs/table.md, Long-column compression: "The reduced offset never falls below
// `FACE_UP_OFFSET_MIN` (`14`), and a column long enough to demand less than `14`
// draws `14`."
//
// This is the edge of the compression rule, and it is a rule about a column
// LONGER THAN ANY DEAL PRODUCES: a Klondike column holds at most nineteen cards,
// and nineteen still fit at more than `14` apart. The specification states the
// clause without a condition, and the debug surface builds a table one card at a
// time (specs/instrumentation.md), so the column that reaches the floor is posed
// directly rather than played to.
//
// THE DISTINGUISHING VALUE IS THE POINT OF THE CARD COUNT. Thirty-six face-up
// cards leave `676 - 140 - 180 = 356` units of room over thirty-five gaps, which
// demands `10.17`. A build that honours the floor draws `14`; a build that
// divides the room and forgets the floor draws `10.17`, nearly four units away
// and far outside the tolerance below, so the failure names which of the two
// models the build implemented. A build that never compresses draws `34`.
//
// Only the gaps at the TOP of the column are read. At `14` the column runs well
// past the foot of the stage, which the specification accepts here — the floor
// is stated as winning over the line — and a build is free to leave a card that
// is entirely off the canvas undrawn. The first nine rows reach `y = 292`, high
// on the table, so they are drawn by any build and they carry the offset the
// point is about.
//
// WHICH x THE BUILD DREW THE COLUMN AT IS NOT READ HERE. The column is found as
// the group of card-sized boxes below the top row that share a left edge and
// holds the most of them: on a table where one column is posed and the other six
// show a single empty mark each, that group is the posed column wherever the
// build put it. So a build that fanned its cards correctly at the wrong anchor
// is read here exactly like one that did not, and fails `column-anchors` alone.
// The fan is posed on column `2`, the one column position the top row leaves
// empty (specs/table.md).

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP_OFFSET_MIN } from "../../src/constants";
import { assertBetween, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fullDeck,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import {
  busiestColumn,
  cardBoxes,
  corners,
  rowGaps,
  rowTops,
  tableauBoxes,
} from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far two cards' left edges may differ and still be read as the same column,
 * in logical units.
 *
 * The column is found as the group of card-sized boxes that share a left edge
 * and holds the most of them, so this decides which boxes are grouped together
 * and never where the group had to be. The nearest column position is a pitch
 * away, `122` units, so one unit is snapping room and cannot merge two columns.
 */
const SAME_COLUMN_TOLERANCE = 1;

/**
 * How close two drawn top edges must be to count as one row, in logical units.
 * The floor spaces this column's cards `14` apart, so two units cannot merge two
 * cards and can only merge a card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far a gap may sit from `FACE_UP_OFFSET_MIN` (`14`), in logical units.
 *
 * The floor is a whole number, so a conformant build draws exactly `14`; one
 * unit is the same snapping allowance the anchors get. The model this separates
 * it from — the room divided among the gaps with no floor applied — draws
 * `10.17` here, so the two can never both pass.
 */
const OFFSET_TOLERANCE = 1;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/**
 * How many face-up cards the column holds: enough that the room left over
 * demands `356 / 35 = 10.17`, well under the floor.
 */
const CARDS = 36;

/**
 * How many of the column's rows are read.
 *
 * Nine rows at the floor's `14` reach `y = 292`, near the top of the table, so
 * every build draws them whatever it does with the cards that run off the foot
 * of the stage. Eight gaps is plenty to say which offset the column was drawn
 * at.
 */
const ROWS_READ = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the minimum offset for a column that demands less", async () => {
  openTable(h);
  poseColumn(h, COLUMN, fullDeck().slice(0, CARDS));

  const calls = await h.drawFrame();
  captureStill(h, "floored");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertGreaterThanOrEqual(
    rows.length,
    ROWS_READ,
    `at least the top ${ROWS_READ} of the column's ${CARDS} cards drawn as ` +
      `rows of their own; the frame drew the column's card-sized boxes at ` +
      `${corners(column)}`,
  );

  const gaps = rowGaps(rows.slice(0, ROWS_READ));
  gaps.forEach((gap, index) => {
    assertBetween(
      gap,
      FACE_UP_OFFSET_MIN - OFFSET_TOLERANCE,
      FACE_UP_OFFSET_MIN + OFFSET_TOLERANCE,
      `the gap under card ${index} of a ${CARDS}-card column, which demands ` +
        `an offset below the floor`,
    );
  });
});
