// Cascade — table/column-compression: a column too long for the table is fitted
// above `COLUMN_BOTTOM_LIMIT`.
//
// specs/table.md, Long-column compression: "A column's lowest card's bottom edge
// may not fall below `COLUMN_BOTTOM_LIMIT` (`676`). When a column's natural
// extent at the offsets above would pass that line, its face-up offset is
// reduced uniformly ... to the largest value that fits the column above the
// line."
//
// THE POSE IS A COLUMN THAT REALLY DOES PASS THE LINE, and only just. Twelve
// face-up cards at the plain `FACE_UP_OFFSET` reach
// `180 + 11 x 34 + 140 = 694`, eighteen units past `676`, so a build that never
// compresses fails by those eighteen units and a build that compresses lands the
// lowest card's bottom edge exactly on the line. The gap the fit calls for is
// `(676 - 140 - 180) / 11 = 32.36`, comfortably above `FACE_UP_OFFSET_MIN`, so
// the floor is not in this picture at all; that is `compression-floor`'s point,
// and that the reduction is the SAME under every card is
// `compression-uniform`'s.
//
// The reading is the lowest row's bottom edge alone. Where the column starts is
// `tableau-anchor-y`'s, and how the twelve rows are spaced between the two ends
// is the two points beside this one.
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
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  CARD_H,
  COLUMN_BOTTOM_LIMIT,
  FACE_UP_OFFSET,
  TABLEAU_Y,
} from "../constants";
import {
  alternatingRun,
  captureStill,
  createHarness,
  KING,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import {
  busiestColumn,
  cardBoxes,
  corners,
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
 * The fit this column calls for spaces its cards `32.36` apart, so two units can
 * only merge a card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far past `COLUMN_BOTTOM_LIMIT` the lowest card's bottom edge may sit, in
 * logical units.
 *
 * The limit is a whole number and the fit puts the bottom edge exactly on it, so
 * this is rounding room for a build that snaps each card's top edge to a whole
 * unit — which can only move the lowest card by less than a unit — and nothing
 * else. A build that did not compress at all overshoots by eighteen.
 */
const FIT_TOLERANCE = 1;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/**
 * How many face-up cards the column holds.
 *
 * Eleven is the most that fit at the plain offset — `180 + 10 x 34 + 140 = 660`
 * — so twelve is the shortest column the rule applies to at all.
 */
const CARDS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a long column's lowest card above the bottom limit", async () => {
  openTable(h);
  poseColumn(h, COLUMN, alternatingRun(KING, CARDS));

  const calls = await h.drawFrame();
  captureStill(h, "compressed");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertLength(
    rows,
    CARDS,
    `the ${CARDS} cards of the column drawn as ${CARDS} rows; the frame drew the ` +
      `column's card-sized boxes at ${corners(column)}`,
  );

  const lowest = rows[rows.length - 1] + CARD_H;
  assertLessThanOrEqual(
    lowest,
    COLUMN_BOTTOM_LIMIT + FIT_TOLERANCE,
    `the bottom edge of the lowest of ${CARDS} cards, which at the plain ` +
      `offset of ${FACE_UP_OFFSET} would reach ` +
      `${TABLEAU_Y + (CARDS - 1) * FACE_UP_OFFSET + CARD_H}`,
  );
});
