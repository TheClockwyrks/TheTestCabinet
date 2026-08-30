// table/face-down-offset — the card under a face-down card is offset 24.
//
// THE RULE. `specs/table.md` fans a column downward, "each one offset below the
// card above it by" `FACE_DOWN_OFFSET` (`24`) when "the card above is"
// face-down. The offset is decided by the face of the card ABOVE the gap, which
// is what this scenario poses.
//
// THE POSE, AND THE VALUE IT DISTINGUISHES. Column 2 — the one column anchor no
// top-row pile shares, so every card-sized shape at `x = 468` is that column's —
// carrying three cards, the first two face-down and the last face-up. Two gaps
// come off that, and BOTH of them are face-down gaps, because a gap's offset
// follows the card above it: the third card's own face decides nothing, and it
// is posed face-up so that a build which reads the face of the card BELOW the gap
// instead draws `34` there and is named for the wrong model it implemented.
//
// Three cards reach `y = 228` at the stated offsets, whose bottom edge is `368`,
// well above `COLUMN_BOTTOM_LIMIT` (`676`), so nothing here is compressed and the
// figure read is the plain one. The face-down offset is in any case never
// compressed (`table/compression-spares-face-down`).
//
// WHAT IS READ. The distinct rows the column's cards were drawn on, and the two
// GAPS between them rather than the rows themselves — a difference of two rows,
// so a build that anchors its column somewhere other than `180` is docked at
// `table/tableau-anchor-y` and read honestly here.

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

/** Three cards, the first two face-down, so both gaps are face-down gaps. */
const CARDS = 3;
const FACE_DOWN_CARDS = 2;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades. It is well under the `24` this reads, so
 * two cards are never merged into one row.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a gap may sit from the figure the specification fixes, in logical
 * units.
 *
 * `FACE_DOWN_OFFSET` is a whole number and a gap is the difference of two rows,
 * so a build that insets its card plate by a constant has that inset cancel and
 * a conformant build has nothing to round. One unit is room for a build that
 * rounds each row's `y` to whole units all the same, and it leaves the other
 * offset this could be — `FACE_UP_OFFSET` (`34`), ten units away — well outside.
 */
const OFFSET_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the card under a face-down card by 24", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS, FACE_DOWN_CARDS));

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

  for (let gap = 0; gap < FACE_DOWN_CARDS; gap += 1) {
    assertBetween(
      rows[gap + 1] - rows[gap],
      FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
      FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
      `the drop from card ${gap + 1} to card ${gap + 2} of the column, both of ` +
        `them below a face-down card, which specs/table.md offsets by ` +
        `FACE_DOWN_OFFSET (${FACE_DOWN_OFFSET})`,
    );
  }
});
