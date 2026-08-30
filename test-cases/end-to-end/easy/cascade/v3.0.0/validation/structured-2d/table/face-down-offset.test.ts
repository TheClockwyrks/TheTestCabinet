// Cascade — table/face-down-offset: the card below a face-down card is drawn
// `FACE_DOWN_OFFSET` lower.
//
// specs/table.md, The columns: a column's cards "fan downward from there, each
// one offset below the card above it by" `FACE_DOWN_OFFSET` (`24`) where "The
// card above is Face-down", and `FACE_UP_OFFSET` (`34`) where it is face-up.
//
// The pose is the smallest column that has a face-down gap in it at all: a
// face-down card with one card under it. Two cards reach `180 + 24 + 140 = 344`,
// nowhere near `COLUMN_BOTTOM_LIMIT` (`676`), so compression is not in this
// picture and the offset drawn is the plain one. The compressed column's
// face-down gaps are `compression-spares-face-down`'s point, and the face-up gap
// is `face-up-offset`'s.
//
// WHAT IS READ IS THE GAP, not the two positions. The two rows are subtracted,
// so a build that put the whole column at the wrong height still passes here and
// fails `tableau-anchor-y` alone. The distinguishing values are far apart: a
// build that used the face-up offset under a face-down card draws `34`, ten
// units out, and one that used no offset at all draws `0`.
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
import { FACE_DOWN_OFFSET } from "../../src/constants";
import { assertBetween, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  down,
  KING,
  openTable,
  poseColumn,
  QUEEN,
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
 * A column's cards are never closer together than `FACE_UP_OFFSET_MIN` (`14`),
 * so two units can only merge a card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far the gap may sit from `FACE_DOWN_OFFSET` (`24`), in logical units.
 *
 * The offset is a whole number and this column is short enough that no
 * compression applies to it, so a conformant build draws exactly `24`; one unit
 * is the same snapping allowance the anchors get. The nearest wrong model — the
 * face-up offset used under a face-down card — draws `34`, ten units away.
 */
const OFFSET_TOLERANCE = 1;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/** How many cards the column holds: the fewest that have a face-down gap between them. */
const CARDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the card under a face-down card by 24", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [down(card("spades", KING)), card("hearts", QUEEN)]);

  const calls = await h.drawFrame();
  captureStill(h, "column");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertLength(
    rows,
    CARDS,
    `the two cards of the column drawn as the column's two rows; ` +
      `the frame drew the column's card-sized boxes at ${corners(column)}`,
  );

  const [gap] = rowGaps(rows);
  assertBetween(
    gap,
    FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
    FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
    "the gap between the column's two rows, under its face-down card",
  );
});
