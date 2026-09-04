// Cascade — table/compression-uniform: a compressed column's face-up gaps are
// all the same size.
//
// specs/table.md, Long-column compression: a column that would pass the line has
// "its face-up offset ... reduced uniformly, the same value under every face-up
// card of that column, to the largest value that fits the column above the
// line."
//
// UNIFORMLY is the whole of this point. A build can fit a column above `676` in
// several ways, and only one of them is the specified one: taking the whole
// reduction out of the last gap fits just as well and reads as a column that is
// evenly fanned and then abruptly squashed, which is exactly what the word rules
// out. So what is read is the SPREAD of the gaps — the largest less the smallest
// — and not their value. That the column fits at all is
// `column-compression`'s point, and the floor the reduction stops at is
// `compression-floor`'s.
//
// The wrong models read as plainly different numbers. Twelve face-up cards call
// for a gap of `(676 - 140 - 180) / 11 = 32.36`, so a build that reduced every
// gap draws a spread of zero; one that squeezed only the last gap draws ten gaps
// of `34` and one of `16`, a spread of eighteen; one that squeezed only the
// gaps below some point draws a spread of a similar order.
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
 * The fit this column calls for spaces its cards `32.36` apart, so two units can
 * only merge a card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far the largest gap may exceed the smallest, in logical units, for the
 * reduction still to count as uniform.
 *
 * The value the fit calls for here is `32.36`, which is not a whole number, so a
 * build that snaps each card's top edge to a whole unit draws gaps of `32` and
 * `33` and a spread of one. Two units is that allowance doubled, and it is far
 * below what any non-uniform model produces: taking the reduction out of one gap
 * alone spreads the gaps by eighteen, and using the face-down offset for part of
 * the column spreads them by ten.
 */
const GAP_SPREAD = 2;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/** Twelve face-up cards: the shortest column the compression rule applies to. */
const CARDS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every face-up gap of a compressed column the same size", async () => {
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

  const gaps = rowGaps(rows);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  assertLessThanOrEqual(
    spread,
    GAP_SPREAD,
    `the spread of the ${gaps.length} face-up gaps of the compressed column, ` +
      `which were ${JSON.stringify(gaps.map((gap) => Math.round(gap * 100) / 100))}`,
  );
});
