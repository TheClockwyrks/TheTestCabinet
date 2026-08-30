// table/compression-spares-face-down — a compressed column still drops 24 under a
// face-down card.
//
// THE RULE. `specs/table.md`: when a column is compressed "its face-up offset is
// reduced uniformly … The face-down offset stays at `24` however far a column is
// compressed."
//
// THE POSE, AND THE VALUE IT DISTINGUISHES. Column 2 — the one column anchor no
// top-row pile shares, so every card-sized shape at `x = 468` is that column's —
// carrying twenty-three cards, the first three face-down and the other twenty
// face-up. That gives three face-down gaps at the head of the column and nineteen
// face-up gaps below them, and the column is deep into the compressed case: at
// the natural offsets it would reach a bottom edge of `1038`, against a line of
// `676`.
//
// The proportions are chosen so that every wrong model reads a different number
// in the three gaps this point measures:
//
//   * The rule as written leaves them at `24`, and fits the nineteen face-up gaps
//     into what is left, `284 / 19 = 14.95`.
//   * A build that compressed every gap alike, face-down ones included, has
//     twenty-two gaps to fit `356` units and draws `16.18` — nearly eight units
//     off, and unmistakable.
//   * A build that compressed the face-down gaps to the same value it gave the
//     face-up ones draws `14.95` there, nine units off.
//
// A build that does not compress at all draws the `24` this point requires and
// passes it, correctly: not compressing is `table/column-compression`'s to dock,
// and this point is only about what compression does to a face-down gap.
//
// WHAT IS READ. The three gaps at the head of the column, each against `24`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { COLUMN_X, FACE_DOWN_OFFSET } from "../constants";
import {
  captureStill,
  columnOfCards,
  columnRowTops,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed: the one anchor no top-row pile shares (`468`). */
const COLUMN = 2;

/**
 * Twenty-three cards, the first three face-down: three face-down gaps to read,
 * and nineteen face-up gaps beneath them that have to take `14.95` for the column
 * to fit, so the compression is real and heavy.
 */
const CARDS = 23;
const FACE_DOWN_CARDS = 3;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades. It is well under the `14.95` this column's
 * face-up gaps come to, so two cards are never merged into one row.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a face-down gap may sit from `24`, in logical units.
 *
 * `FACE_DOWN_OFFSET` is a whole number the compression never touches, and a gap
 * is the difference of two rows, so a constant inset cancels; one unit is room
 * for a build that rounds each row's `y` all the same. The two wrong models this
 * separates draw `16.18` and `14.95`, both many units outside it.
 */
const OFFSET_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the face-down gaps at 24 in a compressed column", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS, FACE_DOWN_CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "compressed");

  const rows = columnRowTops(calls, COLUMN, CARD_SIZE_TOLERANCE);
  assertLength(
    rows,
    CARDS,
    `rows the ${CARDS} cards on column ${COLUMN} were drawn on, read as the ` +
      `distinct top edges of the card-sized shapes at x = ${COLUMN_X[COLUMN]}` +
      " (specs/table.md)",
  );

  for (let gap = 0; gap < FACE_DOWN_CARDS; gap += 1) {
    assertBetween(
      rows[gap + 1] - rows[gap],
      FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
      FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
      `the drop from card ${gap + 1} to card ${gap + 2} of a compressed column, ` +
        "both of them below a face-down card, which specs/table.md leaves at " +
        `FACE_DOWN_OFFSET (${FACE_DOWN_OFFSET}) however far the column is ` +
        "compressed",
    );
  }
});
