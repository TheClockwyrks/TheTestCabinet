// table/face-up-offset — the card under a face-up card is offset 34.
//
// THE RULE. `specs/table.md` fans a column downward, "each one offset below the
// card above it by" `FACE_UP_OFFSET` (`34`) when "the card above is" face-up. The
// offset is decided by the face of the card ABOVE the gap.
//
// THE POSE, AND WHY IT IS SHORT. Column 2 — the one column anchor no top-row pile
// shares, so every card-sized shape at `x = 468` is that column's — carrying
// three face-up cards. Two gaps come off that, both of them face-up gaps.
//
// Three cards reach `y = 248` at the stated offset, whose bottom edge is `388`,
// well above `COLUMN_BOTTOM_LIMIT` (`676`): the column is "short enough to need
// no compression", which is the condition the item names, so the figure read here
// is the uncompressed `34` and nothing about the compression rule is being asked.
// A build that compressed this column anyway draws something smaller and is named
// for it here rather than at `table/column-compression`, which reads a column
// that genuinely has to compress.
//
// A build that read the face of the card BELOW each gap instead would draw the
// same `34` here, and a build that used the face-down offset everywhere draws
// `24`; the two models are ten units apart, and the mixed column
// `table/face-down-offset` poses separates them.
//
// WHAT IS READ. The distinct rows the column's cards were drawn on, and the two
// GAPS between them rather than the rows themselves, so a build that anchors its
// column somewhere other than `180` is docked at `table/tableau-anchor-y` and
// read honestly here.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { COLUMN_X, FACE_UP_OFFSET } from "../constants";
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
 * Three face-up cards, which reach `y = 248` and a bottom edge of `388` at the
 * stated offset — far above `COLUMN_BOTTOM_LIMIT` (`676`), so the column needs no
 * compression.
 */
const CARDS = 3;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a gap may sit from the figure the specification fixes, in logical
 * units.
 *
 * `FACE_UP_OFFSET` is a whole number and a gap is the difference of two rows, so
 * a constant inset cancels and a conformant build has nothing to round. One unit
 * is room for a build that rounds each row's `y` all the same, and it leaves the
 * other offset this could be — `FACE_DOWN_OFFSET` (`24`), ten units away — and
 * the smallest compressed offset (`14`) well outside.
 */
const OFFSET_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the card under a face-up card by 34", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "column");

  const rows = columnRowTops(calls, COLUMN, CARD_SIZE_TOLERANCE);
  assertLength(
    rows,
    CARDS,
    `rows the ${CARDS} cards on column ${COLUMN} were drawn on, read as the ` +
      `distinct top edges of the card-sized shapes at x = ${COLUMN_X[COLUMN]}` +
      " (specs/table.md)",
  );

  for (let gap = 0; gap + 1 < CARDS; gap += 1) {
    assertBetween(
      rows[gap + 1] - rows[gap],
      FACE_UP_OFFSET - OFFSET_TOLERANCE,
      FACE_UP_OFFSET + OFFSET_TOLERANCE,
      `the drop from card ${gap + 1} to card ${gap + 2} of the column, both of ` +
        "them below a face-up card in a column short enough to need no " +
        `compression, which specs/table.md offsets by FACE_UP_OFFSET ` +
        `(${FACE_UP_OFFSET})`,
    );
  }
});
