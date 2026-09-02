// Cascade — table/compression-spares-face-down: compression reduces the face-up
// offset and leaves the face-down one at `24`.
//
// specs/table.md, Long-column compression: "its face-up offset is reduced
// uniformly ... The face-down offset stays at `24` however far a column is
// compressed."
//
// THE POSE IS THE LONGEST COLUMN KLONDIKE PRODUCES, and it is the shape the rule
// was written for: six face-down cards with a thirteen-card run built down over
// them, which is a column a real game reaches. At the plain offsets it would
// run `180 + 6 x 24 + 12 x 34 + 140 = 872`, nearly two hundred units past
// `COLUMN_BOTTOM_LIMIT` (`676`), so a conformant build compresses it. The room
// left after the six face-down gaps have taken their `24` each is
// `676 - 140 - 180 - 144 = 212` over twelve face-up gaps, so the face-up cards
// are drawn `17.67` apart while the face-down ones stay `24` apart.
//
// The two values are six units apart, so the wrong model reads as a different
// number: a build that reduced every gap of the column alike would draw
// `356 / 18 = 19.78` under the face-down cards, four units below `24` and
// outside the tolerance. What this point does NOT decide is whether the column
// compressed at all — that is `column-compression`'s, and a build that never
// compresses draws `24` under its face-down cards and is charged there — nor
// what the face-up gaps came out at, which is `compression-uniform`'s.
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
import { assertBetween, assertLength } from "../assert";
import { FACE_DOWN_OFFSET } from "../constants";
import {
  captureStill,
  createHarness,
  down,
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
 * The closest this column's cards come is the `17.67` its face-up gaps are
 * reduced to, so two units can only merge a card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far a face-down gap may sit from `FACE_DOWN_OFFSET` (`24`), in logical
 * units.
 *
 * The offset is a whole number the rule leaves untouched, so a conformant build
 * draws exactly `24`; one unit is the same snapping allowance the anchors get.
 * A build that compressed the face-down gaps along with the face-up ones draws
 * `19.78` here, four units away.
 */
const OFFSET_TOLERANCE = 1;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/** The buried cards of the column, and the run built down over them. */
const FACE_DOWN = 6;
const FACE_UP = 13;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the face-down offset at 24 in a compressed column", async () => {
  openTable(h);
  const cards = fullDeck().slice(0, FACE_DOWN + FACE_UP);
  poseColumn(
    h,
    COLUMN,
    cards.map((spec, index) => (index < FACE_DOWN ? down(spec) : spec)),
  );

  const calls = await h.drawFrame();
  captureStill(h, "compressed");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertLength(
    rows,
    FACE_DOWN + FACE_UP,
    `the ${FACE_DOWN + FACE_UP} cards of the column drawn as that many rows ` +
      `of their own; the frame drew the column's card-sized boxes at ` +
      `${corners(column)}`,
  );

  // The gap under card `i` is the one the card at row `i` decides, so the first
  // `FACE_DOWN` gaps are the ones under the six face-down cards.
  const gaps = rowGaps(rows).slice(0, FACE_DOWN);
  gaps.forEach((gap, index) => {
    assertBetween(
      gap,
      FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
      FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
      `the gap under face-down card ${index} of the compressed column`,
    );
  });
});
